import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { checkServerIdentity, type PeerCertificate } from "node:tls";
import { Pool, type Connection, type PoolClient } from "pg";

export const supportedHostedProviders = ["neon", "supabase", "rds", "aurora"] as const;
export type HostedProvider = typeof supportedHostedProviders[number];

interface ParsedArguments {
  artifactPath: string;
  cliPath: string;
  outputPath: string;
  provider: HostedProvider;
}

interface CommandRun {
  command: string;
  exitCode: number;
  payload: Record<string, unknown>;
  assertions: string[];
}

interface CommandEvidence {
  command: string;
  exitCode: number;
  ok: boolean;
  assertions: string[];
  result: Record<string, unknown>;
  stderrPresent: boolean;
}

export interface HostedConfiguration {
  connectionString: string;
  expectedDatabase: string;
  expectedDoctorProvider: "postgresql" | "aurora-postgresql";
  expectedHostSuffix: string;
  guardToken: string;
  localTestOverride: boolean;
  provider: HostedProvider;
  region: string;
  runId: string;
  targetLabel: string;
}

const confirmationFor = (provider: HostedProvider) =>
  `RUN DISPOSABLE ${provider}`;

export const parseArguments = (args: string[]): ParsedArguments => {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith("--") || !value) {
      throw new Error(
        "Usage: bun scripts/verify-hosted-provider.ts --provider <provider> --cli <path> --artifact <tgz> --output <json>"
      );
    }
    values.set(flag, value);
  }

  const provider = values.get("--provider");
  if (!supportedHostedProviders.includes(provider as HostedProvider)) {
    throw new Error(`Unsupported hosted provider: ${provider ?? "missing"}`);
  }

  const requiredPath = (flag: string) => {
    const value = values.get(flag)?.trim();
    if (!value) throw new Error(`${flag} is required`);
    return resolve(value);
  };

  return {
    provider: provider as HostedProvider,
    cliPath: requiredPath("--cli"),
    artifactPath: requiredPath("--artifact"),
    outputPath: requiredPath("--output"),
  };
};

export const redactText = (value: string) => value
  .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgresql://[REDACTED]")
  .replace(/(password|passwd|pwd)=([^\s&;]+)/gi, "$1=[REDACTED]");

export const isLocalHostname = (hostname: string) =>
  hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.");

export const matchesHostSuffix = (hostname: string, suffix: string) => {
  const normalizedHost = hostname.toLowerCase().replace(/\.$/, "");
  const normalizedSuffix = suffix.toLowerCase().replace(/^\./, "").replace(/\.$/, "");
  return normalizedHost === normalizedSuffix || normalizedHost.endsWith(`.${normalizedSuffix}`);
};

export const matchesProviderEndpoint = (
  provider: HostedProvider,
  hostname: string
) => {
  if (provider === "neon") return matchesHostSuffix(hostname, "neon.tech");
  if (provider === "supabase") {
    return (
      matchesHostSuffix(hostname, "supabase.co") ||
      matchesHostSuffix(hostname, "supabase.com")
    );
  }
  return (
    matchesHostSuffix(hostname, "rds.amazonaws.com") ||
    matchesHostSuffix(hostname, "rds.amazonaws.com.cn")
  );
};

const connectionOverrideKeys = new Set([
  "database",
  "dbname",
  "host",
  "hostaddr",
  "options",
  "passfile",
  "password",
  "port",
  "service",
  "servicefile",
  "ssl",
  "user",
  "username",
]);

export const assertSafeConnectionUrl = (
  targetUrl: URL,
  localTestOverride: boolean
) => {
  if (targetUrl.protocol !== "postgres:" && targetUrl.protocol !== "postgresql:") {
    throw new Error("Hosted evidence requires a postgres or postgresql URL");
  }
  for (const key of targetUrl.searchParams.keys()) {
    if (connectionOverrideKeys.has(key.toLowerCase())) {
      throw new Error(`Hosted evidence URL cannot override ${key} in query parameters`);
    }
  }
  const sslModes = targetUrl.searchParams.getAll("sslmode");
  if (!localTestOverride && (sslModes.length !== 1 || sslModes[0] !== "verify-full")) {
    throw new Error("Hosted evidence requires exactly one sslmode=verify-full parameter");
  }
};

const sha256 = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

const quoteIdentifier = (identifier: string) =>
  `"${identifier.replaceAll('"', '""')}"`;

const requireEnvironment = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const sanitizeRunId = (value: string) => {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 48);
  if (!/^[a-z][a-z0-9_]+$/.test(normalized)) {
    throw new Error("TUSK_HOSTED_RUN_ID must normalize to a PostgreSQL-safe identifier");
  }
  return normalized;
};

