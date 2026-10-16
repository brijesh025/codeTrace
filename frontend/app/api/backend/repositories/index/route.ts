import { proxyBackendRequest } from "../../../../../lib/backend-proxy";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return proxyBackendRequest("/repositories/index", {
    body: await request.text(),
    headers: { "content-type": request.headers.get("content-type") ?? "application/json" },
    method: "POST",
  });
}
