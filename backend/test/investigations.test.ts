import { describe, expect, it } from "vitest";

import { createInvestigationStore } from "../src/investigations.js";
import type { InvestigationMemoryStore } from "../src/memory.js";

const revision = {
  commitSha: "0123456789abcdef0123456789abcdef01234567",
  repositoryId: "example/repository",
};

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("Investigation store", () => {
  it("restores owned records and persists new history snapshots", async () => {
    const saved: Array<{ id: string; status: string }> = [];
    const store = createInvestigationStore({
      hasRepository: () => true,
      persistence: {
        load: async () => [
          {
            createdAt: "2026-10-18T00:00:00.000Z",
            id: "investigation-restored",
            question: "What is affected?",
            repositoryId: revision.repositoryId,
            status: "succeeded" as const,
            updatedAt: "2026-10-18T00:01:00.000Z",
            userId: "user-1",
          },
          {
            createdAt: "2026-10-18T00:02:00.000Z",
            id: "investigation-interrupted",
            question: "What was running?",
            repositoryId: revision.repositoryId,
            status: "running" as const,
            updatedAt: "2026-10-18T00:03:00.000Z",
            userId: "user-1",
          },
        ],
        save: async (record) => {
          saved.push({ id: record.id, status: record.status });
        },
      },
    });

    await store.ready?.();

    expect(store.get("user-1", "investigation-restored")).toEqual(
      expect.objectContaining({ status: "succeeded" }),
    );
    expect(store.get("user-1", "investigation-interrupted")).toEqual(
      expect.objectContaining({
        error: {
          code: "INVESTIGATION_INTERRUPTED",
          message:
            "The investigation was interrupted by a backend restart. Start a new run to retry.",
        },
        status: "failed",
      }),
    );
    expect(store.get("user-2", "investigation-restored")).toBeNull();

    const created = store.create({
      question: "What should I inspect?",
      repositoryId: revision.repositoryId,
      userId: "user-1",
    });
    if (!created) {
      throw new Error("Investigation was not created.");
    }
    await tick();

    expect(saved).toContainEqual({ id: "investigation-interrupted", status: "failed" });
    expect(saved).toContainEqual({ id: created.id, status: "pending" });
  });

  it("runs an owned investigation and persists its report", async () => {
    let runnerModel: string | undefined;
    const store = createInvestigationStore({
      getRevision: () => revision,
      hasRepository: () => true,
      run: async (input) => {
        runnerModel = input.modelId;
        return {
          report: {
            checklist: ["Inspect the caller."],
            findings: [],
            summary: "Evidence-backed result.",
            uncertainty: [],
          },
          trace: [],
          toolCalls: 2,
          turns: 3,
        };
      },
    });

    const created = store.create({
      modelId: "openai/gpt-oss-20b",
      question: "What is affected?",
      repositoryId: revision.repositoryId,
      userId: "user-1",
    });
    if (!created) {
      throw new Error("Investigation was not created.");
    }
    expect(created).toEqual(
      expect.objectContaining({
        commitSha: revision.commitSha,
        modelId: "openai/gpt-oss-20b",
        status: "queued",
      }),
    );

    await tick();
    expect(runnerModel).toBe("openai/gpt-oss-20b");
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

  it("loads prior memory before running and saves the completed report", async () => {
    let receivedMemoryCount = 0;
    let savedInvestigationId: string | undefined;
    const memoryStore: InvestigationMemoryStore = {
      search: async () => [
        {
          checklist: [],
          createdAt: "2026-10-18T00:00:00.000Z",
          findings: [],
          id: "memory-1",
          investigationId: "previous-investigation",
          question: "What is affected?",
          repositoryId: revision.repositoryId,
          sourceCommitSha: revision.commitSha,
          summary: "A previous answer exists.",
          uncertainty: [],
        },
      ],
      save: async ({ investigationId }) => {
        savedInvestigationId = investigationId;
      },
    };
    const store = createInvestigationStore({
      getRevision: () => revision,
      hasRepository: () => true,
      memoryStore,
      run: async (input) => {
        receivedMemoryCount = input.priorMemories?.length ?? 0;
        return {
          report: {
            checklist: [],
            findings: [],
            summary: "Evidence-backed result.",
            uncertainty: [],
          },
          trace: [],
          toolCalls: 1,
          turns: 1,
        };
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

    expect(receivedMemoryCount).toBe(1);
    expect(savedInvestigationId).toBe(created.id);
  });
});