export const loadConfiguration = (provider: HostedProvider): HostedConfiguration => {
  const connectionString = requireEnvironment("TUSK_HOSTED_DATABASE_URL");
  const expectedDatabase = requireEnvironment("TUSK_HOSTED_EXPECTED_DATABASE");
  const expectedHostSuffix = requireEnvironment("TUSK_HOSTED_EXPECTED_HOST_SUFFIX");
  const expectedDoctorProvider = requireEnvironment("TUSK_HOSTED_EXPECTED_DOCTOR_PROVIDER");
  const guardToken = requireEnvironment("TUSK_HOSTED_GUARD_TOKEN");
  const region = requireEnvironment("TUSK_HOSTED_REGION");
  const targetLabel = requireEnvironment("TUSK_HOSTED_TARGET_LABEL");
  const confirmation = requireEnvironment("TUSK_HOSTED_CONFIRM_DISPOSABLE");
  const localTestOverride = process.env.TUSK_HOSTED_ALLOW_LOCAL_FOR_TESTS === "1";

  if (confirmation !== confirmationFor(provider)) {
    throw new Error(`Confirmation must be exactly: ${confirmationFor(provider)}`);
  }
  if (guardToken.length < 32) {
    throw new Error("TUSK_HOSTED_GUARD_TOKEN must contain at least 32 characters");
  }
  if (expectedDoctorProvider !== "postgresql" && expectedDoctorProvider !== "aurora-postgresql") {
    throw new Error("TUSK_HOSTED_EXPECTED_DOCTOR_PROVIDER must be postgresql or aurora-postgresql");
  }
  if (provider === "aurora" && expectedDoctorProvider !== "aurora-postgresql") {
    throw new Error("Aurora evidence must require doctor provider aurora-postgresql");
  }
  if (provider !== "aurora" && expectedDoctorProvider !== "postgresql") {
    throw new Error(`${provider} evidence must require doctor provider postgresql`);
  }

  const targetUrl = new URL(connectionString);
  assertSafeConnectionUrl(targetUrl, localTestOverride);
  if (isLocalHostname(targetUrl.hostname) && !localTestOverride) {
    throw new Error("Hosted-provider evidence cannot target a local database");
  }
  if (!localTestOverride && !matchesHostSuffix(targetUrl.hostname, expectedHostSuffix)) {
    throw new Error("Database hostname does not match TUSK_HOSTED_EXPECTED_HOST_SUFFIX");
  }
  if (!localTestOverride && !matchesProviderEndpoint(provider as HostedProvider, targetUrl.hostname)) {
    throw new Error(`Database hostname is not a recognized ${provider} endpoint`);
  }
  if (decodeURIComponent(targetUrl.pathname.replace(/^\//, "")) !== expectedDatabase) {
    throw new Error("Database URL does not target TUSK_HOSTED_EXPECTED_DATABASE");
  }
  if (provider === "neon" && targetUrl.hostname.includes("-pooler")) {
    throw new Error("Neon evidence requires a direct, non-pooler endpoint");
  }
  if (provider === "supabase" && (targetUrl.port || "5432") === "6543") {
    throw new Error("Supabase evidence cannot use the transaction-pooler port 6543");
  }

  return {
    connectionString,
    expectedDatabase,
    expectedDoctorProvider,
    expectedHostSuffix,
    guardToken,
    localTestOverride,
    provider,
    region,
    runId: sanitizeRunId(
      process.env.TUSK_HOSTED_RUN_ID ?? `tusk_v1_${randomUUID().replaceAll("-", "")}`
    ),
    targetLabel,
  };
};

export const publicObjects = async (pool: Pool) => {
  const result = await pool.query<{ object_identity: string }>(`
    SELECT
      d.classid::regclass::text || ':' ||
      (pg_identify_object(d.classid, d.objid, d.objsubid)).identity AS object_identity
    FROM pg_depend d
    WHERE d.refclassid = 'pg_namespace'::regclass
      AND d.refobjid = 'public'::regnamespace
      AND d.classid <> 'pg_default_acl'::regclass
  `);
  return result.rows.map((row) => row.object_identity);
};

interface PgTlsStream {
  authorized?: boolean;
  authorizationError?: Error | string | null;
  destroyed?: boolean;
  encrypted?: boolean;
  getCipher?: () => {
    name?: string;
    standardName?: string;
    version?: string;
  } | null;
  getPeerCertificate?: () => PeerCertificate;
  getProtocol?: () => string | null;
}

export const inspectClientTls = (
  client: Pick<PoolClient, "query"> & { connection?: Pick<Connection, "stream"> },
  expectedHostname: string,
  localTestOverride: boolean
) => {
  const stream = client.connection?.stream as PgTlsStream | undefined;
  const tls = stream?.encrypted === true;
  if (localTestOverride && !tls) {
    return { tls: false, tlsCipher: null, tlsVersion: null };
  }
  if (!tls) {
    throw new Error("Hosted-provider evidence requires a client-side TLS connection");
  }
  if (stream.destroyed !== false) {
    throw new Error("Hosted-provider evidence requires a live TLS connection");
  }
  if (stream.authorized !== true || stream.authorizationError) {
    throw new Error("Hosted-provider evidence requires an authorized TLS peer certificate");
  }
  const certificate = stream.getPeerCertificate?.();
  if (!certificate || Object.keys(certificate).length === 0) {
    throw new Error("Hosted-provider evidence requires a live TLS peer certificate");
  }
  const hostnameError = checkServerIdentity(expectedHostname, certificate);
  if (hostnameError) {
    throw new Error("Hosted-provider TLS certificate does not match the expected hostname");
  }
  const cipher = stream.getCipher?.();
  const tlsCipher = cipher?.standardName ?? cipher?.name;
  const tlsVersion = stream.getProtocol?.();
  if (!tlsCipher || !tlsVersion || !/^TLSv1\.[23]$/.test(tlsVersion)) {
    throw new Error("Hosted-provider evidence requires negotiated TLS protocol and cipher details");
  }
  return {
    tls: true,
    tlsCipher,
    tlsVersion,
  };
};

const assertGuard = async (pool: Pool, config: HostedConfiguration) => {
  const client = await pool.connect() as PoolClient & { connection: Connection };
  try {
    const expectedHostname = new URL(config.connectionString).hostname;
    const tls = inspectClientTls(client, expectedHostname, config.localTestOverride);
    const identity = await client.query<{
    can_mutate_guard: boolean;
    can_select_guard: boolean;
    database_name: string;
    in_recovery: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolreplication: boolean;
    rolsuper: boolean;
    server_version: string;
  }>(`
    SELECT
      current_database() AS database_name,
      pg_is_in_recovery() AS in_recovery,
      role.rolsuper,
      role.rolcreatedb,
      role.rolcreaterole,
      role.rolreplication,
      has_table_privilege(current_user, 'tusk_evidence_guard.target', 'SELECT') AS can_select_guard,
      (
        has_table_privilege(current_user, 'tusk_evidence_guard.target', 'INSERT') OR
        has_table_privilege(current_user, 'tusk_evidence_guard.target', 'UPDATE') OR
        has_table_privilege(current_user, 'tusk_evidence_guard.target', 'DELETE') OR
        has_table_privilege(current_user, 'tusk_evidence_guard.target', 'TRUNCATE')
      ) AS can_mutate_guard,
      current_setting('server_version') AS server_version
    FROM pg_roles role
    WHERE role.rolname = current_user
  `);
    const row = identity.rows[0];
    if (!row || row.database_name !== config.expectedDatabase) {
      throw new Error("Guard preflight resolved an unexpected database");
    }
    if (row.in_recovery) throw new Error("Hosted evidence requires a writable primary endpoint");
    if (!config.localTestOverride && (row.rolsuper || row.rolcreatedb || row.rolcreaterole || row.rolreplication)) {
      throw new Error("Hosted evidence role has unsafe cluster-level privileges");
    }
    if (!row.can_select_guard) throw new Error("Hosted evidence role cannot read the guard marker");
    if (!config.localTestOverride && row.can_mutate_guard) {
      throw new Error("Hosted evidence role must not be able to modify the guard marker");
    }

    const guard = await client.query(
      "SELECT 1 FROM tusk_evidence_guard.target WHERE guard_token = $1",
      [config.guardToken]
    );
    if (guard.rowCount !== 1) throw new Error("Hosted evidence guard token did not match");

    return {
      serverVersion: row.server_version,
      ...tls,
    };
  } finally {
    client.release();
  }
};

const assertSessionLocks = async (pool: Pool, lockId: number) => {
  const first = await pool.connect();
  const second = await pool.connect();
  try {
    const acquired = await first.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS acquired",
      [lockId]
    );
    if (!acquired.rows[0]?.acquired) throw new Error("First lock connection could not acquire the advisory lock");

    const excluded = await second.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS acquired",
      [lockId]
    );
    if (excluded.rows[0]?.acquired) throw new Error("Second lock connection was not excluded");

    const unlocked = await first.query<{ unlocked: boolean }>(
      "SELECT pg_advisory_unlock($1) AS unlocked",
      [lockId]
    );
    if (!unlocked.rows[0]?.unlocked) throw new Error("First lock connection could not release its advisory lock");

    const reacquired = await second.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS acquired",
      [lockId]
    );
    if (!reacquired.rows[0]?.acquired) throw new Error("Second lock connection could not acquire after release");
    const secondUnlock = await second.query<{ unlocked: boolean }>(
      "SELECT pg_advisory_unlock($1) AS unlocked",
      [lockId]
    );
    if (!secondUnlock.rows[0]?.unlocked) throw new Error("Second lock connection could not release its advisory lock");
  } finally {
    first.release();
    second.release();
  }
};

