import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const workflowsDirectory = join(process.cwd(), ".github", "workflows");

const workflowSources = async () => {
  const names = (await readdir(workflowsDirectory))
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort();
  return await Promise.all(
    names.map(async (name) => ({
      name,
      source: await readFile(join(workflowsDirectory, name), "utf8"),
    })),
  );
};

interface WorkflowJob {
  file: string;
  name: string;
  source: string;
}

const concreteJobs = async (): Promise<WorkflowJob[]> => {
  const jobs: WorkflowJob[] = [];
  for (const workflow of await workflowSources()) {
    const lines = workflow.source.split(/\r?\n/);
    let inJobs = false;
    let currentName: string | undefined;
    let currentLines: string[] = [];
    const finishJob = () => {
      if (
        currentName &&
        currentLines.some((line) => /^    runs-on:/.test(line))
      ) {
        jobs.push({
          file: workflow.name,
          name: currentName,
          source: currentLines.join("\n"),
        });
      }
    };

    for (const line of lines) {
      if (line === "jobs:") {
        inJobs = true;
        continue;
      }
      if (!inJobs) {
        continue;
      }
      const job = line.match(/^  ([a-zA-Z0-9_-]+):\s*$/);
      if (job) {
        finishJob();
        currentName = job[1];
        currentLines = [];
      } else if (currentName) {
        currentLines.push(line);
      }
    }
    finishJob();
  }
  return jobs;
};

describe("GitHub Actions runtime policy", () => {
  test("caps every concrete job at five minutes", async () => {
    const violations: string[] = [];
    for (const job of await concreteJobs()) {
      const timeout = job.source.match(/^    timeout-minutes:\s*(\d+)\s*$/m);
      if (!timeout || Number(timeout[1]) > 5) {
        violations.push(`${job.file}:${job.name}`);
      }
    }

    expect(violations).toEqual([]);
  });

  test("keeps exhaustive mutation sharded behind the stable required check", async () => {
    const ci = await readFile(join(workflowsDirectory, "ci.yml"), "utf8");
    const shardValues = ci
      .match(/shard: \[([^\]]+)\]/)?.[1]
      .split(",")
      .map((value) => Number(value.trim()));

    expect(shardValues).toEqual(
      Array.from({ length: 16 }, (_, index) => index),
    );
    expect(ci).toContain("name: Verify (Node 24, PostgreSQL 18)");
    expect(ci).toContain("needs.mutation-aggregate.result");
    expect(ci).toContain("merge-mutation-reports.ts .tmp/quality/shards 16");
  });

  test("does not rerun monolithic mutation during publication", async () => {
    const publish = await readFile(
      join(workflowsDirectory, "publish-npm-package.yml"),
      "utf8",
    );

    expect(publish).not.toMatch(/bun run quality:release(?:\s|$)/);
    expect(publish).toContain(
      "Require successful CI for the exact release commit",
    );
    expect(publish).toContain('head_sha="${GITHUB_SHA}"');
  });

  test("reserves hosted-provider cleanup time inside the five-minute job", async () => {
    const hosted = await readFile(
      join(workflowsDirectory, "hosted-provider-evidence.yml"),
      "utf8",
    );

    const deadlineSeconds = Number(
      hosted.match(/date \+%s\) \+ (\d+)\)\)/)?.[1],
    );
    const verifierKillSeconds = Number(
      hosted.match(/--kill-after=(\d+)s "\$\{remaining_seconds\}s"/)?.[1],
    );
    const cleanupBounds = hosted.match(/--kill-after=(\d+)s (\d+)s \\/);
    const cleanupKillSeconds = Number(cleanupBounds?.[1]);
    const cleanupSeconds = Number(cleanupBounds?.[2]);
    const postStepReserveSeconds = 30;

    expect(hosted).toContain("remaining_seconds");
    expect(
      deadlineSeconds +
        verifierKillSeconds +
        cleanupSeconds +
        cleanupKillSeconds +
        postStepReserveSeconds,
    ).toBeLessThanOrEqual(300);
  });

  test("does not reuse a Bun cache across hosted runner homes", async () => {
    const hosted = await readFile(
      join(workflowsDirectory, "hosted-provider-evidence.yml"),
      "utf8",
    );

    expect(hosted).toMatch(
      /uses: oven-sh\/setup-bun@[a-f0-9]+[\s\S]{0,160}no-cache: true/,
    );
  });
});
