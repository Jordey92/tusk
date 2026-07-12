import { describe, expect, test } from "bun:test";
import {
  assertReleaseVersionIncreases,
  compareSemver,
  parseSemver,
} from "./validate-release-version";

describe("release version validation", () => {
  test("compares stable and prerelease versions using SemVer precedence", () => {
    expect(compareSemver("1.0.0", "1.0.0-rc.1")).toBe(1);
    expect(compareSemver("1.0.0-rc.2", "1.0.0-rc.10")).toBe(-1);
    expect(compareSemver("2.0.0+build.1", "1.99.99")).toBe(1);
  });

  test("requires the next release to increase", () => {
    expect(() => assertReleaseVersionIncreases("1.0.0", "1.0.1")).not.toThrow();
    expect(() => assertReleaseVersionIncreases("1.0.0", "1.0.0")).toThrow(
      "must be greater"
    );
    expect(() => assertReleaseVersionIncreases("1.0.0", "0.9.0")).toThrow(
      "must be greater"
    );
  });

  test("rejects invalid SemVer and leading zero identifiers", () => {
    expect(() => parseSemver("v1.0.0")).toThrow("Invalid semantic version");
    expect(() => parseSemver("1.0.0-01")).toThrow("Invalid semantic version");
  });
});
