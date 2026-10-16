import { afterEach, describe, expect, it } from "vitest";
import { SignJWT } from "jose";

import { buildApp } from "../src/app.js";
import { createInvestigationStore } from "../src/investigations.js";

const secret = "phase-eight-api-secret-that-is-at-least-32-chars";
const revision = {
  commitSha: "0123456789abcdef0123456789abcdef01234567",
  repositoryId: "example/repository",
};

async function token(userId: string): Promise<string> {
  return new SignJWT()
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuer("codetrace-frontend")
    .setAudience("codetrace-backend")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(secret));
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("Phase 8 investigation API", () => {
  const apps: Array<ReturnType<typeof buildApp>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("starts an owned investigation and exposes the completed evidence-backed report", async () => {
    const store = createInvestigationStore({
      getRevision: () => revision,
      hasRepository: () => true,
      run: async () => ({
        report: {
          checklist: ["Inspect the caller."],
          findings: [],
          summary: "The report is evidence-backed.",
          uncertainty: [],
        },
        toolCalls: 1,
        turns: 2,
      }),
    });
    const app = buildApp({
      authInternalSecret: secret,
      graphHealthClient: {
        ping: async () => "PONG",
        quit: async () => undefined,
      },
      investigationStore: store,
    });
    apps.push(app);

    const started = await app.inject({
      headers: { authorization: `Bearer ${await token("user-1")}` },
      method: "POST",
      payload: { question: "What is affected?", repositoryId: revision.repositoryId },
      url: "/investigations",
    });
    expect(started.statusCode).toBe(202);
    const investigationId = started.json().id;

    await tick();
    const completed = await app.inject({
      headers: { authorization: `Bearer ${await token("user-1")}` },
      method: "GET",
      url: `/investigations/${investigationId}`,
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toEqual(
      expect.objectContaining({
        commitSha: revision.commitSha,
        report: expect.objectContaining({ summary: "The report is evidence-backed." }),
        status: "succeeded",
      }),
    );
  });
});
