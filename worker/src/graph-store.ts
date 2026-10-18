import { Redis } from "ioredis";

import type {
  ExtractionEntity,
  ExtractionEntityKind,
  ExtractionRelationship,
  ExtractionResult,
} from "./extraction.js";

const GRAPH_NAME_PATTERN = /^[A-Za-z0-9:_-]+$/;

const ENTITY_LABELS: Record<ExtractionEntityKind, string> = {
  Class: "Class",
  File: "File",
  Function: "Function",
  Module: "Module",
  Repository: "Repository",
};

const RELATIONSHIP_TYPES = {
  CALLS: "CALLS",
  CONTAINS: "CONTAINS",
  IMPORTS: "IMPORTS",
} as const;

export interface GraphCommandClient {
  call(command: string, ...args: string[]): Promise<unknown>;
  quit(): Promise<unknown>;
}

export interface GraphLoadInput extends ExtractionResult {
  commitSha: string;
  repositoryId: string;
}

export interface GraphLoadResult {
  commitSha: string;
  nodeCount: number;
  relationshipCount: number;
  repositoryId: string;
}

export interface GraphQueryResult {
  columns: string[];
  rows: unknown[][];
}

export interface GraphStoreOptions {
  client: GraphCommandClient;
  graphName?: string;
}

export function createGraphCommandClient(connectionUrl: string): GraphCommandClient {
  return new Redis(connectionUrl, {
    connectTimeout: 2_000,
    lazyConnect: false,
    maxRetriesPerRequest: 1,
  });
}

function cypherString(value: string): string {
  return `'${value
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'")
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n")}'`;
}

function parameterizedQuery(
  query: string,
  parameters: Record<string, string | number | boolean>,
): string {
  const header = Object.entries(parameters)
    .map(
      ([key, value]) => `${key}=${typeof value === "string" ? cypherString(value) : String(value)}`,
    )
    .join(" ");

  return `CYPHER ${header} ${query}`;
}

function queryResultFromRaw(result: unknown): GraphQueryResult {
  if (!Array.isArray(result) || !Array.isArray(result[0]) || !Array.isArray(result[1])) {
    return { columns: [], rows: [] };
  }

  return {
    columns: result[0].filter((value): value is string => typeof value === "string"),
    rows: result[1].filter((row): row is unknown[] => Array.isArray(row)),
  };
}

function nodeQuery(entity: ExtractionEntity, repositoryId: string, commitSha: string): string {
  const label = ENTITY_LABELS[entity.kind];
  return parameterizedQuery(
    `MERGE (n:${label} {id: $id})
     SET n.repositoryId = $repositoryId,
         n.commitSha = $commitSha,
         n.kind = $kind,
         n.name = $name,
         n.path = $path,
         n.lineStart = $lineStart,
         n.lineEnd = $lineEnd,
         n.provenance = $provenance,
         n.confidence = $confidence`,
    {
      commitSha,
      confidence: entity.confidence,
      id: entity.id,
      kind: entity.kind,
      lineEnd: entity.lineEnd,
      lineStart: entity.lineStart,
      name: entity.name,
      path: entity.path,
      provenance: entity.provenance,
      repositoryId,
    },
  );
}

function relationshipQuery(
  relationship: ExtractionRelationship,
  repositoryId: string,
  commitSha: string,
): string {
  const relationshipType = RELATIONSHIP_TYPES[relationship.kind];
  return parameterizedQuery(
    `MATCH (from {id: $fromId}), (to {id: $toId})
     MERGE (from)-[r:${relationshipType} {id: $id}]->(to)
     SET r.repositoryId = $repositoryId,
         r.commitSha = $commitSha,
         r.confidence = $confidence`,
    {
      commitSha,
      confidence: relationship.confidence,
      fromId: relationship.fromId,
      id: relationship.id,
      repositoryId,
      toId: relationship.toId,
    },
  );
}

function countFromResult(result: unknown): number {
  if (!Array.isArray(result) || !Array.isArray(result[1]) || !Array.isArray(result[1][0])) {
    return 0;
  }

  const value = result[1][0][0];
  return typeof value === "number" ? value : Number(value ?? 0);
}

export class GraphStore {
  private readonly client: GraphCommandClient;
  private readonly graphName: string;

  constructor({ client, graphName = "codetrace" }: GraphStoreOptions) {
    if (!GRAPH_NAME_PATTERN.test(graphName)) {
      throw new Error("Graph name contains unsupported characters.");
    }

    this.client = client;
    this.graphName = graphName;
  }

  async load(input: GraphLoadInput): Promise<GraphLoadResult> {
    await this.client.call(
      "GRAPH.QUERY",
      this.graphName,
      parameterizedQuery(
        "MATCH (n) WHERE n.repositoryId = $repositoryId AND n.commitSha IS NOT NULL AND n.commitSha <> $commitSha DETACH DELETE n",
        { commitSha: input.commitSha, repositoryId: input.repositoryId },
      ),
    );

    for (const entity of input.entities) {
      await this.client.call(
        "GRAPH.QUERY",
        this.graphName,
        nodeQuery(entity, input.repositoryId, input.commitSha),
      );
    }

    for (const relationship of input.relationships) {
      await this.client.call(
        "GRAPH.QUERY",
        this.graphName,
        relationshipQuery(relationship, input.repositoryId, input.commitSha),
      );
    }

    const counts = await this.countRevision(input.repositoryId, input.commitSha);
    return {
      commitSha: input.commitSha,
      nodeCount: counts.nodeCount,
      relationshipCount: counts.relationshipCount,
      repositoryId: input.repositoryId,
    };
  }

  async countRevision(
    repositoryId: string,
    commitSha: string,
  ): Promise<{ nodeCount: number; relationshipCount: number }> {
    const nodeResult = await this.client.call(
      "GRAPH.QUERY",
      this.graphName,
      parameterizedQuery(
        "MATCH (n) WHERE n.repositoryId = $repositoryId AND n.commitSha = $commitSha RETURN count(n)",
        { commitSha, repositoryId },
      ),
    );
    const relationshipResult = await this.client.call(
      "GRAPH.QUERY",
      this.graphName,
      parameterizedQuery(
        "MATCH ()-[r]->() WHERE r.repositoryId = $repositoryId AND r.commitSha = $commitSha RETURN count(r)",
        { commitSha, repositoryId },
      ),
    );

    return {
      nodeCount: countFromResult(nodeResult),
      relationshipCount: countFromResult(relationshipResult),
    };
  }

  async query(
    query: string,
    parameters: Record<string, string | number | boolean>,
  ): Promise<GraphQueryResult> {
    const result = await this.client.call(
      "GRAPH.QUERY",
      this.graphName,
      parameterizedQuery(query, parameters),
    );
    return queryResultFromRaw(result);
  }

  async deleteGraph(): Promise<void> {
    await this.client.call("GRAPH.DELETE", this.graphName);
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}
