import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  writeFile,
} from "fs/promises";
import { join, resolve } from "path";

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const repoRoot = process.cwd();

const decode = async (stream: ReadableStream<Uint8Array> | null) => {
  if (!stream) {
    return "";
  }

  return await new Response(stream).text();
};

const runCommand = async (
  cmd: string[],
  cwd: string
): Promise<CommandResult> => {
  const child = Bun.spawn(cmd, {
    cwd,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    decode(child.stdout),
    decode(child.stderr),
    child.exited,
  ]);

  return { exitCode, stdout, stderr };
};

describe("package smoke test", () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    for (const path of cleanupPaths.splice(0)) {
      await rm(path, { recursive: true, force: true });
    }
  });

  test("packed tarball exposes the installed CLI and public API", async () => {
    const tempRootParent = resolve(repoRoot, ".tmp");
    await mkdir(tempRootParent, { recursive: true });

    const tempRoot = await mkdtemp(join(tempRootParent, "package-smoke-"));
    const projectDir = join(tempRoot, "project");
    const scopedDir = join(projectDir, "node_modules", "@jordey92");
    cleanupPaths.push(tempRoot);

    const buildResult = await runCommand(["bun", "run", "build"], repoRoot);
    expect(buildResult.exitCode).toBe(0);

    const packResult = await runCommand(
      ["npm", "pack", "--pack-destination", tempRoot],
      repoRoot
    );
    expect(packResult.exitCode).toBe(0);

    const tarball = (await readdir(tempRoot)).find((file) => file.endsWith(".tgz"));
    expect(tarball).toBeDefined();

    await mkdir(scopedDir, { recursive: true });

    const extractResult = await runCommand(
      ["tar", "-xzf", join(tempRoot, tarball!), "-C", scopedDir],
      repoRoot
    );
    expect(extractResult.exitCode).toBe(0);

    await rename(join(scopedDir, "package"), join(scopedDir, "tusk"));
    await mkdir(join(projectDir, "migrations"), { recursive: true });

    await writeFile(
      join(projectDir, "package.json"),
      JSON.stringify({ name: "package-smoke", type: "module", private: true })
    );
    await writeFile(
      join(projectDir, "migrations", "0000000000001_test.up.sql"),
      "CREATE TABLE smoke_test (id INT);"
    );
    await writeFile(
      join(projectDir, "smoke.mjs"),
      `
      import { readMigrations } from "@jordey92/tusk";

      const migrations = await readMigrations("./migrations");
      console.log(migrations.map((migration) => migration.filename).join(","));
      `
    );

    const versionResult = await runCommand(
      [process.execPath, join(projectDir, "node_modules", "@jordey92", "tusk", "dist", "cli.js"), "version"],
      projectDir
    );
    expect(versionResult.exitCode).toBe(0);
    expect(versionResult.stdout).toContain("tusk v");

    const apiResult = await runCommand([process.execPath, "smoke.mjs"], projectDir);
    expect(apiResult.exitCode).toBe(0);
    expect(apiResult.stdout).toContain("0000000000001_test.up.sql");
  });
});