const summarizePayload = (payload: Record<string, unknown>) => {
  const commandError = payload.error as Record<string, unknown> | undefined;
  if (payload.ok === false && commandError) {
    return {
      error: {
        code: commandError.code,
      },
    };
  }
  const command = payload.command;
  if (command === "doctor") {
    const database = payload.database as Record<string, unknown> | undefined;
    const engine = database?.engine as Record<string, unknown> | undefined;
    const checks = Array.isArray(payload.checks) ? payload.checks as Array<Record<string, unknown>> : [];
    const lock = checks.find((check) => check.id === "database.advisoryLock");
    return {
      result: payload.result,
      provider: engine?.provider,
      serverVersion: engine?.serverVersion,
      advisoryLock: lock?.status,
      issues: checks
        .filter((check) => check.status === "fail" || check.status === "warn")
        .map((check) => ({
          id: check.id,
          status: check.status,
        })),
    };
  }
  if (command === "validate") return { summary: payload.summary };
  if (command === "status") return { summary: payload.summary };
  if (command === "create") return {
    upFile: basename(String(payload.upFile ?? "")),
    downFile: basename(String(payload.downFile ?? "")),
  };
  if (command === "init") return {
    created: payload.created,
    fromDb: payload.fromDb,
    tableCount: payload.tableCount,
    markedAsExecuted: payload.markedAsExecuted,
  };
  if (command === "up" || command === "down") {
    const migrations = Array.isArray(payload.migrations) ? payload.migrations as Array<Record<string, unknown>> : undefined;
    return {
      direction: payload.direction,
      dryRun: payload.dryRun,
      executed: payload.executed,
      pending: payload.pending,
      migrationCount: migrations?.length,
      migrations: migrations?.map((migration) => migration.filename),
    };
  }
  return {};
};

