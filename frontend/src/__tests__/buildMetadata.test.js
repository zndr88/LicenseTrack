import { describe, expect, it } from "vitest";
import { buildMetadata, readBuildMetadata } from "../../build/buildMetadata.js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("build identification", () => {
  it("reads local tags, branches, commits and tracked modifications", () => {
    const cwd = mkdtempSync(join(tmpdir(), "licensetrack-build-metadata-"));
    const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    try {
      git("init", "-b", "main");
      writeFileSync(join(cwd, "source.txt"), "release");
      git("add", "source.txt");
      git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "fixture");
      const sha = git("rev-parse", "HEAD");
      expect(readBuildMetadata("1.1.24", cwd, {}).label).toBe(`Preview · main (${sha.slice(0, 7)})`);
      git("tag", "v1.1.24");
      expect(readBuildMetadata("1.1.24", cwd, {}).label).toBe("v1.1.24");
      expect(readBuildMetadata("1.1.24", cwd, { LT_BUILD_REF: "refs/heads/main", LT_BUILD_SHA: sha }).label).toContain("Preview");
      writeFileSync(join(cwd, "source.txt"), "changed");
      expect(readBuildMetadata("1.1.24", cwd, {}).label).toContain("Preview");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it.each(["v1.1.24", "1.1.24"])("identifies a matching release tag %s", (tag) => {
    expect(buildMetadata({ version: "1.1.24", ref: "main", commit: "abc123456", tag })).toEqual({ label: "v1.1.24", tooltip: "" });
  });
  it.each(["", "v1.1.23", "v1.2.0-rc.1"])("identifies non-release builds (%s)", (tag) => {
    expect(buildMetadata({ version: "1.1.24", ref: "refs/heads/main", commit: "abc123456", tag })).toEqual({ label: "Preview · main (abc1234)", tooltip: "Unreleased changes after v1.1.24" });
  });
  it("keeps dirty release checkouts marked as previews", () => {
    expect(buildMetadata({ version: "1.1.24", ref: "main", commit: "abc123456", tag: "v1.1.24", dirty: true }).tooltip).toContain("includes uncommitted changes");
    expect(buildMetadata({ version: "1.1.24", tag: "v1.1.24", dirty: true }).label).toContain("Preview");
  });
  it("keeps source archives without metadata marked as previews", () => {
    expect(readBuildMetadata("1.1.24", "missing-source-directory", {})).toEqual({ label: "Preview · source (unknown)", tooltip: "Unreleased changes after v1.1.24" });
  });
  it("accepts explicit build metadata without a Git checkout", () => {
    expect(readBuildMetadata("1.1.24", "missing-source-directory", { LT_BUILD_REF: "refs/tags/v1.1.24", LT_BUILD_SHA: "abc123456" })).toEqual({ label: "v1.1.24", tooltip: "" });
  });
});
