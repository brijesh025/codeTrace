import { describe, expect, it } from "vitest";

import { createInvestigationStore } from "../src/investigations.js";

const revision = {
  commitSha: "0123456789abcdef0123456789abcdef01234567",
  repositoryId: "example/repository",
};

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("Investigation store", () => {
  it("runs an owned investigation and persists its report", async () => {
    const store = createInvestigationStore({
      getRevision: () => revision,
      hasRepository: () => true,
      run: async () => ({
        report: {
          checklist: ["Inspect the caller."],
          findings: [],
          summary: "Evidence-backed result.",
          uncertainty: [],
        },
        toolCalls: 2,
        turns: 3,
      }),
    });

    const created = store.create({
      question: "What is affected?",
      repositoryId: revision.repositoryId,
      userId: "user-1",
    });
    if (!created) {
      throw new Error("Investigation was not created.");
    }
    expect(created).toEqual(
      expect.objectContaining({ commitSha: revision.commitSha, status: "queued" }),
    );

    await tick();
    expect(store.get("user-1", created.id)).toEqual(
      expect.objectContaining({
        report: expect.objectContaining({ summary: "Evidence-backed result." }),
        status: "succeeded",
        toolCalls: 2,
        turns: 3,
      }),
    );
    expect(store.get("user-2", created.id)).toBeNull();
  });

  it("persists structured runner failures", async () => {
    const store = createInvestigationStore({
      getRevision: () => revision,
      hasRepository: () => true,
      run: async () => {
        const error = new Error("provider unavailable") as Error & { code: string };
        error.code = "LLM_REQUEST_FAILED";
        throw error;
      },
    });

    const created = store.create({
      question: "What is affected?",
      repositoryId: revision.repositoryId,
      userId: "user-1",
    });
    if (!created) {
      throw new Error("Investigation was not created.");
    }
    await tick();

    expect(store.get("user-1", created.id)).toEqual(
      expect.objectContaining({
        error: { code: "LLM_REQUEST_FAILED", message: "provider unavailable" },
        status: "failed",
      }),
    );
  });
});
