import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import {
  cleanupHostedProvider,
  loadConfiguration,
  supportedHostedProviders,
  type HostedProvider,
} from "./verify-hosted-provider.js";

const provider = process.argv[2];
const manifestPath = process.argv[3];
if (!supportedHostedProviders.includes(provider as HostedProvider) || !manifestPath) {
  throw new Error(
    "Usage: bun scripts/cleanup-hosted-provider.ts <neon|supabase|rds|aurora> <cleanup-manifest>"
  );
}

const config = loadConfiguration(provider as HostedProvider);
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
  schemaVersion?: number;
  runId?: string;
  publicStateOwned?: boolean;
};
if (
  manifest.schemaVersion !== 1 ||
  manifest.runId !== config.runId ||
  manifest.publicStateOwned !== true
) {
  throw new Error("Cleanup manifest does not authorize this guarded run");
}

const pool = new Pool({
  application_name: "tusk-v1-hosted-cleanup",
  connectionString: config.connectionString,
  connectionTimeoutMillis: 15_000,
  max: 1,
  statement_timeout: 30_000,
});
try {
  await cleanupHostedProvider(pool, config, true);
  console.log("Guarded hosted-provider cleanup verified");
} finally {
  await pool.end();
}
