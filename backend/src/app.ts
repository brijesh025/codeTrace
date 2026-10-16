import Fastify, { type FastifyInstance } from "fastify";

import { verifyBackendToken } from "./auth.js";
import type { GraphHealthClient } from "./graph-health.js";

export interface BuildAppOptions {
  authInternalSecret?: string;
  graphHealthClient: GraphHealthClient;
}

export function buildApp({
  authInternalSecret,
  graphHealthClient,
}: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: true });

  app.get("/health", async (_request, reply) => {
    try {
      const pingResult = await graphHealthClient.ping();

      if (pingResult !== "PONG") {
        throw new Error(`Unexpected FalkorDB ping response: ${pingResult}`);
      }

      return {
        status: "ok",
        service: "backend",
        falkordb: "ok",
      };
    } catch {
      return reply.code(503).send({
        status: "degraded",
        service: "backend",
        falkordb: "unavailable",
      });
    }
  });

  app.get("/me", async (request, reply) => {
    const principal = await verifyBackendToken(request.headers.authorization, authInternalSecret);

    if (!principal) {
      return reply.code(401).send({ error: "Authentication required" });
    }

    return principal;
  });

  app.addHook("onClose", async () => {
    await graphHealthClient.quit();
  });

  return app;
}
