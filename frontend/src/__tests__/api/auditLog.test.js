import { clearToken, setToken } from "../../api/client.js";
import { exportAuditLog } from "../../api/auditLog.js";

const mockCsvResponse = () => ({
  ok: true,
  status: 200,
  headers: { get: vi.fn(() => "text/csv") },
  blob: vi.fn(async () => new Blob(["id,action\n1,license.created\n"], { type: "text/csv" })),
});

const mockJsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: vi.fn(() => "application/json") },
  json: async () => body,
});

beforeEach(() => {
  clearToken();
  global.fetch = vi.fn();
  URL.createObjectURL = vi.fn(() => "blob:audit-log");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(window.HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("audit log API", () => {
  test("exports through the shared client with auth and cookies", async () => {
    global.fetch.mockResolvedValue(mockCsvResponse());
    setToken("audit-token");

    const result = await exportAuditLog({ action: "license", search: "Atlas" });

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe("/api/audit-log/export?action=license&search=Atlas");
    expect(options.credentials).toBe("include");
    expect(options.headers.Authorization).toBe("Bearer audit-token");
    expect(result).toEqual({ data: null, error: null });
  });

  test("returns an error when export fails", async () => {
    global.fetch.mockResolvedValue(mockJsonResponse({ detail: "Admin access required" }, 403));

    const result = await exportAuditLog();

    expect(result).toEqual({ data: null, error: "Admin access required" });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
