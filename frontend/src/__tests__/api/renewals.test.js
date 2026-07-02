import { clearToken } from "../../api/client.js";
import { getRenewalWorkbench } from "../../api/renewals.js";

const mockJsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: vi.fn(() => "application/json") },
  json: async () => body,
});

beforeEach(() => {
  clearToken();
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("renewals API", () => {
  test("fetches renewal workbench with window and view params", async () => {
    global.fetch.mockResolvedValue(mockJsonResponse([]));

    await getRenewalWorkbench({ window_days: 90, view: "due_60" });

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe("/api/renewals/workbench?window_days=90&view=due_60");
    expect(options.method).toBe("GET");
  });
});
