import { describe, expect, test } from "bun:test";
import type { DoctorCheck } from "../../types/doctor";
import {
  checkDatabaseEngine,
  parseMajorVersion,
  parseMajorVersionFromRawVersion,
  SUPPORTED_POSTGRES_MAJOR,
} from "./engine";

describe("parseMajorVersion", () => {
  test("prefers server_version_num when present", () => {
    expect(parseMajorVersion("16.2", "160002")).toBe(16);
  });

  test("falls back to server_version text", () => {
    expect(parseMajorVersion("15.4 (Debian)", null)).toBe(15);
  });

  test("returns undefined when neither value is usable", () => {
    expect(parseMajorVersion(null, null)).toBeUndefined();
    expect(parseMajorVersion("not-a-version", "abc")).toBeUndefined();
  });
});

describe("parseMajorVersionFromRawVersion", () => {
  test("reads a PostgreSQL version() string", () => {
    expect(
      parseMajorVersionFromRawVersion(
        "PostgreSQL 14.12 on x86_64-pc-linux-gnu"
      )
    ).toBe(14);
  });

  test("returns undefined for non-PostgreSQL banners", () => {
    expect(parseMajorVersionFromRawVersion("Redshift 8.0")).toBeUndefined();
  });
});

describe("checkDatabaseEngine", () => {
  test("marks supported PostgreSQL as supported", () => {
    const checks: DoctorCheck[] = [];
    const engine = checkDatabaseEngine(checks, {
      engine: "postgresql",
      provider: "postgresql",
      serverVersion: "16.2",
      majorVersion: 16,
      rawVersion: "PostgreSQL 16.2",
    });

    expect(engine).toMatchObject({
      state: "supported",
      majorVersion: 16,
      provider: "postgresql",
    });
    expect(checks.map((check) => check.id)).toEqual([
      "database.engine",
      "database.version",
    ]);
    expect(checks.every((check) => check.status === "pass")).toBe(true);
  });

  test("fails Redshift and unknown engines", () => {
    const redshiftChecks: DoctorCheck[] = [];
    expect(
      checkDatabaseEngine(redshiftChecks, {
        engine: "redshift",
        provider: "redshift",
        rawVersion: "PostgreSQL 8.0",
      })
    ).toMatchObject({
      state: "unsupported",
      reason: "unsupported_provider",
      provider: "redshift",
    });

    const unknownChecks: DoctorCheck[] = [];
    expect(
      checkDatabaseEngine(unknownChecks, {
        engine: "unknown",
        provider: "unknown",
        rawVersion: "Something Else",
      })
    ).toMatchObject({
      state: "unsupported",
      reason: "unsupported_provider",
      provider: "unknown",
    });
  });

  test("fails versions below the supported floor", () => {
    const checks: DoctorCheck[] = [];
    const engine = checkDatabaseEngine(checks, {
      engine: "postgresql",
      provider: "postgresql",
      serverVersion: "12.0",
      majorVersion: 12,
      rawVersion: "PostgreSQL 12.0",
    });

    expect(engine).toMatchObject({
      state: "unsupported",
      reason: "version_below_floor",
      supportedFloor: SUPPORTED_POSTGRES_MAJOR,
      majorVersion: 12,
    });
    expect(
      checks.find((check) => check.id === "database.version")?.status
    ).toBe("fail");
  });
});
