import { afterEach, describe, expect, it } from "vitest";
import { SignJWT } from "jose";

import { buildApp } from "../src/app.js";
import { IndexJobManager, type RepositoryIndexer } from "../src/indexing.js";
import { createInvestigationStore } from "../src/investigations.js";

const secret = "phase-six-test-secret-that-is-at-least-32-chars";

async function token(userId: string): Promise<string> {
  return new SignJWT({ email: `${userId}@example.com` })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuer("codetrace-frontend")
    .setAudience("codetrace-backend")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(secret));
}

describe("Phase 6 API", () => {
  const apps: Array<ReturnType<typeof buildApp>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("requires authentication and validates index requests", async () => {
    const indexingService = new IndexJobManager({
      indexRepository: async () => ({
        commitSha: "0123456789abcdef0123456789abcdef01234567",
        diagnosticsCount: 0,
        filesProcessed: 0,
        nodeCount: 0,
        relationshipCount: 0,
        repositoryId: "octocat/hello-world",
      }),
    });
    const app = buildApp({
      authInternalSecret: secret,
      graphHealthClient: {
        ping: async () => "PONG",
        quit: async () => undefined,
      },
      indexingService,
    });
    apps.push(app);

    const unauthenticated = await app.inject({
      method: "POST",
      payload: { repositoryUrl: "https://github.com/octocat/hello-world" },
      url: "/repositories/index",
    });
    expect(unauthenticated.statusCode).toBe(401);

    const invalid = await app.inject({
      headers: { authorization: `Bearer ${await token("user-1")}` },
      method: "POST",
      payload: { repositoryUrl: "https://example.com/not-github" },
      url: "/repositories/index",
    });
    expect(invalid.statusCode).toBe(400);
  });

  it("starts indexing, polls status, deduplicates requests, and protects investigations", async () => {
    let resolveIndex!: (result: Awaited<ReturnType<RepositoryIndexer>>) => void;
    const indexPromise = new Promise<Awaited<ReturnType<RepositoryIndexer>>>((resolve) => {
      resolveIndex = resolve;
    });
    const indexRepository: RepositoryIndexer = async (_url, reportProgress) => {
      reportProgress({ filesDiscovered: 2 });
      return indexPromise;
    };
    const indexingService = new IndexJobManager({ indexRepository });
    const app = buildApp({
      authInternalSecret: secret,
      graphHealthClient: {
        ping: async () => "PONG",
        quit: async () => undefined,
      },
      indexingService,
      investigationStore: createInvestigationStore((userId, repositoryId) =>
        indexingService.hasRepository(userId, repositoryId),
      ),
    });
    apps.push(app);
    const userToken = await token("user-1");

    const started = await app.inject({
      headers: { authorization: `Bearer ${userToken}` },
      method: "POST",
      payload: {
        idempotencyKey: "index-request-1",
        repositoryUrl: "https://github.com/octocat/hello-world",
      },
      url: "/repositories/index",
    });
    expect(started.statusCode).toBe(202);
    const job = started.json();
    expect(job).toEqual(
      expect.objectContaining({ repositoryId: "octocat/hello-world", status: "queued" }),
    );

    const duplicate = await app.inject({
      headers: { authorization: `Bearer ${userToken}` },
      method: "POST",
      payload: {
        idempotencyKey: "index-request-1",
        repositoryUrl: "https://github.com/octocat/hello-world.git",
      },
      url: "/repositories/index",
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json().id).toBe(job.id);

    const status = await app.inject({
      headers: { authorization: `Bearer ${userToken}` },
      method: "GET",
      url: `/repositories/${job.id}/index-status`,
    });
    expect(status.statusCode).toBe(200);
    expect(status.json().progress.filesDiscovered).toBe(2);

    const investigation = await app.inject({
      headers: { authorization: `Bearer ${userToken}` },
      method: "POST",
      payload: {
        question: "Which callers should I inspect if the entry point changes?",
        repositoryId: "octocat/hello-world",
      },
      url: "/investigations",
    });
    expect(investigation.statusCode).toBe(201);
    const investigationId = investigation.json().id;

    const foreignRead = await app.inject({
      headers: { authorization: `Bearer ${await token("user-2")}` },
      method: "GET",
      url: `/investigations/${investigationId}`,
    });
    expect(foreignRead.statusCode).toBe(404);

    resolveIndex({
      commitSha: "0123456789abcdef0123456789abcdef01234567",
      diagnosticsCount: 0,
      filesProcessed: 2,
      nodeCount: 5,
      relationshipCount: 4,
      repositoryId: "octocat/hello-world",
    });
  });
});
