import { describe, expect, it } from "vitest";

import { RepositoryMemoryStore } from "../src/memory.js";

class FakeGraph {
  readonly queries: Array<{
    parameters: Record<string, string | number | boolean>;
    query: string;
  }> = [];

  async query(
    query: string,
    parameters: Record<string, string | number | boolean>,
  ): Promise<{ columns: string[]; rows: unknown[][] }> {
    this.queries.push({ parameters, query });
    if (query.includes("MATCH (m:Memory)")) {
      const payload = JSON.stringify({
        checklist: ["Inspect callers."],
        createdAt: "ignored-by-row",
        findings: [],
        id: "ignored-by-row",
        investigationId: "ignored-by-row",
        question: "ignored-by-row",
        repositoryId: "ignored-by-row",
        sourceCommitSha: "ignored-by-row",
        summary: "The previous investigation found a direct caller.",
        uncertainty: [],
      });
      return {
        columns: [
          "id",
          "investigationId",
          "repositoryId",
          "sourceCommitSha",
          "createdAt",
          "payload",
        ],
        rows: [
          [
            "memory-1",
            "investigation-1",
            "example/repository",
            "0123456789abcdef0123456789abcdef01234567",
            "2026-10-18T00:00:00.000Z",
            payload,
          ],
        ],
      };
    }
    return { columns: [], rows: [] };
  }
}

describe("RepositoryMemoryStore", () => {
  it("stores compact report memory and retrieves it by repository and user", async () => {
    const graph = new FakeGraph();
    const store = new RepositoryMemoryStore(graph);

    await store.save({
      investigationId: "investigation-1",
      question: "What callers are affected?",
      report: {
        checklist: ["Inspect callers."],
        findings: [],
        summary: "The previous investigation found a direct caller.",
        uncertainty: [],
      },
      repositoryId: "example/repository",
      sourceCommitSha: "0123456789abcdef0123456789abcdef01234567",
      userId: "user-1",
    });

    const memories = await store.search({
      question: "Which callers are affected?",
      repositoryId: "example/repository",
      userId: "user-1",
    });

    expect(graph.queries[0]?.query).toContain("MERGE (m:Memory");
    expect(graph.queries[0]?.parameters.userId).toBe("user-1");
    expect(graph.queries[1]?.query).toContain("m.userId = $userId");
    expect(graph.queries[1]?.parameters.term0).toBe("which");
    expect(memories).toEqual([
      expect.objectContaining({
        id: "memory-1",
        investigationId: "investigation-1",
        sourceCommitSha: "0123456789abcdef0123456789abcdef01234567",
        summary: "The previous investigation found a direct caller.",
      }),
    ]);
  });
});
