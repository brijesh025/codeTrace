import { describe, expect, it } from "vitest";

import {
  InvestigationToolError,
  InvestigationTools,
  type GraphQueryClient,
  type InvestigationEntity,
  type InvestigationRelationshipKind,
} from "../src/index.js";

const scope = {
  commitSha: "0123456789abcdef0123456789abcdef01234567",
  repositoryId: "example/repository",
};

function entity(
  id: string,
  name: string,
  kind: InvestigationEntity["kind"] = "Function",
  path = `src/${name}.ts`,
): InvestigationEntity {
  return {
    confidence: 0.9,
    id,
    kind,
    lineEnd: 8,
    lineStart: 2,
    name,
    path,
    provenance: "tree-sitter",
  };
}

const entityColumns = [
  "Id",
  "Kind",
  "Name",
  "Path",
  "LineStart",
  "LineEnd",
  "Provenance",
  "Confidence",
];

const hopColumns = [
  "sourceId",
  "sourceKind",
  "sourceName",
  "sourcePath",
  "sourceLineStart",
  "sourceLineEnd",
  "sourceProvenance",
  "sourceConfidence",
  "targetId",
  "targetKind",
  "targetName",
  "targetPath",
  "targetLineStart",
  "targetLineEnd",
  "targetProvenance",
  "targetConfidence",
  "relationshipId",
  "relationshipKind",
  "relationshipConfidence",
  "graphFromId",
  "graphToId",
];

function entityRow(value: InvestigationEntity): unknown[] {
  return [
    value.id,
    value.kind,
    value.name,
    value.path,
    value.lineStart,
    value.lineEnd,
    value.provenance,
    value.confidence,
  ];
}

function hopRow(
  source: InvestigationEntity,
  target: InvestigationEntity,
  relationshipKind: InvestigationRelationshipKind,
  direction: "incoming" | "outgoing",
): unknown[] {
  return [
    ...entityRow(source),
    ...entityRow(target),
    `${source.id}-${target.id}-${relationshipKind}`,
    relationshipKind,
    0.8,
    direction === "outgoing" ? source.id : target.id,
    direction === "outgoing" ? target.id : source.id,
  ];
}

class FakeGraph implements GraphQueryClient {
  readonly queries: Array<{
    parameters: Record<string, string | number | boolean>;
    query: string;
  }> = [];

  private readonly entities = new Map([
    ["root", entity("root", "run", "Function")],
    ["dependency", entity("dependency", "helper", "Function")],
    ["leaf", entity("leaf", "leaf", "Function")],
    ["caller", entity("caller", "caller", "Function")],
    [
      "authentication",
      entity("authentication", "googleAuthentication", "Function", "src/authentication/google.ts"),
    ],
  ]);

  private getEntity(id: string): InvestigationEntity {
    const value = this.entities.get(id);
    if (!value) {
      throw new Error(`Missing test entity: ${id}`);
    }
    return value;
  }

  async query(
    query: string,
    parameters: Record<string, string | number | boolean>,
  ): Promise<{ columns: string[]; rows: unknown[][] }> {
    this.queries.push({ parameters, query });

    if (query.includes("CONTAINS toLower")) {
      if (parameters.query === "authentication using google fails" && query.includes("$term0")) {
        return {
          columns: entityColumns,
          rows: [entityRow(this.getEntity("authentication"))],
        };
      }
      return {
        columns: entityColumns,
        rows: [entityRow(this.getEntity("dependency")), entityRow(this.getEntity("root"))],
      };
    }

    const entityId = String(parameters.entityId ?? "");
    if (query.includes("MATCH (n)") && !query.includes("source.id")) {
      const value = this.entities.get(entityId);
      return value
        ? { columns: entityColumns, rows: [entityRow(value)] }
        : { columns: [], rows: [] };
    }

    const current = this.entities.get(entityId);
    if (!current) {
      return { columns: hopColumns, rows: [] };
    }

    if (query.includes("MATCH (source)-[r]->(target)")) {
      if (entityId === "root") {
        return {
          columns: hopColumns,
          rows: [hopRow(current, this.getEntity("dependency"), "CALLS", "outgoing")],
        };
      }
      if (entityId === "dependency") {
        return {
          columns: hopColumns,
          rows: [hopRow(current, this.getEntity("leaf"), "IMPORTS", "outgoing")],
        };
      }
    }

    if (query.includes("MATCH (target)-[r]->(source)") && entityId === "root") {
      return {
        columns: hopColumns,
        rows: [hopRow(current, this.getEntity("caller"), "CALLS", "incoming")],
      };
    }

    return { columns: hopColumns, rows: [] };
  }
}

describe("InvestigationTools", () => {
  it("finds entities and ranks exact names deterministically", async () => {
    const graph = new FakeGraph();
    const tools = new InvestigationTools(graph);

    const result = await tools.find_entities({ ...scope, query: "run", limit: 10 });

    expect(result.results.map((item) => item.id)).toEqual(["root", "dependency"]);
    expect(result.results[0]?.ranking.exactEntityMatch).toBe(1);
    expect(graph.queries[0]?.parameters).toMatchObject({ limit: 10, query: "run" });
    expect(graph.queries[0]?.query).toContain("LIMIT $limit");
  });

  it("finds entities from meaningful terms in a natural-language question", async () => {
    const graph = new FakeGraph();
    const tools = new InvestigationTools(graph);

    const result = await tools.find_entities({
      ...scope,
      query: "authentication using google fails",
      limit: 10,
    });

    expect(result.results[0]?.id).toBe("authentication");
    expect(graph.queries[0]?.parameters).toMatchObject({
      query: "authentication using google fails",
      term0: "authentication",
      term1: "google",
      term2: "fails",
    });
    expect(graph.queries[0]?.query).toContain("$term0");
  });

  it("returns bounded dependency and caller evidence paths", async () => {
    const tools = new InvestigationTools(new FakeGraph());

    const dependencies = await tools.find_dependencies({
      ...scope,
      entityId: "root",
      limit: 10,
      maxDepth: 2,
    });
    expect(dependencies.results.map((item) => item.id)).toEqual(["dependency", "leaf"]);
    expect(dependencies.results[0]?.evidencePaths[0]?.relationships[0]?.kind).toBe("CALLS");
    expect(dependencies.results[1]?.evidencePaths[0]?.distance).toBe(2);

    const callers = await tools.find_callers({ ...scope, entityId: "root", maxDepth: 1 });
    expect(callers.results[0]?.id).toBe("caller");
    expect(callers.results[0]?.evidencePaths[0]?.relationships[0]?.direction).toBe("incoming");
  });

  it("retrieves evidence paths and source locations without accepting unsafe bounds", async () => {
    const tools = new InvestigationTools(new FakeGraph());

    const path = await tools.get_evidence_path({
      ...scope,
      fromEntityId: "root",
      maxDepth: 2,
      toEntityId: "leaf",
    });
    expect(path.paths[0]?.entities.map((item) => item.id)).toEqual(["root", "dependency", "leaf"]);

    const locations = await tools.get_source_locations({
      ...scope,
      entityIds: ["root", "leaf"],
    });
    expect(locations.locations.map((item) => item.id)).toEqual(["leaf", "root"]);

    await expect(tools.find_entities({ ...scope, limit: 51, query: "run" })).rejects.toThrow(
      InvestigationToolError,
    );
    await expect(
      tools.find_dependencies({ ...scope, entityId: "root", maxDepth: 5 }),
    ).rejects.toThrow("maxDepth must be an integer between 1 and 4");
  });
});
