import { afterEach, describe, expect, it, vi } from "vitest";

import { proxyBackendRequest } from "../lib/backend-proxy";

const authMock = vi.hoisted(() => vi.fn());
const tokenMock = vi.hoisted(() => vi.fn(async () => "signed-test-token"));

vi.mock("../auth", () => ({ auth: authMock }));
vi.mock("../lib/internal-auth", () => ({ createBackendToken: tokenMock }));

describe("proxyBackendRequest", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    authMock.mockReset();
    tokenMock.mockClear();
  });

  it("rejects requests without a signed-in session", async () => {
    authMock.mockResolvedValue(null);

    const response = await proxyBackendRequest("/me");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication required" });
  });

  it("forwards authenticated requests through the server boundary", async () => {
    authMock.mockResolvedValue({ user: { email: "user@example.com", id: "github-user-1" } });
    vi.stubEnv("AUTH_INTERNAL_SECRET", "test-internal-secret");
    vi.stubEnv("BACKEND_URL", "http://127.0.0.1:5001");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));

    const response = await proxyBackendRequest("/repositories/index", {
      body: JSON.stringify({ repositoryUrl: "https://github.com/octocat/hello-world" }),
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("/repositories/index", "http://127.0.0.1:5001"),
      expect.objectContaining({
        body: JSON.stringify({ repositoryUrl: "https://github.com/octocat/hello-world" }),
        headers: expect.objectContaining({
          authorization: "Bearer signed-test-token",
          "content-type": "application/json",
        }),
        method: "POST",
      }),
    );
  });

  it("returns a controlled error when the backend cannot be reached", async () => {
    authMock.mockResolvedValue({ user: { id: "github-user-1" } });
    vi.stubEnv("AUTH_INTERNAL_SECRET", "test-internal-secret");
    vi.stubEnv("BACKEND_URL", "http://127.0.0.1:5001");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connection refused"));

    const response = await proxyBackendRequest("/me");

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Backend is unavailable" });
  });
});
