import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { getPackageVersion } from "./version";

describe("getPackageVersion", () => {
  test("should resolve version from parent directory of dist", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "tusk-version-"));
    const distDir = join(tempDir, "dist");
    const packageJsonPath = join(tempDir, "package.json");

    await mkdir(distDir, { recursive: true });
    await Bun.write(join(distDir, ".keep"), "");
    await writeFile(
      packageJsonPath,
      JSON.stringify({ name: "tusk", version: "1.2.3" }, null, 2)
    );

    const version = await getPackageVersion(distDir);
    expect(version).toBe("1.2.3");
  });

  test("should return unknown when package.json is missing", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "tusk-version-missing-"));
    const version = await getPackageVersion(tempDir);
    expect(version).toBe("unknown");
  });
});
