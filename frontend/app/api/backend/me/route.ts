import { auth } from "../../../../auth";
import { createBackendToken } from "../../../../lib/internal-auth";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const backendUrl = process.env.BACKEND_URL;
  const internalSecret = process.env.AUTH_INTERNAL_SECRET;

  if (!backendUrl || !internalSecret) {
    return Response.json({ error: "Backend authentication is not configured" }, { status: 503 });
  }

  const token = await createBackendToken({
    email: session.user.email,
    secret: internalSecret,
    userId,
  });
  const upstreamResponse = await fetch(new URL("/me", backendUrl), {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  const body = await upstreamResponse.text();

  return new Response(body, {
    headers: { "content-type": upstreamResponse.headers.get("content-type") ?? "application/json" },
    status: upstreamResponse.status,
  });
}
