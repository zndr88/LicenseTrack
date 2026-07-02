import { apiUrl, request, setToken, clearToken } from "../../api/client.js"

// NOTE: client.js uses an in-memory token (_token variable), NOT localStorage.
// Tests use setToken()/clearToken() rather than localStorage.setItem().

const mockJsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: vi.fn(() => "application/json") },
  json: async () => body,
})

beforeEach(() => {
  clearToken()
  global.fetch = vi.fn()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("API client", () => {
  test("defaults API calls to the current origin", () => {
    expect(apiUrl("/api/test")).toBe("/api/test")
  })

  test("uses VITE_API_URL when a split API host is configured", async () => {
    vi.resetModules()
    vi.stubEnv("VITE_API_URL", "http://localhost:8000/")
    const { apiUrl: configuredApiUrl } = await import("../../api/client.js")

    expect(configuredApiUrl("/api/test")).toBe("http://localhost:8000/api/test")
  })

  // 6a
  test("attaches Authorization header when token is set", async () => {
    global.fetch.mockResolvedValue(mockJsonResponse({}))
    setToken("my-token")
    await request("/api/test")
    const [, options] = global.fetch.mock.calls[0]
    expect(options.headers["Authorization"]).toBe("Bearer my-token")
  })

  // 6b
  test("does NOT attach Authorization header when no token", async () => {
    global.fetch.mockResolvedValue(mockJsonResponse({}))
    // clearToken() already called in beforeEach
    await request("/api/test")
    const [, options] = global.fetch.mock.calls[0]
    expect(options.headers).not.toHaveProperty("Authorization")
  })

  // 6c
  test("returns error object on network failure, does not throw", async () => {
    global.fetch.mockRejectedValue(new Error("Network error"))
    const result = await request("/api/test")
    expect(result.error).toBeTruthy()
    expect(typeof result.error).toBe("string")
    expect(result.data).toBeNull()
  })

  // 6d
  test("redirects to / on 401 response", async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 401,
      headers: { get: vi.fn(() => "application/json") },
      json: async () => ({}),
    })
    // Patch window.location so we can observe the href assignment
    const originalLocation = window.location
    delete window.location
    window.location = { href: "" }

    const result = await request("/api/test")

    expect(window.location.href).toBe("/")
    expect(result.error).toBeTruthy()

    // Restore
    window.location = originalLocation
  })
})
