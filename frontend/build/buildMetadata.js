import { execFileSync } from "node:child_process";

export function buildMetadata({ version, ref = "source", commit = "unknown", tag = "", dirty = false }) {
  const branch = ref.replace(/^refs\/heads\//, "").replace(/^refs\/tags\//, "");
  if (!dirty && (tag === `v${version}` || tag === version)) {
    return { label: `v${version}`, tooltip: "" };
  }
  return {
    label: `Preview · ${branch} (${commit.slice(0, 7)})`,
    tooltip: `Unreleased changes after v${version}${dirty ? " · includes uncommitted changes" : ""}`,
  };
}

export function readBuildMetadata(version, cwd, environment) {
  const git = (...args) => {
    try {
      return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return "";
    }
  };
  const ref = environment.LT_BUILD_REF || git("branch", "--show-current") || "detached";
  const commit = environment.LT_BUILD_SHA || git("rev-parse", "HEAD") || "unknown";
  const tag = environment.LT_BUILD_REF
    ? (ref.startsWith("refs/tags/") ? ref.slice("refs/tags/".length) : "")
    : git("describe", "--tags", "--exact-match", "HEAD");
  return buildMetadata({
    version, ref: commit === "unknown" && !environment.LT_BUILD_REF ? "source" : ref,
    commit, tag, dirty: Boolean(git("status", "--porcelain", "--untracked-files=no")),
  });
}