const toEvidence = (run: CommandRun, stderrPresent: boolean): CommandEvidence => ({
  command: run.command,
  exitCode: run.exitCode,
  ok: run.payload.ok === true,
  assertions: run.assertions,
  result: summarizePayload(run.payload),
  stderrPresent,
});

const scopedConnectionString = (connectionString: string, schema: string) => {
  const url = new URL(connectionString);
  if (url.searchParams.has("options")) {
    throw new Error("Hosted evidence URL must not contain a preconfigured options parameter");
  }
  url.searchParams.set("options", `-c search_path=${schema},pg_catalog`);
  return url.toString();
};

export const cleanupHostedProvider = async (
  pool: Pool,
  config: HostedConfiguration,
  publicStateOwned: boolean
) => {
  await assertGuard(pool, config);
  const lifecycleSchema = config.runId;
  const lifecycleTable = `${config.runId}_migration`;
  const adoptionTable = `${config.runId}_adoption`;
  const postBaselineTable = `${config.runId}_post`;

  if (publicStateOwned) {
    await pool.query(`DROP TABLE IF EXISTS public.${quoteIdentifier(postBaselineTable)}`);
    await pool.query(`DROP TABLE IF EXISTS public.${quoteIdentifier(adoptionTable)}`);
    await pool.query("DROP TABLE IF EXISTS public._migrations");
  }

  const schemaExists = await pool.query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = $1) AS exists",
    [lifecycleSchema]
  );
  if (schemaExists.rows[0]?.exists) {
    await pool.query(`DROP TABLE IF EXISTS ${quoteIdentifier(lifecycleSchema)}.${quoteIdentifier(lifecycleTable)}`);
    await pool.query(`DROP TABLE IF EXISTS ${quoteIdentifier(lifecycleSchema)}._migrations`);
    await pool.query(`DROP SCHEMA ${quoteIdentifier(lifecycleSchema)} RESTRICT`);
  }

  const remainingPublic = await publicObjects(pool);
  const remainingSchema = await pool.query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = $1) AS exists",
    [lifecycleSchema]
  );
  if ((publicStateOwned && remainingPublic.length !== 0) || remainingSchema.rows[0]?.exists) {
    throw new Error("Hosted evidence cleanup did not restore the guarded empty target");
  }
  await assertGuard(pool, config);
};

