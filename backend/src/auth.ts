import { jwtVerify, type JWTPayload } from "jose";

const INTERNAL_ISSUER = "codetrace-frontend";
const INTERNAL_AUDIENCE = "codetrace-backend";

export interface BackendPrincipal {
  email?: string;
  userId: string;
}

function getSecretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

function toPrincipal(payload: JWTPayload): BackendPrincipal | null {
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    return null;
  }

  return {
    ...(typeof payload.email === "string" ? { email: payload.email } : {}),
    userId: payload.sub,
  };
}

export async function verifyBackendToken(
  authorizationHeader: string | undefined,
  secret: string | undefined,
): Promise<BackendPrincipal | null> {
  if (!secret || !authorizationHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authorizationHeader.slice("Bearer ".length).trim();

  if (!token) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, getSecretKey(secret), {
      audience: INTERNAL_AUDIENCE,
      issuer: INTERNAL_ISSUER,
    });

    return toPrincipal(payload);
  } catch {
    return null;
  }
}
