import { jwtVerify } from "jose";
import { describe, expect, it } from "vitest";

import { backendTokenClaims, createBackendToken } from "../lib/internal-auth";

describe("createBackendToken", () => {
  it("creates a short-lived token accepted by the backend contract", async () => {
    const token = await createBackendToken({
      email: "user@example.com",
      secret: "test-internal-secret-that-is-at-least-32-chars",
      userId: "github-user-123",
    });
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode("test-internal-secret-that-is-at-least-32-chars"),
      backendTokenClaims,
    );

    expect(payload.sub).toBe("github-user-123");
    expect(payload.email).toBe("user@example.com");
    expect(payload.exp).toBeTypeOf("number");
  });
});
