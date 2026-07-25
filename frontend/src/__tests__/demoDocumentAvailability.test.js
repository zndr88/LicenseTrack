import { beforeEach, describe, expect, test } from "vitest";
import { demoRequest } from "../demo/router.js";
import { resetStore, seedStore } from "../demo/store.js";

describe("demo document availability", () => {
  beforeEach(() => {
    resetStore();
    seedStore();
  });

  test("contract documents are explicitly available in demo mode", async () => {
    const { data, error } = await demoRequest("/api/contracts/301/documents");

    expect(error).toBeNull();
    expect(data).not.toHaveLength(0);
    expect(data.every((document) => document.fileAvailability === "available")).toBe(true);
  });
});
