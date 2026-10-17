import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";

import { verifyBackendToken } from "./auth.js";
import type { GraphHealthClient } from "./graph-health.js";
import type { BackendPrincipal } from "./auth.js";
import type { IndexJobManager } from "./indexing.js";
import type { InvestigationStore } from "./investigations.js";
import type { ModelRegistry } from "./models.js";

export interface BuildAppOptions {
  authInternalSecret?: string;
  graphHealthClient: GraphHealthClient;
  indexingService?: Pick<IndexJobManager, "getStatus" | "hasRepository" | "start">;
  investigationStore?: InvestigationStore;
  modelRegistry?: ModelRegistry;
}

const indexRequestSchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(128).optional(),
    repositoryUrl: z.string().trim().url(),
  })
  .strict();

const investigationRequestSchema = z
  .object({
    modelId: z.string().trim().min(1).max(100).optional(),
    question: z.string().trim().min(1).max(2_000),
    repositoryId: z.string().trim().min(1).max(200),
  })
  .strict();

const idParamsSchema = z.object({ id: z.string().trim().min(1) });

async function authenticate(
  request: FastifyRequest,
  secret: string | undefined,
): Promise<BackendPrincipal | null> {
  return verifyBackendToken(request.headers.authorization, secret);
}

function validationError(reply: FastifyReply, issues: unknown) {
  return reply.code(400).send({ error: "Invalid request", issues });
}

export function buildApp({
  authInternalSecret,
  graphHealthClient,
  indexingService,
  investigationStore,
  modelRegistry,
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

  app.get("/models", async (request, reply) => {
    const principal = await authenticate(request, authInternalSecret);
    if (!principal) {
      return reply.code(401).send({ error: "Authentication required" });
    }
    if (!modelRegistry) {
      return reply.code(503).send({ error: "Model registry is not configured" });
    }
    return { defaultModel: modelRegistry.defaultModel, models: modelRegistry.list() };
  });

  app.post("/repositories/index", async (request, reply) => {
    const principal = await authenticate(request, authInternalSecret);
    if (!principal) {
      return reply.code(401).send({ error: "Authentication required" });
    }

    if (!indexingService) {
      return reply.code(503).send({ error: "Indexing service is not configured" });
    }

    const parsed = indexRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return validationError(reply, parsed.error.issues);
    }

    try {
      const result = indexingService.start({ ...parsed.data, userId: principal.userId });
      return reply.code(result.duplicate ? 200 : 202).send(result.job);
    } catch (error) {
      const statusCode =
        error instanceof Error && error.name === "IndexingConflictError" ? 409 : 400;
      return reply.code(statusCode).send({
        error: error instanceof Error ? error.message : "Could not start indexing",
      });
    }
  });

  app.get("/repositories/:id/index-status", async (request, reply) => {
    const principal = await authenticate(request, authInternalSecret);
    if (!principal) {
      return reply.code(401).send({ error: "Authentication required" });
    }

    if (!indexingService) {
      return reply.code(503).send({ error: "Indexing service is not configured" });
    }

    const parsed = idParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return validationError(reply, parsed.error.issues);
    }

    const job = indexingService.getStatus(principal.userId, parsed.data.id);
    if (!job) {
      return reply.code(404).send({ error: "Indexing job not found" });
    }

    return job;
  });

  app.post("/investigations", async (request, reply) => {
    const principal = await authenticate(request, authInternalSecret);
    if (!principal) {
      return reply.code(401).send({ error: "Authentication required" });
    }

    if (!investigationStore) {
      return reply.code(503).send({ error: "Investigation service is not configured" });
    }

    const parsed = investigationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return validationError(reply, parsed.error.issues);
    }

    const modelId = parsed.data.modelId ?? modelRegistry?.defaultModel ?? undefined;
    if (modelRegistry && (!modelId || !modelRegistry.has(modelId))) {
      return reply.code(400).send({ error: "Selected model is not available." });
    }

    const investigation = investigationStore.create({
      ...parsed.data,
      ...(modelId ? { modelId } : {}),
      userId: principal.userId,
    });
    if (!investigation) {
      return reply.code(404).send({ error: "Repository not found" });
    }

    const statusCode =
      investigation.status === "queued" || investigation.status === "running" ? 202 : 201;
    return reply.code(statusCode).send(investigation);
  });

  app.get("/investigations/:id", async (request, reply) => {
    const principal = await authenticate(request, authInternalSecret);
    if (!principal) {
      return reply.code(401).send({ error: "Authentication required" });
    }

    if (!investigationStore) {
      return reply.code(503).send({ error: "Investigation service is not configured" });
    }

    const parsed = idParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return validationError(reply, parsed.error.issues);
    }

    const investigation = investigationStore.get(principal.userId, parsed.data.id);
    if (!investigation) {
      return reply.code(404).send({ error: "Investigation not found" });
    }

    return investigation;
  });

  app.addHook("onClose", async () => {
    await investigationStore?.close?.();
    await graphHealthClient.quit();
  });

  return app;
}
