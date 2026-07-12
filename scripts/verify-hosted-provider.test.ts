import { describe, expect, test } from "bun:test";
import {
  assertSafeConnectionUrl,
  isLocalHostname,
  matchesHostSuffix,
  matchesProviderEndpoint,
  parseArguments,
  redactText,
} from "./verify-hosted-provider";

describe("hosted-provider evidence helpers", () => {
  test("parses an explicit provider and all artifact paths", () => {
    const parsed = parseArguments([
      "--provider", "neon",
      "--cli", ".tmp/consumer/tusk",
      "--artifact", ".tmp/tusk.tgz",
      "--output", ".tmp/evidence.json",
    ]);

    expect(parsed.provider).toBe("neon");
    expect(parsed.cliPath).toEndWith("/.tmp/consumer/tusk");
    expect(parsed.artifactPath).toEndWith("/.tmp/tusk.tgz");
    expect(parsed.outputPath).toEndWith("/.tmp/evidence.json");
  });

  test("rejects unsupported providers and incomplete path arguments", () => {
    expect(() => parseArguments([
      "--provider", "postgres",
      "--cli", "cli",
      "--artifact", "artifact",
      "--output", "output",
    ])).toThrow("Unsupported hosted provider");
    expect(() => parseArguments([
      "--provider", "rds",
      "--cli", "cli",
    ])).toThrow("--artifact is required");
  });

  test("matches only the expected hostname or a true subdomain", () => {
    expect(matchesHostSuffix("db.example.com", "example.com")).toBe(true);
    expect(matchesHostSuffix("example.com", ".example.com")).toBe(true);
    expect(matchesHostSuffix("example.com.evil.test", "example.com")).toBe(false);
    expect(matchesHostSuffix("notexample.com", "example.com")).toBe(false);
  });

  test("recognizes only provider-specific endpoint families", () => {
    expect(matchesProviderEndpoint("neon", "ep-test.us-east-2.aws.neon.tech")).toBe(true);
    expect(matchesProviderEndpoint("supabase", "db.project.supabase.co")).toBe(true);
    expect(matchesProviderEndpoint("supabase", "aws-0-us-east-1.pooler.supabase.com")).toBe(true);
    expect(matchesProviderEndpoint("rds", "app.abc.us-east-1.rds.amazonaws.com")).toBe(true);
    expect(matchesProviderEndpoint("aurora", "cluster.abc.us-east-1.rds.amazonaws.com")).toBe(true);
    expect(matchesProviderEndpoint("rds", "ep-test.aws.neon.tech")).toBe(false);
  });

  test("recognizes local targets and redacts PostgreSQL credentials", () => {
    expect(isLocalHostname("localhost")).toBe(true);
    expect(isLocalHostname("127.0.0.1")).toBe(true);
    expect(isLocalHostname("db.example.com")).toBe(false);
    expect(
      redactText("failed at postgresql://user:secret@db.example.com/app?sslmode=require")
    ).toBe("failed at postgresql://[REDACTED]");
  });

  test("rejects connection routing overrides and duplicate TLS modes", () => {
    expect(() => assertSafeConnectionUrl(
      new URL("postgres://u:p@valid.neon.tech/db?host=other.example&sslmode=verify-full"),
      false
    )).toThrow("cannot override host");
    expect(() => assertSafeConnectionUrl(
      new URL("postgres://u:p@valid.neon.tech/db?sslmode=verify-full&sslmode=no-verify"),
      false
    )).toThrow("exactly one sslmode=verify-full");
    expect(() => assertSafeConnectionUrl(
      new URL("https://valid.neon.tech/db?sslmode=verify-full"),
      false
    )).toThrow("postgres or postgresql URL");
    expect(() => assertSafeConnectionUrl(
      new URL("postgresql://u:p@valid.neon.tech/db?sslmode=verify-full"),
      false
    )).not.toThrow();
  });
});
