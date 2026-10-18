import { describe, expect, it } from "vitest";

import { createInvestigationPersistence } from "../src/investigation-persistence.js";

const record = {
  createdAt: "2026-10-19T00:00:00.000Z",
  id: "investigation-1",
  question: "What is affected?",
  repositoryId: "example/repository",
  status: "succeeded" as const,
  updatedAt: "2026-10-19T00:01:00.000Z",
  userId: "user-1",
};

class FakeGraph {
  readonly calls: Array<{
    parameters: Record<string, string | number | boolean>;
    query: string;
  }> = [];

  async query(
    query: string,
    parameters: Record<string, string | number | boolean>,
  ): Promise<{ columns: string[]; rows: unknown[][] }> {
    this.calls.push({ parameters, query });
    if (query.includes("MATCH (i:Investigation)")) {
      return {
        columns: ["userId", "payload"],
        rows: [[record.userId, JSON.stringify(record)]],
      };
    }
    return { columns: [], rows: [] };
  }
}

describe("Investigation persistence", () => {
  it("loads records and writes lifecycle snapshots through FalkorDB queries", async () => {
    const graph = new FakeGraph();
    const persistence = createInvestigationPersistence(graph);

    await expect(persistence.load()).resolves.toEqual([record]);
    await persistence.save(record);

    expect(graph.calls[0]?.query).toContain("MATCH (i:Investigation)");
    expect(graph.calls[1]?.query).toContain("MERGE (i:Investigation");
    expect(graph.calls[1]?.parameters.userId).toBe("user-1");
    expect(graph.calls[1]?.parameters.payload).toBe(JSON.stringify(record));
  });
});
