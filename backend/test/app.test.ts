import { afterEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";

import { buildApp } from "../src/app.js";

describe("GET /health", () => {
  const apps: ReturnType<typeof buildApp>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("reports healthy when FalkorDB responds with PONG", async () => {
    const app = buildApp({
      graphHealthClient: {
        ping: vi.fn().mockResolvedValue("PONG"),
        quit: vi.fn().mockResolvedValue(undefined),
      },
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      service: "backend",
      falkordb: "ok",
    });
  });

  it("reports degraded when FalkorDB cannot be reached", async () => {
    const app = buildApp({
      graphHealthClient: {
        ping: vi.fn().mockRejectedValue(new Error("connection refused")),
        quit: vi.fn().mockResolvedValue(undefined),
      },
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: "degraded",
      service: "backend",
      falkordb: "unavailable",
    });
  });
});

describe("GET /me", () => {
  const apps: ReturnType<typeof buildApp>[] = [];
  const secret = "test-internal-secret-that-is-at-least-32-chars";

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("rejects requests without a valid internal token", async () => {
    const app = buildApp({
      authInternalSecret: secret,
      graphHealthClient: {
        ping: vi.fn().mockResolvedValue("PONG"),
        quit: vi.fn().mockResolvedValue(undefined),
      },
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/me" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Authentication required" });
  });

  it("returns the authenticated GitHub identity from a valid token", async () => {
    const app = buildApp({
      authInternalSecret: secret,
      graphHealthClient: {
        ping: vi.fn().mockResolvedValue("PONG"),
        quit: vi.fn().mockResolvedValue(undefined),
      },
    });
    apps.push(app);
    const token = await new SignJWT({ email: "user@example.com" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject("github-user-123")
      .setIssuer("codetrace-frontend")
      .setAudience("codetrace-backend")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(secret));

    const response = await app.inject({
      headers: { authorization: `Bearer ${token}` },
      method: "GET",
      url: "/me",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      email: "user@example.com",
      userId: "github-user-123",
    });
  });
});
