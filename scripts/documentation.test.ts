import { describe, expect, test } from "bun:test";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const root = process.cwd();
const retainedDocs = [
  "agents.md",
  "compatibility.md",
  "custom-adapters.md",
  "existing-databases.md",
  "integrations.md",
  "json-contracts.md",
  "metadata-table.md",
  "transactions.md",
];

const markdownUnder = async (directory: string): Promise<string[]> => {
  const files: string[] = [];
  for (const entry of await readdir(join(root, directory), {
    withFileTypes: true,
  })) {
    const relativePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await markdownUnder(relativePath)));
    } else if (entry.name.endsWith(".md")) {
      files.push(relativePath);
    }
  }
  return files.sort();
};

const markdownFiles = async () => [
  "README.md",
  "CONTRIBUTING.md",
  ".github/SECURITY.md",
  ...(await markdownUnder("docs")),
  "examples/basic/README.md",
];

describe("documentation surface", () => {
  test("contains only current user and reference guides", async () => {
    const docs = (await markdownUnder("docs")).map((name) =>
      name.slice("docs/".length),
    );

    expect(docs).toEqual(retainedDocs);
    expect(await stat(join(root, "CONTRIBUTING.md"))).toBeDefined();
  });

  test("keeps the README focused on a one-minute first migration", async () => {
    const readme = await readFile(join(root, "README.md"), "utf8");

    expect(readme.split(/\r?\n/).length).toBeLessThanOrEqual(200);
    expect(readme).toContain("npm install @bydey/tusk pg");
    expect(readme).toContain("npx tusk create create_users");
    expect(readme).toContain("npx tusk up --dry-run");
    expect(readme).toContain("npx tusk up");
    expect(readme).not.toContain("## More");
    expect(readme).not.toContain("v1 readiness");
    expect(readme).not.toContain("release checklist");
  });

  test("has no broken relative Markdown links", async () => {
    const broken: string[] = [];

    for (const relativeFile of await markdownFiles()) {
      const absoluteFile = join(root, relativeFile);
      const source = await readFile(absoluteFile, "utf8");
      for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        const target = match[1].trim();
        if (/^(?:[a-z]+:|#)/i.test(target)) continue;

        const targetPath = decodeURIComponent(target.split("#", 1)[0]);
        try {
          await stat(resolve(dirname(absoluteFile), targetPath));
        } catch {
          broken.push(`${relativeFile} -> ${target}`);
        }
      }
    }

    expect(broken).toEqual([]);
  });

  test("keeps user and contributor documentation compact and well formed", async () => {
    let words = 0;
    const unbalancedFences: string[] = [];

    for (const relativeFile of await markdownFiles()) {
      const source = await readFile(join(root, relativeFile), "utf8");
      words += source.trim().split(/\s+/).length;
      if ((source.match(/^```/gm)?.length ?? 0) % 2 !== 0) {
        unbalancedFences.push(relativeFile);
      }
    }

    expect(words).toBeLessThanOrEqual(4_500);
    expect(unbalancedFences).toEqual([]);
  });
});
