/**
 * PostgreSQL advisory lock keys are signed 64-bit integers.
 * Keep derived IDs in a positive range that fits comfortably in that space.
 */
const LOCK_ID_MODULUS = 2_147_483_647; // 2^31 - 1
const LOCK_ID_MIN = 1;

/**
 * Default lock id used when neither `migrationLockId` nor `migrationLockSeed`
 * is configured. Shared by CLI, MCP, Elysia, and programmatic adapters so mixed
 * runners on the same migration history still serialize.
 */
export const DEFAULT_MIGRATION_LOCK_ID = 123456789;

/**
 * Derive a positive advisory lock id from an arbitrary seed string
 * (for example a project name or an explicit lock seed env value).
 */
export function deriveMigrationLockId(seed: string): number {
  const normalized = seed.trim();
  if (!normalized) {
    throw new Error("migration lock seed must be a non-empty string");
  }

  // FNV-1a 32-bit — stable across Node/Bun and independent of string length.
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  const positive = hash >>> 0; // unsigned 32-bit
  return (positive % (LOCK_ID_MODULUS - LOCK_ID_MIN + 1)) + LOCK_ID_MIN;
}

/**
 * Parse a user-supplied advisory lock id (env var, CLI, or config).
 */
export function parseMigrationLockId(value: string | number): number {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < LOCK_ID_MIN || value > LOCK_ID_MODULUS) {
      throw new Error(
        `Invalid migrationLockId: ${value}. Expected an integer between ${LOCK_ID_MIN} and ${LOCK_ID_MODULUS}.`,
      );
    }
    return value;
  }

  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error(
      `Invalid migrationLockId: "${value}". Expected an integer between ${LOCK_ID_MIN} and ${LOCK_ID_MODULUS}.`,
    );
  }

  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < LOCK_ID_MIN || parsed > LOCK_ID_MODULUS) {
    throw new Error(
      `Invalid migrationLockId: ${value}. Expected an integer between ${LOCK_ID_MIN} and ${LOCK_ID_MODULUS}.`,
    );
  }

  return parsed;
}

type ResolveMigrationLockIdOptions = {
  /** Explicit lock id (wins over seed). */
  lockId?: number | string;
  /** Seed used to derive a lock id when `lockId` is omitted. */
  seed?: string;
};

/**
 * Resolve the advisory lock id from explicit id, seed, or the library default.
 */
export function resolveMigrationLockId(
  options?: ResolveMigrationLockIdOptions,
): number {
  if (options?.lockId != null && options.lockId !== "") {
    return parseMigrationLockId(options.lockId);
  }

  if (options?.seed != null) {
    return deriveMigrationLockId(options.seed);
  }

  return DEFAULT_MIGRATION_LOCK_ID;
}

type ConfiguredMigrationLockOptions = {
  /**
   * Optional migrations path. Ignored for lock identity unless the caller also
   * opts into a seed (path hashing alone must not diverge from the default).
   */
  migrationsPath?: string;
  /** Raw `TUSK_MIGRATION_LOCK_ID` value when set. */
  lockIdEnv?: string;
  /** Raw `TUSK_MIGRATION_LOCK_SEED` value when set (opt-in derivation). */
  seedEnv?: string;
  /** Explicit opt-in seed (for example a stable project name). */
  seed?: string;
};

type ConfiguredMigrationLock = {
  migrationLockId?: number;
  migrationLockSeed?: string;
};

/**
 * Resolve adapter lock options from explicit env/config overrides.
 * Default (no overrides) leaves options empty so adapters use
 * `DEFAULT_MIGRATION_LOCK_ID` and stay compatible with mixed CLI + programmatic
 * runners on the same history.
 */
export function resolveConfiguredMigrationLock(
  options: ConfiguredMigrationLockOptions = {},
): ConfiguredMigrationLock {
  if (options.lockIdEnv !== undefined && options.lockIdEnv !== "") {
    return { migrationLockId: parseMigrationLockId(options.lockIdEnv) };
  }

  if (options.seed !== undefined && options.seed !== "") {
    return { migrationLockSeed: options.seed };
  }

  if (options.seedEnv !== undefined && options.seedEnv !== "") {
    return { migrationLockSeed: options.seedEnv };
  }

  return {};
}
