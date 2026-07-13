import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

type DependencyScope = "optional" | "required";

interface PackageManifest {
  dependencies?: Record<string, string>;
  license?: string;
  name?: string;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  version?: string;
}

interface LockPackageMetadata {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

type LockPackageEntry = [
  identifier: string,
  registry: string,
  metadata: LockPackageMetadata,
  integrity?: string,
];

interface BunLock {
  lockfileVersion?: number;
  packages?: Record<string, LockPackageEntry>;
  workspaces?: Record<
    string,
    {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      optionalPeers?: string[];
      peerDependencies?: Record<string, string>;
    }
  >;
}

interface CycloneDxComponent {
  "bom-ref": string;
  hashes?: Array<{ alg: "SHA-512"; content: string }>;
  licenses?: Array<{ expression: string }>;
  name: string;
  properties: Array<{ name: string; value: string }>;
  purl: string;
  scope?: DependencyScope;
  type: "library";
  version: string;
}

interface ResolvedLockPackage {
  integrity?: string;
  metadata: LockPackageMetadata;
  name: string;
  version: string;
}

const packagePurl = (name: string, version: string): string => {
  const encodedName = name
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
};

const packageIdentity = (
  identifier: string,
): { name: string; version: string } => {
  const separator = identifier.lastIndexOf("@");
  if (separator <= 0 || separator === identifier.length - 1) {
    throw new Error(`Invalid Bun lock package identifier: ${identifier}`);
  }
  return {
    name: identifier.slice(0, separator),
    version: identifier.slice(separator + 1),
  };
};

const sha512Hex = (integrity: string | undefined): string | undefined => {
  if (!integrity?.startsWith("sha512-")) {
    return undefined;
  }
  return Buffer.from(integrity.slice("sha512-".length), "base64").toString(
    "hex",
  );
};

const requiredString = (
  value: string | undefined,
  field: string,
): string => {
  if (!value?.trim()) {
    throw new Error(`Release package ${field} must be a non-empty string`);
  }
  return value;
};

const assertFrozenRootGraph = (
  manifest: PackageManifest,
  lock: BunLock,
): void => {
  if (lock.lockfileVersion !== 1) {
    throw new Error(
      `Unsupported Bun lockfile version: ${lock.lockfileVersion ?? "missing"}`,
    );
  }
  const workspace = lock.workspaces?.[""];
  if (!workspace) {
    throw new Error("Bun lock is missing its root workspace");
  }

  for (const field of [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
  ] as const) {
    const declared = manifest[field] ?? {};
    const locked = workspace[field] ?? {};
    const declaredEntries = Object.entries(declared).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    const lockedEntries = Object.entries(locked).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    if (JSON.stringify(declaredEntries) !== JSON.stringify(lockedEntries)) {
      throw new Error(
        `Release package ${field} do not match the frozen Bun lock root`,
      );
    }
  }

  const declaredOptionalPeers = Object.entries(
    manifest.peerDependenciesMeta ?? {},
  )
    .filter(([, metadata]) => metadata.optional === true)
    .map(([name]) => name)
    .sort();
  const lockedOptionalPeers = [...(workspace.optionalPeers ?? [])].sort();
  if (
    JSON.stringify(declaredOptionalPeers) !==
    JSON.stringify(lockedOptionalPeers)
  ) {
    throw new Error(
      "Release package optional peers do not match the frozen Bun lock root",
    );
  }
};

const lockPackages = (lock: BunLock): ResolvedLockPackage[] => {
  if (!lock.packages) {
    throw new Error("Bun lock does not contain package resolutions");
  }

  return Object.values(lock.packages).map((entry) => {
    if (!Array.isArray(entry) || typeof entry[0] !== "string") {
      throw new Error("Bun lock contains an invalid package resolution");
    }
    const identity = packageIdentity(entry[0]);
    return {
      ...identity,
      metadata: entry[2] ?? {},
      integrity: entry[3],
    };
  });
};

const resolveLockedPackage = (
  packages: ResolvedLockPackage[],
  name: string,
  range: string,
): ResolvedLockPackage => {
  const matches = packages.filter((entry) => {
    if (entry.name !== name) {
      return false;
    }
    try {
      return Bun.semver.satisfies(entry.version, range);
    } catch {
      return false;
    }
  });

  if (matches.length === 0) {
    throw new Error(`Frozen Bun lock does not resolve ${name}@${range}`);
  }
  if (matches.length > 1) {
    throw new Error(`Frozen Bun lock resolves ${name}@${range} ambiguously`);
  }
  const [match] = matches;
  if (!match) {
    throw new Error(`Frozen Bun lock does not resolve ${name}@${range}`);
  }
  return match;
};

const componentFor = (
  resolved: ResolvedLockPackage,
  range: string,
  scope: DependencyScope,
  kind: "dependency" | "optionalDependency" | "peerDependency",
): CycloneDxComponent => {
  const purl = packagePurl(resolved.name, resolved.version);
  const hash = sha512Hex(resolved.integrity);
  return {
    "bom-ref": purl,
    type: "library",
    name: resolved.name,
    version: resolved.version,
    purl,
    scope,
    properties: [
      { name: "tusk:declared-range", value: range },
      { name: "tusk:dependency-kind", value: kind },
    ],
    ...(hash ? { hashes: [{ alg: "SHA-512" as const, content: hash }] } : {}),
  };
};

export const buildReleaseSbom = (
  manifest: PackageManifest,
  lock: BunLock,
) => {
  const name = requiredString(manifest.name, "name");
  const version = requiredString(manifest.version, "version");
  assertFrozenRootGraph(manifest, lock);

  const resolvedPackages = lockPackages(lock);
  const components = new Map<string, CycloneDxComponent>();
  const dependencyEdges = new Map<string, Set<string>>();
  const processedScope = new Map<string, DependencyScope>();

  const visit = (
    dependencyName: string,
    range: string,
    scope: DependencyScope,
    kind: "dependency" | "optionalDependency" | "peerDependency",
  ): string => {
    const resolved = resolveLockedPackage(
      resolvedPackages,
      dependencyName,
      range,
    );
    const reference = packagePurl(resolved.name, resolved.version);
    const existing = components.get(reference);
    if (!existing) {
      components.set(reference, componentFor(resolved, range, scope, kind));
    } else {
      if (scope === "required") {
        existing.scope = "required";
      }
      if (
        !existing.properties.some(
          (property) =>
            property.name === "tusk:declared-range" &&
            property.value === range,
        )
      ) {
        existing.properties.push({
          name: "tusk:declared-range",
          value: range,
        });
      }
      if (
        !existing.properties.some(
          (property) =>
            property.name === "tusk:dependency-kind" &&
            property.value === kind,
        )
      ) {
        existing.properties.push({
          name: "tusk:dependency-kind",
          value: kind,
        });
      }
    }

    const previousScope = processedScope.get(reference);
    if (previousScope === "required" || previousScope === scope) {
      return reference;
    }
    processedScope.set(reference, scope);

    const edges = dependencyEdges.get(reference) ?? new Set<string>();
    dependencyEdges.set(reference, edges);
    for (const [childName, childRange] of Object.entries(
      resolved.metadata.dependencies ?? {},
    )) {
      edges.add(visit(childName, childRange, scope, "dependency"));
    }
    for (const [childName, childRange] of Object.entries(
      resolved.metadata.optionalDependencies ?? {},
    )) {
      edges.add(
        visit(childName, childRange, "optional", "optionalDependency"),
      );
    }
    return reference;
  };

  const rootReference = packagePurl(name, version);
  const rootEdges = new Set<string>();
  dependencyEdges.set(rootReference, rootEdges);
  for (const [dependencyName, range] of Object.entries(
    manifest.dependencies ?? {},
  )) {
    rootEdges.add(visit(dependencyName, range, "required", "dependency"));
  }
  for (const [dependencyName, range] of Object.entries(
    manifest.optionalDependencies ?? {},
  )) {
    rootEdges.add(
      visit(dependencyName, range, "optional", "optionalDependency"),
    );
  }
  for (const [dependencyName, range] of Object.entries(
    manifest.peerDependencies ?? {},
  )) {
    const scope =
      manifest.peerDependenciesMeta?.[dependencyName]?.optional === true
        ? "optional"
        : "required";
    rootEdges.add(visit(dependencyName, range, scope, "peerDependency"));
  }

  const rootComponent: CycloneDxComponent = {
    "bom-ref": rootReference,
    type: "library",
    name,
    version,
    purl: rootReference,
    properties: [
      {
        name: "tusk:source-lockfile",
        value: `bun.lock v${lock.lockfileVersion ?? "unknown"}`,
      },
    ],
    ...(manifest.license
      ? { licenses: [{ expression: manifest.license }] }
      : {}),
  };

  return {
    $schema: "https://cyclonedx.org/schema/bom-1.6.schema.json",
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: {
      tools: {
        components: [
          {
            type: "application",
            name: "Tusk deterministic release SBOM generator",
            version: "1",
          },
        ],
      },
      component: rootComponent,
    },
    components: [...components.values()].sort((left, right) =>
      left.purl.localeCompare(right.purl),
    ),
    dependencies: [...dependencyEdges.entries()]
      .map(([reference, edges]) => ({
        ref: reference,
        dependsOn: [...edges].sort(),
      }))
      .sort((left, right) => left.ref.localeCompare(right.ref)),
  };
};

export const generateReleaseSbom = async (
  packageJsonPath: string,
  bunLockPath: string,
  outputPath: string,
): Promise<void> => {
  const [packageJson, bunLock] = await Promise.all([
    readFile(packageJsonPath, "utf8"),
    readFile(bunLockPath, "utf8"),
  ]);
  const sbom = buildReleaseSbom(
    JSON.parse(packageJson) as PackageManifest,
    parseBunLock(bunLock),
  );
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(sbom, null, 2)}\n`, "utf8");
};

export const parseBunLock = (source: string): BunLock => {
  const jsonc = (
    Bun as unknown as { JSONC?: { parse: (value: string) => unknown } }
  ).JSONC;
  if (!jsonc) {
    throw new Error("This Bun runtime does not support JSONC parsing");
  }
  return jsonc.parse(source) as BunLock;
};

if (import.meta.main) {
  const [packageJsonPath, bunLockPath, outputPath] = process.argv.slice(2);
  if (!packageJsonPath || !bunLockPath || !outputPath) {
    throw new Error(
      "Usage: bun scripts/generate-release-sbom.ts <package.json> <bun.lock> <output.json>",
    );
  }
  await generateReleaseSbom(packageJsonPath, bunLockPath, outputPath);
}
