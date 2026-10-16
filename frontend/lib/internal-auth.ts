import { SignJWT } from "jose";

const INTERNAL_ISSUER = "codetrace-frontend";
const INTERNAL_AUDIENCE = "codetrace-backend";
const INTERNAL_TOKEN_TTL_SECONDS = 5 * 60;

function getSecretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function createBackendToken({
  email,
  secret,
  userId,
}: {
  email?: string | null;
  secret: string;
  userId: string;
}): Promise<string> {
  const claims = email ? { email } : {};

  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuer(INTERNAL_ISSUER)
    .setAudience(INTERNAL_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${INTERNAL_TOKEN_TTL_SECONDS}s`)
    .sign(getSecretKey(secret));
}

export const backendTokenClaims = {
  audience: INTERNAL_AUDIENCE,
  issuer: INTERNAL_ISSUER,
};
