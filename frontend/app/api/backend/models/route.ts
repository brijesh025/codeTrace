import { proxyBackendRequest } from "../../../../lib/backend-proxy";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return proxyBackendRequest("/models");
}
