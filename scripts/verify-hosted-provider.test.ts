import { describe, expect, test } from "bun:test";
import type { PeerCertificate } from "node:tls";
import type { Pool } from "pg";
import {
  assertSafeConnectionUrl,
  inspectClientTls,
  isLocalHostname,
  matchesHostSuffix,
  matchesProviderEndpoint,
  parseArguments,
  publicObjects,
  redactText,
} from "./verify-hosted-provider";

const peerCertificate = (hostname = "valid.neon.tech") => ({
  subject: { CN: hostname },
  subjectaltname: `DNS:${hostname}`,
}) as PeerCertificate;

const tlsClient = (overrides: Record<string, unknown> = {}) => ({
  connection: {
    stream: {
      authorized: true,
      authorizationError: null,
      destroyed: false,
      encrypted: true,
      getCipher: () => ({
        name: "TLS_AES_256_GCM_SHA384",
        standardName: "TLS_AES_256_GCM_SHA384",
      }),
      getPeerCertificate: () => peerCertificate(),
      getProtocol: () => "TLSv1.3",
      ...overrides,
    },
  },
  query: async () => ({ rows: [] }),
});

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

  test("proves TLS from the connected pg stream without server-side statistics", () => {
    expect(inspectClientTls(tlsClient(), "valid.neon.tech", false)).toEqual({
      tls: true,
      tlsCipher: "TLS_AES_256_GCM_SHA384",
      tlsVersion: "TLSv1.3",
    });
  });

  test("rejects plaintext and unauthorized hosted-provider streams", () => {
    expect(() => inspectClientTls(tlsClient({ encrypted: false }), "valid.neon.tech", false))
      .toThrow("client-side TLS connection");
    expect(() => inspectClientTls(tlsClient({ authorized: false }), "valid.neon.tech", false))
      .toThrow("authorized TLS peer certificate");
    expect(() => inspectClientTls(
      tlsClient({ authorizationError: new Error("certificate rejected") }),
      "valid.neon.tech",
      false
    )).toThrow("authorized TLS peer certificate");
    expect(inspectClientTls(tlsClient({ encrypted: false }), "localhost", true).tls).toBe(false);
  });

  test("rejects stale, incomplete, and wrong-host TLS streams", () => {
    expect(() => inspectClientTls(tlsClient({ destroyed: true }), "valid.neon.tech", false))
      .toThrow("live TLS connection");
    expect(() => inspectClientTls(
      tlsClient({ getPeerCertificate: () => ({}) }),
      "valid.neon.tech",
      false
    )).toThrow("live TLS peer certificate");
    expect(() => inspectClientTls(
      tlsClient({ getProtocol: () => null }),
      "valid.neon.tech",
      false
    )).toThrow("negotiated TLS protocol and cipher details");
    expect(() => inspectClientTls(
      tlsClient({ getPeerCertificate: () => peerCertificate("other.neon.tech") }),
      "valid.neon.tech",
      false
    )).toThrow("does not match the expected hostname");
  });

  test("excludes only default ACL dependencies from the public object inventory", async () => {
    let query = "";
    const pool = {
      query: async (sql: string) => {
        query = sql;
        return {
          rows: [
            { object_identity: "pg_class:public.accounts" },
            { object_identity: "pg_proc:public.refresh_accounts()" },
            { object_identity: "pg_type:public.account_state" },
            { object_identity: "pg_constraint:accounts_pkey on public.accounts" },
          ],
        };
      },
    } as unknown as Pool;

    expect(await publicObjects(pool)).toEqual([
      "pg_class:public.accounts",
      "pg_proc:public.refresh_accounts()",
      "pg_type:public.account_state",
      "pg_constraint:accounts_pkey on public.accounts",
    ]);
    expect(query).toContain("FROM pg_depend");
    expect(query).toContain("pg_identify_object(d.classid, d.objid, d.objsubid)");
    expect(query).toContain("d.classid <> 'pg_default_acl'::regclass");
    expect(query).not.toContain("d.classid IN");
  });
});
