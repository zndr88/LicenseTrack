// Guards the "Mirrors backend/app/..." comments in the demo: each one names the
// server file (and usually the function) a piece of the fake backend follows.
// When that file or function is renamed or removed, the comment goes stale
// without anything else failing, so this test fails instead.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";

// Vitest runs from frontend/, one level below the repository root.
const REPO_ROOT = resolve(process.cwd(), "..");
const inRepo = (file) => resolve(REPO_ROOT, file);
const demoSources = import.meta.glob("../*.js", { query: "?raw", import: "default", eager: true });

// A comment line start (" * " or "// ") that may sit between a path and a name.
const GAP = String.raw`(?:[ \t]*\r?\n[ \t]*(?:\*|\/\/))?[ \t]*`;
const NAME = String.raw`[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*`;
const MARKER = new RegExp(
  String.raw`(backend\/app\/[\w/]+\.py)(?:(::)${GAP}|:\d+(?:-\d+)?${GAP}|${GAP})(${NAME})?((?:[ \t]*\/${GAP}${NAME})*)`,
  "g",
);

// Plain words after a path ("and", "the") are prose. A name is taken as code
// when it follows "::", or is written like code: snake_case, CamelCase or CAPS.
function looksLikeCode(name) {
  return name.includes("_") || /^[A-Z][a-z0-9]+[A-Z]/.test(name) || /^[A-Z]{2,}[A-Z0-9]*$/.test(name);
}

function findMirrorMarkers(source) {
  const markers = [];
  for (const match of source.matchAll(MARKER)) {
    const [, file, doubleColon, first, rest] = match;
    const names = [];
    if (first && (doubleColon || looksLikeCode(first))) {
      names.push(first);
      for (const extra of rest.matchAll(new RegExp(NAME, "g"))) {
        if (looksLikeCode(extra[0])) names.push(extra[0]);
      }
    }
    markers.push({ file, names });
  }
  return markers;
}

function isDefinedIn(python, name) {
  // "Class.method" needs both parts; each is a def, a class or an assignment.
  return name.split(".").every((part) => new RegExp(
    String.raw`^[ \t]*(?:(?:async[ \t]+)?def|class)[ \t]+${part}\b|^[ \t]*${part}[ \t]*(?::[^=\n]+)?=[^=]`,
    "m",
  ).test(python));
}

describe("mirror marker parsing", () => {
  it("reads the file and the names written after it", () => {
    const source = [
      "// Mirrors backend/app/services/a.py::compute_stats (re-verified).",
      "/** Mirrors backend/app/schemas/b.py:106-121 Response._compute_total. */",
      "// Mirrors backend/app/services/c.py first_rule /",
      "// second_rule (1.1.24): prose.",
      " * Mirrors backend/app/services/d.py",
      " * count_overrides: prose.",
      "// Mirrors backend/app/services/e.py and other prose.",
      "// Mirrors backend/app/routes/f.py:60-70 (GET /api/x).",
    ].join("\n");
    expect(findMirrorMarkers(source)).toEqual([
      { file: "backend/app/services/a.py", names: ["compute_stats"] },
      { file: "backend/app/schemas/b.py", names: ["Response._compute_total"] },
      { file: "backend/app/services/c.py", names: ["first_rule", "second_rule"] },
      { file: "backend/app/services/d.py", names: ["count_overrides"] },
      { file: "backend/app/services/e.py", names: [] },
      { file: "backend/app/routes/f.py", names: [] },
    ]);
  });
});

describe("demo mirror markers point at server code that exists", () => {
  const markers = Object.entries(demoSources).flatMap(([path, source]) => (
    findMirrorMarkers(source).map((marker) => ({ ...marker, demoFile: path.startsWith("../") ? path.slice(3) : path }))
  ));

  it("finds the markers", () => {
    expect(markers.length).toBeGreaterThan(50);
    expect(markers.filter((marker) => marker.names.length > 0).length).toBeGreaterThan(30);
  });

  it("names only server files that exist", () => {
    const missing = markers
      .filter((marker) => !existsSync(inRepo(marker.file)))
      .map((marker) => `${marker.demoFile}: ${marker.file}`);
    expect([...new Set(missing)]).toEqual([]);
  });

  it("names only functions, classes and constants that exist in those files", () => {
    const missing = [];
    for (const marker of markers) {
      if (!existsSync(inRepo(marker.file))) continue;
      const python = readFileSync(inRepo(marker.file), "utf8");
      for (const name of marker.names) {
        if (!isDefinedIn(python, name)) missing.push(`${marker.demoFile}: ${marker.file}::${name}`);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });
});
