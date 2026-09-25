import { afterEach, describe, expect, it, vi } from "vitest";
import { request } from "../../api/client.js";

describe("api client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the application request header on every request", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await request("/api/settings", { method: "PUT", body: JSON.stringify({ theme: "dark" }), redirectOn401: false });
    const [, init] = fetchMock.mock.calls.at(-1);
    expect(init.headers["X-LicenseTrack-Request"]).toBe("1");
  });

  it("sends the header on uploads too", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await request("/api/documents", { method: "POST", body: new FormData(), redirectOn401: false });
    const [, init] = fetchMock.mock.calls.at(-1);
    expect(init.headers["X-LicenseTrack-Request"]).toBe("1");
  });
});
