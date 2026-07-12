type SemverIdentifier = { numeric: boolean; value: string };

interface ParsedSemver {
  core: [bigint, bigint, bigint];
  prerelease: SemverIdentifier[];
}

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export const parseSemver = (version: string): ParsedSemver => {
  const match = SEMVER_PATTERN.exec(version);
  if (!match || match[1] === undefined || match[2] === undefined || match[3] === undefined) {
    throw new Error(`Invalid semantic version: ${version}`);
  }

  const prerelease = (match[4] ?? "").split(".").filter(Boolean).map((value) => {
    const numeric = /^\d+$/.test(value);
    if (numeric && value.length > 1 && value.startsWith("0")) {
      throw new Error(`Invalid semantic version: ${version}`);
    }
    return { numeric, value };
  });

  return {
    core: [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])],
    prerelease,
  };
};

const compareIdentifiers = (left: SemverIdentifier, right: SemverIdentifier) => {
  if (left.numeric && right.numeric) {
    const leftNumber = BigInt(left.value);
    const rightNumber = BigInt(right.value);
    return leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0;
  }
  if (left.numeric !== right.numeric) return left.numeric ? -1 : 1;
  return left.value < right.value ? -1 : left.value > right.value ? 1 : 0;
};

export const compareSemver = (leftVersion: string, rightVersion: string) => {
  const left = parseSemver(leftVersion);
  const right = parseSemver(rightVersion);

  for (let index = 0; index < left.core.length; index++) {
    const leftNumber = left.core[index]!;
    const rightNumber = right.core[index]!;
    if (leftNumber !== rightNumber) return leftNumber < rightNumber ? -1 : 1;
  }

  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0;
    return left.prerelease.length === 0 ? 1 : -1;
  }

  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index++) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (!leftIdentifier || !rightIdentifier) {
      return leftIdentifier ? 1 : -1;
    }
    const comparison = compareIdentifiers(leftIdentifier, rightIdentifier);
    if (comparison !== 0) return comparison;
  }

  return 0;
};

export const assertReleaseVersionIncreases = (current: string, next: string) => {
  if (compareSemver(next, current) <= 0) {
    throw new Error(`Release version ${next} must be greater than current version ${current}`);
  }
};

if (import.meta.main) {
  const [current, next] = process.argv.slice(2);
  if (!current || !next) {
    throw new Error("Usage: bun scripts/validate-release-version.ts <current> <next>");
  }
  assertReleaseVersionIncreases(current, next);
  console.log(`Release version increases from ${current} to ${next}`);
}
