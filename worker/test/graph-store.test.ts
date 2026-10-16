import { describe, expect, it } from "vitest";

import { GraphStore } from "../src/index.js";

class FakeGraphClient {
  readonly commands: Array<{ args: string[]; command: string }> = [];

  async call(command: string, ...args: string[]): Promise<unknown> {
    this.commands.push({ args, command });
    const query = args[1] ?? "";

    if (query.includes("RETURN count(n)")) {
      return [["count(n)"], [[3]]];
    }

    if (query.includes("RETURN count(r)")) {
      return [["count(r)"], [[2]]];
    }

    return "OK";
  }

  async quit(): Promise<void> {}
}

const input = {
  commitSha: "0123456789abcdef0123456789abcdef01234567",
  diagnostics: [],
  entities: [
    {
      confidence: 1,
      id: "repository-id",
      kind: "Repository" as const,
      lineEnd: 1,
      lineStart: 1,
      name: "example/repo",
      path: "",
      provenance: "tree-sitter" as const,
    },
    {
      confidence: 0.95,
      id: "file-id",
      kind: "File" as const,
      lineEnd: 10,
      lineStart: 1,
      name: "src/index.ts",
      path: "src/index.ts",
      provenance: "tree-sitter" as const,
    },
  ],
  relationships: [
    {
      confidence: 1,
      fromId: "repository-id",
      id: "contains-id",
      kind: "CONTAINS" as const,
      toId: "file-id",
    },
  ],
  repositoryId: "example/repo",
};

describe("GraphStore", () => {
  it("uses parameterized MERGE queries and returns revision counts", async () => {
    const client = new FakeGraphClient();
    const store = new GraphStore({ client, graphName: "codetrace_test" });

    const result = await store.load(input);

    expect(result).toEqual({
      commitSha: input.commitSha,
      nodeCount: 3,
      relationshipCount: 2,
      repositoryId: input.repositoryId,
    });
    expect(client.commands.filter(({ args }) => args[0] === "codetrace_test")).toHaveLength(6);
    const nodeQuery = client.commands.find(({ args }) => args[1]?.includes("MERGE (n:File"));
    expect(nodeQuery?.args[1]).toContain("CYPHER");
    expect(nodeQuery?.args[1]).toContain("id='file-id'");
    expect(nodeQuery?.args[1]).toContain("MERGE (n:File {id: $id})");
  });

  it("keeps repeated loads idempotent through stable MERGE keys", async () => {
    const client = new FakeGraphClient();
    const store = new GraphStore({ client });

    await store.load(input);
    await store.load(input);

    const queries = client.commands.map(({ args }) => args[1] ?? "");
    expect(queries.filter((query) => query.includes("MERGE (n:")).length).toBe(4);
    expect(queries.filter((query) => query.includes("MERGE (from)-[r:")).length).toBe(2);
    expect(queries.filter((query) => query.includes("DETACH DELETE")).length).toBe(2);
  });

  it("rejects unsafe graph names", () => {
    expect(() => new GraphStore({ client: new FakeGraphClient(), graphName: "bad name" })).toThrow(
      "Graph name contains unsupported characters.",
    );
  });
});
