import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { get } from "../../api/client.js";
import { downloadApiFile } from "../../api/download.js";

vi.mock("../../api/client.js", () => ({
  get: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = vi.fn(() => "blob:download");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(window.HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("downloadApiFile", () => {
  test("downloads an authenticated API response with the requested filename", async () => {
    const blob = new Blob(["report"], { type: "text/csv" });
    const response = { blob: vi.fn().mockResolvedValue(blob) };
    get.mockResolvedValue({ data: response, error: null });

    const result = await downloadApiFile("/api/report", { filename: "report.csv" });

    expect(get).toHaveBeenCalledWith("/api/report");
    expect(response.blob).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    const anchor = window.HTMLAnchorElement.prototype.click.mock.instances[0];
    expect(anchor.href).toBe("blob:download");
    expect(anchor.download).toBe("report.csv");
    expect(anchor.isConnected).toBe(false);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:download");
    expect(result).toEqual({ data: null, error: null });
  });

  test("preserves API errors and uses the caller fallback for an empty response", async () => {
    get.mockResolvedValueOnce({ data: null, error: "Access denied" });
    await expect(downloadApiFile("/api/report")).resolves.toEqual({
      data: null,
      error: "Access denied",
    });

    get.mockResolvedValueOnce({ data: null, error: null });
    await expect(downloadApiFile("/api/report", { fallbackError: "Export failed" })).resolves.toEqual({
      data: null,
      error: "Export failed",
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
