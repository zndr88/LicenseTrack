import { describe, expect, test } from "vitest";

import { isChunkLoadError } from "../utils/chunkLoadError.js";

describe("isChunkLoadError", () => {
  test.each([
    "Failed to fetch dynamically imported module: https://lt.example/assets/HelpPage-1a2b.js",
    "error loading dynamically imported module: https://lt.example/assets/HelpPage-1a2b.js",
    "Importing a module script failed.",
    "Unable to preload CSS for /assets/HelpPage-1a2b.css",
    "Loading chunk 12 failed.",
  ])("recognises %s", (message) => {
    expect(isChunkLoadError(new TypeError(message))).toBe(true);
  });

  test("recognises an error named ChunkLoadError", () => {
    const error = new Error("timeout");
    error.name = "ChunkLoadError";
    expect(isChunkLoadError(error)).toBe(true);
  });

  test.each([
    [new Error("Cannot read properties of undefined (reading 'map')")],
    [new TypeError("Failed to fetch")],
    [null],
    [undefined],
    [{}],
  ])("does not flag an ordinary failure (%s)", (error) => {
    expect(isChunkLoadError(error)).toBe(false);
  });
});
