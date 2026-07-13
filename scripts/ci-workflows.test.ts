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

  test("uses immutable registry identity for release recovery", async () => {
    const publish = await readFile(
      join(workflowsDirectory, "publish-npm-package.yml"),
      "utf8",
    );
    const artifactIndex = publish.indexOf(
      "- name: Verify immutable hosted-tested release artifact",
    );
    const publishIndex = publish.indexOf("- name: Publish to npm");
    const registryIndex = publish.indexOf(
      "- name: Verify published registry artifact",
    );
    const tagIndex = publish.indexOf("- name: Create and push tag");
    const registryStep = publish.slice(registryIndex, tagIndex);

    expect(publish).not.toContain("gitHead");
    expect(publish).toContain(
      "already exists on npm; verifying its artifact identity before release finalization",
    );
    expect(artifactIndex).toBeGreaterThan(-1);
    expect(publishIndex).toBeGreaterThan(artifactIndex);
    expect(registryIndex).toBeGreaterThan(publishIndex);
    expect(tagIndex).toBeGreaterThan(registryIndex);
    expect(registryStep).not.toContain("package_published");
    expect(registryStep).toContain("dist.integrity");
    expect(registryStep).toContain('crypto.createHash("sha512")');
    expect(registryStep).toContain(
      'if [ "${published_integrity}" != "${candidate_integrity}" ]',
    );
    expect(registryStep).toContain(
      "dist.attestations.provenance.predicateType",
    );
    expect(registryStep).toContain("dist.attestations.url");
    expect(registryStep).toContain(
      "https://registry.npmjs.org/-/npm/v1/attestations/*",
    );
    expect(registryStep).toContain("https://slsa.dev/provenance/v1");
    expect(registryStep).toContain(".digest.sha512 == $digest");
    expect(registryStep).toContain(
      ".externalParameters.workflow.repository",
    );
    expect(registryStep).toContain(".externalParameters.workflow.path");
    expect(registryStep).toContain(".resolvedDependencies[]?");
    expect(registryStep).toContain(".digest.gitCommit == $commit");
    expect(registryStep).toContain("for attempt in {1..6}");
    expect(registryStep).toContain("sleep 5");
  });

  test("generates and verifies a frozen release SBOM dependency graph", async () => {
    const publish = await readFile(
      join(workflowsDirectory, "publish-npm-package.yml"),
      "utf8",
    );
    const generateIndex = publish.indexOf(
      "- name: Generate deterministic release SBOM",
    );
    const verifyIndex = publish.indexOf("- name: Verify release SBOM");
    const publishIndex = publish.indexOf("- name: Publish to npm");
    const sbomSteps = publish.slice(generateIndex, publishIndex);

    expect(generateIndex).toBeGreaterThan(-1);
    expect(verifyIndex).toBeGreaterThan(generateIndex);
    expect(publishIndex).toBeGreaterThan(verifyIndex);
    expect(sbomSteps).toContain("scripts/generate-release-sbom.ts");
    expect(sbomSteps).toContain("bun.lock");
    expect(sbomSteps).not.toContain("npm install");
    expect(sbomSteps).toContain(".bomFormat == \"CycloneDX\"");
    expect(sbomSteps).toContain(".metadata.component");
    expect(sbomSteps).toContain(".peerDependencies");
    expect(sbomSteps).toContain(".peerDependenciesMeta");
    expect(sbomSteps).toContain("tusk:dependency-kind");
    expect(sbomSteps).toContain(".dependencies[]?");
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