export const main = async () => {
  const args = parseArguments(process.argv.slice(2));
  const config = loadConfiguration(args.provider);
  const targetUrl = new URL(config.connectionString);
  const artifact = await readFile(args.artifactPath);
  const resolvedCli = await realpath(args.cliPath);
  const cliBytes = await readFile(resolvedCli);
  const installedPgPackage = JSON.parse(
    await readFile(resolve(dirname(resolvedCli), "../../../pg/package.json"), "utf8")
  ) as { version: string };
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as { version: string };
  const workRoot = await mkdtemp(join(tmpdir(), "tusk-hosted-evidence-"));
  const lifecyclePath = join(workRoot, "lifecycle");
  const adoptionPath = join(workRoot, "adoption");
  const lifecycleSchema = config.runId;
  const lifecycleTable = `${config.runId}_migration`;
  const adoptionTable = `${config.runId}_adoption`;
  const postBaselineTable = `${config.runId}_post`;
  const commands: CommandEvidence[] = [];
  const pool = new Pool({
    application_name: "tusk-v1-hosted-evidence",
    connectionString: config.connectionString,
    connectionTimeoutMillis: 15_000,
    max: 4,
    statement_timeout: 30_000,
  });
  const startedAt = new Date().toISOString();
  let cleanupVerified = false;
  let cleanupAuthorized = false;
  let failure: Error | undefined;
  let targetDetails: Awaited<ReturnType<typeof assertGuard>> | undefined;
  let adoptionChecksums: { up: string; down: string } | undefined;

  const runCli = async (
    commandArgs: string[],
    migrationsDirectory: string,
    connectionString: string,
    expectedExitCodes: number[] = [0]
  ) => {
    const command = `tusk ${commandArgs.join(" ")}`;
    const inheritedEnvironment = Object.fromEntries(
      ["HOME", "PATH", "TEMP", "TMP", "TMPDIR", "SystemRoot"]
        .map((name) => [name, process.env[name]] as const)
        .filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
    );
    const child = Bun.spawn([process.execPath, resolvedCli, ...commandArgs], {
      cwd: workRoot,
      env: {
        ...inheritedEnvironment,
        DATABASE_URL: connectionString,
        LOG_LEVEL: "error",
        MIGRATIONS_PATH: migrationsDirectory,
        TUSK_DRIVER: "pg",
        TUSK_STATEMENT_TIMEOUT_MS: "30000",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const timeout = setTimeout(() => child.kill(), 60_000);
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    clearTimeout(timeout);
    const lastLine = stdout.trim().split("\n").filter(Boolean).at(-1);
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(lastLine ?? "") as Record<string, unknown>;
    } catch {
      throw new Error(`${command} did not return a JSON envelope`);
    }
    const run: CommandRun = { command, exitCode, payload, assertions: [] };
    commands.push(toEvidence(run, stderr.trim().length > 0));
    if (!expectedExitCodes.includes(exitCode)) {
      throw new Error(`${command} exited ${exitCode}; expected ${expectedExitCodes.join(" or ")}`);
    }
    return run;
  };

  const assertRun = (run: CommandRun, condition: unknown, label: string) => {
    if (!condition) throw new Error(`${run.command}: ${label}`);
    run.assertions.push(label);
    const evidence = commands.at(-1);
    if (evidence?.command === run.command) evidence.assertions = [...run.assertions];
  };

  try {
    targetDetails = await assertGuard(pool, config);
    if ((await publicObjects(pool)).length !== 0) {
      throw new Error("Hosted evidence requires a guarded database with an empty public schema");
    }
    const metadata = await pool.query<{ metadata: string | null }>(
      "SELECT to_regclass('public._migrations')::text AS metadata"
    );
    if (metadata.rows[0]?.metadata !== null) {
      throw new Error("Hosted evidence refuses a database with existing public._migrations state");
    }
    cleanupAuthorized = true;
    const cleanupManifest = requireEnvironment("TUSK_HOSTED_CLEANUP_MANIFEST");
    await mkdir(dirname(resolve(cleanupManifest)), { recursive: true });
    await writeFile(
      resolve(cleanupManifest),
      `${JSON.stringify({ schemaVersion: 1, runId: config.runId, publicStateOwned: true })}\n`,
      { flag: "wx" }
    );
    await assertSessionLocks(pool, parseInt(sha256(config.runId).slice(0, 7), 16));

    await pool.query(`CREATE SCHEMA ${quoteIdentifier(lifecycleSchema)}`);
    await pool.query(`REVOKE ALL ON SCHEMA ${quoteIdentifier(lifecycleSchema)} FROM PUBLIC`);
    const lifecycleUrl = scopedConnectionString(config.connectionString, lifecycleSchema);
    const scopedPool = new Pool({ connectionString: lifecycleUrl, max: 1 });
    try {
      const scoped = await scopedPool.query<{ schema_name: string }>(
        "SELECT current_schema() AS schema_name"
      );
      if (scoped.rows[0]?.schema_name !== lifecycleSchema) {
        throw new Error("Fresh lifecycle connection did not enter the isolated schema");
      }
    } finally {
      await scopedPool.end();
    }

    const init = await runCli(["init", "--json"], lifecyclePath, lifecycleUrl);
    assertRun(init, init.payload.ok === true && init.payload.created === true, "initialized isolated migration directory");
    const create = await runCli(["create", "hosted_provider_smoke", "--json"], lifecyclePath, lifecycleUrl);
    assertRun(create, create.payload.ok === true, "created paired migration files");
    const upPath = join(lifecyclePath, basename(String(create.payload.upFile)));
    const downPath = join(lifecyclePath, basename(String(create.payload.downFile)));
    await writeFile(
      upPath,
      `CREATE TABLE ${quoteIdentifier(lifecycleSchema)}.${quoteIdentifier(lifecycleTable)} (id BIGINT PRIMARY KEY);\n`
    );
    await writeFile(
      downPath,
      `DROP TABLE ${quoteIdentifier(lifecycleSchema)}.${quoteIdentifier(lifecycleTable)};\n`
    );
    const expectedMigrationChecksum = sha256(await readFile(upPath, "utf8"));

    const doctor = await runCli(["doctor", "--json"], lifecyclePath, lifecycleUrl);
    const doctorDatabase = doctor.payload.database as Record<string, unknown>;
    const doctorEngine = doctorDatabase.engine as Record<string, unknown>;
    const doctorChecks = doctor.payload.checks as Array<Record<string, unknown>>;
    assertRun(doctor, doctor.payload.ok === true, "doctor passed");
    assertRun(doctor, doctorEngine.provider === config.expectedDoctorProvider, "doctor detected the expected provider");
    assertRun(
      doctor,
      doctorChecks.some((check) => check.id === "database.advisoryLock" && check.status === "pass"),
      "doctor verified advisory locking"
    );

    const initialStatus = await runCli(["status", "--json"], lifecyclePath, lifecycleUrl);
    const initialSummary = initialStatus.payload.summary as Record<string, unknown>;
    assertRun(initialStatus, initialSummary.executed === 0 && initialSummary.pending === 1, "initial status is 0 executed and 1 pending");
    const noMetadata = await pool.query<{ metadata: string | null }>(
      `SELECT to_regclass($1)::text AS metadata`,
      [`${lifecycleSchema}._migrations`]
    );
    assertRun(initialStatus, noMetadata.rows[0]?.metadata === null, "status did not create metadata");

    const validateFiles = await runCli(["validate", "--json"], lifecyclePath, lifecycleUrl);
    const validateFilesSummary = validateFiles.payload.summary as Record<string, unknown>;
    assertRun(validateFiles, validateFiles.payload.ok === true && validateFilesSummary.errors === 0, "file validation has zero errors");
    const validateDb = await runCli(["validate", "--db", "--json"], lifecyclePath, lifecycleUrl);
    const validateDbSummary = validateDb.payload.summary as Record<string, unknown>;
    assertRun(validateDb, validateDb.payload.ok === true && validateDbSummary.errors === 0, "database validation has zero errors");
    const metadataAfterValidation = await pool.query<{ metadata: string | null }>(
      "SELECT to_regclass($1)::text AS metadata",
      [`${lifecycleSchema}._migrations`]
    );
    assertRun(validateDb, metadataAfterValidation.rows[0]?.metadata === null, "database validation did not create metadata");

    const upPlan = await runCli(["up", "--dry-run", "--json"], lifecyclePath, lifecycleUrl);
    const upMigrations = upPlan.payload.migrations as unknown[];
    assertRun(upPlan, upPlan.payload.direction === "up" && upMigrations.length === 1, "up dry-run planned exactly one migration");
    const beforeApply = await pool.query<{ relation: string | null }>("SELECT to_regclass($1)::text AS relation", [`${lifecycleSchema}.${lifecycleTable}`]);
    assertRun(upPlan, beforeApply.rows[0]?.relation === null, "up dry-run did not mutate the database");
    const metadataAfterUpPlan = await pool.query<{ metadata: string | null }>(
      "SELECT to_regclass($1)::text AS metadata",
      [`${lifecycleSchema}._migrations`]
    );
    assertRun(upPlan, metadataAfterUpPlan.rows[0]?.metadata === null, "up dry-run did not create metadata");

    const up = await runCli(["up", "--json"], lifecyclePath, lifecycleUrl);
    assertRun(up, up.payload.executed === 1 && up.payload.pending === 0, "up applied exactly one migration");
    const applied = await pool.query<{ checksum: string; filename: string; relation: string | null }>(
      `SELECT m.filename, m.checksum, to_regclass($1)::text AS relation FROM ${quoteIdentifier(lifecycleSchema)}._migrations m`,
      [`${lifecycleSchema}.${lifecycleTable}`]
    );
    assertRun(
      up,
      applied.rows.length === 1 && applied.rows[0]?.checksum === expectedMigrationChecksum && applied.rows[0]?.relation !== null,
      "table and matching checksum metadata exist"
    );

    const appliedStatus = await runCli(["status", "--json"], lifecyclePath, lifecycleUrl);
    const appliedSummary = appliedStatus.payload.summary as Record<string, unknown>;
    assertRun(appliedStatus, appliedSummary.executed === 1 && appliedSummary.pending === 0, "applied status is 1 executed and 0 pending");

    const downPlan = await runCli(["down", "--dry-run", "--json"], lifecyclePath, lifecycleUrl);
    const downMigrations = downPlan.payload.migrations as unknown[];
    assertRun(downPlan, downPlan.payload.direction === "down" && downMigrations.length === 1, "down dry-run planned exactly one migration");
    const beforeRollback = await pool.query<{ relation: string | null }>("SELECT to_regclass($1)::text AS relation", [`${lifecycleSchema}.${lifecycleTable}`]);
    assertRun(downPlan, beforeRollback.rows[0]?.relation !== null, "down dry-run did not mutate the database");

    const down = await runCli(["down", "--json"], lifecyclePath, lifecycleUrl);
    assertRun(down, down.payload.executed === 1, "down rolled back exactly one migration");
    const finalStatus = await runCli(["status", "--json"], lifecyclePath, lifecycleUrl);
    const finalSummary = finalStatus.payload.summary as Record<string, unknown>;
    assertRun(finalStatus, finalSummary.executed === 0 && finalSummary.pending === 1, "final lifecycle status is 0 executed and 1 pending");
    const afterRollback = await pool.query<{ relation: string | null }>("SELECT to_regclass($1)::text AS relation", [`${lifecycleSchema}.${lifecycleTable}`]);
    assertRun(finalStatus, afterRollback.rows[0]?.relation === null, "rollback removed the lifecycle table");

    await pool.query(`
      CREATE TABLE public.${quoteIdentifier(adoptionTable)} (
        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        label TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    const adopt = await runCli(["init", "--from-db", "--json"], adoptionPath, config.connectionString);
    assertRun(adopt, adopt.payload.ok === true && adopt.payload.tableCount === 1 && adopt.payload.markedAsExecuted === true, "adoption recorded one-table baseline");
    const adoptedStatus = await runCli(["status", "--json"], adoptionPath, config.connectionString);
    const adoptedSummary = adoptedStatus.payload.summary as Record<string, unknown>;
    assertRun(adoptedStatus, adoptedSummary.executed === 1 && adoptedSummary.pending === 0, "adopted status is 1 executed and 0 pending");

    const refused = await runCli(["down", "--dry-run", "--json"], adoptionPath, config.connectionString, [1]);
    const refusedError = refused.payload.error as Record<string, unknown>;
    assertRun(refused, refused.payload.ok === false && refusedError.code === "VALIDATION_ERROR", "ordinary baseline rollback was refused");
    const allowed = await runCli(["down", "--dry-run", "--allow-baseline-rollback", "--json"], adoptionPath, config.connectionString);
    const allowedMigrations = allowed.payload.migrations as unknown[];
    assertRun(allowed, allowed.payload.direction === "down" && allowedMigrations.length === 1, "explicit baseline override planned exactly one rollback");
    const adoptionStillPresent = await pool.query<{ relation: string | null }>("SELECT to_regclass($1)::text AS relation", [`public.${adoptionTable}`]);
    assertRun(allowed, adoptionStillPresent.rows[0]?.relation !== null, "baseline override dry-run did not mutate the database");

    const postCreate = await runCli(["create", "post_baseline_smoke", "--json"], adoptionPath, config.connectionString);
    assertRun(postCreate, postCreate.payload.ok === true, "created post-baseline migration pair");
    await writeFile(join(adoptionPath, basename(String(postCreate.payload.upFile))), `CREATE TABLE public.${quoteIdentifier(postBaselineTable)} (id BIGINT PRIMARY KEY);\n`);
    await writeFile(join(adoptionPath, basename(String(postCreate.payload.downFile))), `DROP TABLE public.${quoteIdentifier(postBaselineTable)};\n`);
    const postValidate = await runCli(["validate", "--db", "--json"], adoptionPath, config.connectionString);
    const postValidateSummary = postValidate.payload.summary as Record<string, unknown>;
    assertRun(postValidate, postValidate.payload.ok === true && postValidateSummary.errors === 0, "post-baseline migration validation passed");
    const postUp = await runCli(["up", "--json"], adoptionPath, config.connectionString);
    assertRun(postUp, postUp.payload.executed === 1 && postUp.payload.pending === 0, "post-baseline migration applied");
    const postUpState = await pool.query<{
      adoption_relation: string | null;
      executed_count: number;
      post_relation: string | null;
    }>(`
      SELECT
        to_regclass($1)::text AS adoption_relation,
        to_regclass($2)::text AS post_relation,
        (SELECT COUNT(*)::int FROM public._migrations) AS executed_count
    `, [`public.${adoptionTable}`, `public.${postBaselineTable}`]);
    assertRun(
      postUp,
      postUpState.rows[0]?.adoption_relation !== null &&
        postUpState.rows[0]?.post_relation !== null &&
        postUpState.rows[0]?.executed_count === 2,
      "baseline and post-baseline tables plus two metadata rows exist"
    );
    const postUpStatus = await runCli(["status", "--json"], adoptionPath, config.connectionString);
    const postUpSummary = postUpStatus.payload.summary as Record<string, unknown>;
    assertRun(postUpStatus, postUpSummary.executed === 2 && postUpSummary.pending === 0, "post-baseline applied status is 2 executed and 0 pending");
    const postDown = await runCli(["down", "--json"], adoptionPath, config.connectionString);
    assertRun(postDown, postDown.payload.executed === 1, "post-baseline migration rolled back without selecting baseline");
    const postDownState = await pool.query<{
      adoption_relation: string | null;
      baseline_rows: number;
      post_relation: string | null;
    }>(`
      SELECT
        to_regclass($1)::text AS adoption_relation,
        to_regclass($2)::text AS post_relation,
        (
          SELECT COUNT(*)::int
          FROM public._migrations
          WHERE filename = '0000000000000_initial.up.sql'
        ) AS baseline_rows
    `, [`public.${adoptionTable}`, `public.${postBaselineTable}`]);
    assertRun(
      postDown,
      postDownState.rows[0]?.adoption_relation !== null &&
        postDownState.rows[0]?.post_relation === null &&
        postDownState.rows[0]?.baseline_rows === 1,
      "rollback preserved the baseline table and metadata row while removing the post table"
    );
    const postDownStatus = await runCli(["status", "--json"], adoptionPath, config.connectionString);
    const postDownSummary = postDownStatus.payload.summary as Record<string, unknown>;
    assertRun(postDownStatus, postDownSummary.executed === 1 && postDownSummary.pending === 1, "post-baseline rollback status is 1 executed and 1 pending");

    adoptionChecksums = {
      up: sha256(await readFile(join(adoptionPath, "0000000000000_initial.up.sql"))),
      down: sha256(await readFile(join(adoptionPath, "0000000000000_initial.down.sql"))),
    };
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
  } finally {
    try {
      if (cleanupAuthorized) {
        await cleanupHostedProvider(pool, config, true);
        cleanupVerified = true;
      }
    } catch (error) {
      const cleanupFailure = error instanceof Error ? error : new Error(String(error));
      failure = failure
        ? new Error(`${failure.message}; cleanup also failed: ${cleanupFailure.message}`)
        : cleanupFailure;
    }
    await pool.end().catch(() => undefined);
    await rm(workRoot, { recursive: true, force: true });
  }

  const evidence = {
    schemaVersion: 2,
    status: failure ? "failed" : "passed",
    startedAt,
    completedAt: new Date().toISOString(),
    provider: config.provider,
    providerClaim: {
      expectedDoctorProvider: config.expectedDoctorProvider,
      targetLabel: config.targetLabel,
    },
    region: config.region,
    source: {
      commit: process.env.GITHUB_SHA ?? null,
      packageVersion: packageJson.version,
      artifactSha256: sha256(artifact),
      cliSha256: sha256(cliBytes),
      pgVersion: installedPgPackage.version,
      runtime: `Bun ${Bun.version}`,
      workflowRunId: process.env.GITHUB_RUN_ID ?? null,
      workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    },
    target: {
      fingerprint: sha256(`${targetUrl.hostname}:${targetUrl.port || "5432"}/${config.expectedDatabase}`),
      localTestOverride: config.localTestOverride,
      serverVersion: targetDetails?.serverVersion,
      tls: targetDetails?.tls,
      tlsCipher: targetDetails?.tlsCipher,
      tlsVersion: targetDetails?.tlsVersion,
    },
    sessionLockProof: failure ? "not-confirmed" : "passed",
    adoption: adoptionChecksums
      ? { status: "passed", baselineChecksums: adoptionChecksums, ordinaryRollbackRefused: true }
      : { status: "failed" },
    commands,
    cleanup: { attempted: true, verified: cleanupVerified },
    ...(failure ? { error: "Hosted-provider verification failed; inspect command codes and assertions" } : {}),
  };

  await mkdir(dirname(args.outputPath), { recursive: true });
  await writeFile(args.outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
  console.log(`Hosted-provider evidence written to ${args.outputPath}`);
  if (failure) {
    throw new Error("Hosted-provider verification failed; inspect the redacted evidence artifact");
  }
};

if (import.meta.main) {
  await main();
}
