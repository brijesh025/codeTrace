import { proxyBackendRequest } from "../../../../../../lib/backend-proxy";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return proxyBackendRequest(`/repositories/${encodeURIComponent(id)}/index-status`);
}
