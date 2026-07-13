import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  buildReleaseSbom,
  parseBunLock,
} from "./generate-release-sbom";

const integrity = (value: string) =>
  `sha512-${Buffer.from(value).toString("base64")}`;

const manifest = {
  name: "@bydey/tusk",
  version: "1.0.0",
  license: "MIT",
  dependencies: { dotenv: "^17.2.3" },
  optionalDependencies: { optional: "^2.0.0" },
  peerDependencies: { peer: "^4.0.0", requiredPeer: "^5.0.0" },
  peerDependenciesMeta: { peer: { optional: true } },
};

const lock = {
  lockfileVersion: 1,
  workspaces: {
    "": {
      dependencies: { dotenv: "^17.2.3" },
      optionalDependencies: { optional: "^2.0.0" },
      peerDependencies: { peer: "^4.0.0", requiredPeer: "^5.0.0" },
      optionalPeers: ["peer"],
    },
  },
  packages: {
    dotenv: [
      "dotenv@17.2.3",
      "",
      { dependencies: { transitive: "~3.1.0" } },
      integrity("dotenv"),
    ],
    optional: [
      "optional@2.4.0",
      "",
      { optionalDependencies: { optionalChild: "^6.0.0" } },
      integrity("optional"),
    ],
    optionalChild: [
      "optionalChild@6.1.0",
      "",
      {},
      integrity("optionalChild"),
    ],
    peer: ["peer@4.2.0", "", {}, integrity("peer")],
    requiredPeer: [
      "requiredPeer@5.1.0",
      "",
      {},
      integrity("requiredPeer"),
    ],
    transitive: ["transitive@3.1.2", "", {}, integrity("transitive")],
  },
} as const;

describe("release SBOM generation", () => {
  test("builds a deterministic graph from the frozen Bun lock", () => {
    const first = buildReleaseSbom(manifest, lock);
    const second = buildReleaseSbom(manifest, lock);
    const root = first.metadata.component;
    const dotenv = first.components.find(
      (component) => component.name === "dotenv",
    );
    const optional = first.components.find(
      (component) => component.name === "optional",
    );
    const transitive = first.components.find(
      (component) => component.name === "transitive",
    );
    const optionalChild = first.components.find(
      (component) => component.name === "optionalChild",
    );
    const peer = first.components.find(
      (component) => component.name === "peer",
    );
    const requiredPeer = first.components.find(
      (component) => component.name === "requiredPeer",
    );

    expect(second).toEqual(first);
    expect(root).toMatchObject({
      name: "@bydey/tusk",
      version: "1.0.0",
      purl: "pkg:npm/%40bydey/tusk@1.0.0",
    });
    expect(dotenv).toMatchObject({
      version: "17.2.3",
      scope: "required",
      hashes: [{
        alg: "SHA-512",
        content: Buffer.from("dotenv").toString("hex"),
      }],
    });
    expect(optional?.scope).toBe("optional");
    expect(optionalChild?.scope).toBe("optional");
    expect(peer?.scope).toBe("optional");
    expect(peer?.properties).toContainEqual({
      name: "tusk:dependency-kind",
      value: "peerDependency",
    });
    expect(requiredPeer?.scope).toBe("required");
    expect(transitive?.scope).toBe("required");
    expect(first.dependencies).toContainEqual({
      ref: root["bom-ref"],
      dependsOn: [
        dotenv?.["bom-ref"],
        optional?.["bom-ref"],
        peer?.["bom-ref"],
        requiredPeer?.["bom-ref"],
      ].sort(),
    });
    expect(first.dependencies).toContainEqual({
      ref: dotenv?.["bom-ref"],
      dependsOn: [transitive?.["bom-ref"]],
    });
    expect(first.dependencies).toContainEqual({
      ref: optional?.["bom-ref"],
      dependsOn: [optionalChild?.["bom-ref"]],
    });
  });

  test("rejects a release manifest that does not match the frozen root", () => {
    expect(() =>
      buildReleaseSbom(
        { ...manifest, dependencies: { dotenv: "^18.0.0" } },
        lock,
      ),
    ).toThrow("do not match the frozen Bun lock root");
  });

  test("rejects ambiguous frozen resolutions", () => {
    expect(() =>
      buildReleaseSbom(manifest, {
        ...lock,
        packages: {
          ...lock.packages,
          "dotenv@17.4.2": ["dotenv@17.4.2", "", {}, integrity("new")],
        },
      }),
    ).toThrow("resolves dotenv@^17.2.3 ambiguously");
  });

  test("rejects unsupported Bun lockfile formats", () => {
    expect(() => buildReleaseSbom(manifest, { ...lock, lockfileVersion: 2 }))
      .toThrow("Unsupported Bun lockfile version: 2");
  });

  test("terminates cyclic dependency graphs", () => {
    const cyclic = buildReleaseSbom(
      {
        name: "cycle-root",
        version: "1.0.0",
        dependencies: { alpha: "^1.0.0" },
      },
      {
        lockfileVersion: 1,
        workspaces: { "": { dependencies: { alpha: "^1.0.0" } } },
        packages: {
          alpha: [
            "alpha@1.0.0",
            "",
            { dependencies: { beta: "^1.0.0" } },
          ],
          beta: [
            "beta@1.0.0",
            "",
            { dependencies: { alpha: "^1.0.0" } },
          ],
        },
      },
    );

    expect(cyclic.components.map((component) => component.name).sort())
      .toEqual(["alpha", "beta"]);
  });

  test("models the real package peers from the frozen repository lock", async () => {
    const [packageJson, bunLock] = await Promise.all([
      readFile("package.json", "utf8"),
      readFile("bun.lock", "utf8"),
    ]);
    const sbom = buildReleaseSbom(
      JSON.parse(packageJson),
      parseBunLock(bunLock),
    );
    const rootEdges = sbom.dependencies.find(
      (dependency) => dependency.ref === sbom.metadata.component["bom-ref"],
    );

    for (const name of ["elysia", "pg", "postgres"]) {
      const component = sbom.components.find((candidate) =>
        candidate.name === name
      );
      expect(component?.scope).toBe("optional");
      expect(component?.properties).toContainEqual({
        name: "tusk:dependency-kind",
        value: "peerDependency",
      });
      expect(rootEdges?.dependsOn).toContain(component?.["bom-ref"]);
    }
  });
});
