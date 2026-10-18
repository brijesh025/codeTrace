import { randomUUID } from "node:crypto";

import type { GraphQueryClient } from "@codetrace/worker";

import type { InvestigationReport } from "./agent.js";

const DEFAULT_MEMORY_LIMIT = 5;
const MAX_MEMORY_LIMIT = 10;
const MAX_MEMORY_CONTEXT_CHARS = 12_000;

export interface RepositoryInvestigationMemory {
  checklist: string[];
  createdAt: string;
  findings: Array<{
    entity: {
      id: string;
      kind: string;
      lineEnd: number;
      lineStart: number;
      name: string;
      path: string;
    };
    evidencePaths: Array<{
      distance: number;
      entityIds: string[];
      relationshipKinds: string[];
    }>;
    priority: "high" | "low" | "medium";
    reason: string;
  }>;
  id: string;
  investigationId: string;
  question: string;
  repositoryId: string;
  sourceCommitSha: string;
  summary: string;
  uncertainty: string[];
}

export interface InvestigationMemoryStore {
  save(input: {
    investigationId: string;
    report: InvestigationReport;
    repositoryId: string;
    sourceCommitSha: string;
    userId: string;
    question: string;
  }): Promise<void>;
  search(input: {
    limit?: number;
    question: string;
    repositoryId: string;
    userId: string;
  }): Promise<RepositoryInvestigationMemory[]>;
}

interface StoredMemoryRow {
  createdAt: string;
  id: string;
  investigationId: string;
  payload: string;
  repositoryId: string;
  sourceCommitSha: string;
}

function rowRecord(columns: string[], row: unknown[]): Record<string, unknown> {
  return Object.fromEntries(columns.map((column, index) => [column, row[index]]));
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function boundedLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_MEMORY_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_MEMORY_LIMIT) {
    throw new Error(`Memory limit must be an integer between 1 and ${MAX_MEMORY_LIMIT}.`);
  }
  return limit;
}

function searchTerms(question: string): string[] {
  return [...new Set(question.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? [])].slice(0, 8);
}

function memoryFromReport(input: {
  investigationId: string;
  report: InvestigationReport;
  repositoryId: string;
  sourceCommitSha: string;
  question: string;
}): RepositoryInvestigationMemory {
  return {
    checklist: input.report.checklist,
    createdAt: new Date().toISOString(),
    findings: input.report.findings.map((finding) => ({
      entity: {
        id: finding.entity.id,
        kind: finding.entity.kind,
        lineEnd: finding.entity.lineEnd,
        lineStart: finding.entity.lineStart,
        name: finding.entity.name,
        path: finding.entity.path,
      },
      evidencePaths: finding.evidencePaths.slice(0, 3).map((path) => ({
        distance: path.distance,
        entityIds: path.entities.map((entity) => entity.id),
        relationshipKinds: path.relationships.map((relationship) => relationship.kind),
      })),
      priority: finding.priority,
      reason: finding.reason,
    })),
    id: `memory_${randomUUID()}`,
    investigationId: input.investigationId,
    question: input.question,
    repositoryId: input.repositoryId,
    sourceCommitSha: input.sourceCommitSha,
    summary: input.report.summary,
    uncertainty: input.report.uncertainty,
  };
}

function parseMemory(row: StoredMemoryRow): RepositoryInvestigationMemory | null {
  try {
    const parsed: unknown = JSON.parse(row.payload);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return {
      ...(parsed as RepositoryInvestigationMemory),
      createdAt: row.createdAt,
      id: row.id,
      investigationId: row.investigationId,
      repositoryId: row.repositoryId,
      sourceCommitSha: row.sourceCommitSha,
    };
  } catch {
    return null;
  }
}

function compactMemory(memory: RepositoryInvestigationMemory): RepositoryInvestigationMemory {
  return {
    ...memory,
    findings: memory.findings.slice(0, 10),
    checklist: memory.checklist.slice(0, 10),
    uncertainty: memory.uncertainty.slice(0, 10),
  };
}

export class RepositoryMemoryStore implements InvestigationMemoryStore {
  constructor(private readonly graph: GraphQueryClient) {}

  async save(input: {
    investigationId: string;
    report: InvestigationReport;
    repositoryId: string;
    sourceCommitSha: string;
    userId: string;
    question: string;
  }): Promise<void> {
    const memory = memoryFromReport(input);
    const payload = JSON.stringify(compactMemory(memory));

    await this.graph.query(
      `MERGE (m:Memory {id: $memoryId})
       SET m.repositoryId = $repositoryId,
           m.userId = $userId,
           m.investigationId = $investigationId,
           m.sourceCommitSha = $sourceCommitSha,
           m.question = $question,
           m.summary = $summary,
           m.createdAt = $createdAt,
           m.payload = $payload`,
      {
        createdAt: memory.createdAt,
        investigationId: input.investigationId,
        memoryId: memory.id,
        payload,
        question: input.question,
        repositoryId: input.repositoryId,
        sourceCommitSha: input.sourceCommitSha,
        summary: input.report.summary,
        userId: input.userId,
      },
    );
  }

  async search(input: {
    limit?: number;
    question: string;
    repositoryId: string;
    userId: string;
  }): Promise<RepositoryInvestigationMemory[]> {
    const limit = boundedLimit(input.limit);
    const terms = searchTerms(input.question);
    const matchClause = terms.length
      ? terms
          .map(
            (_term, index) =>
              `(toLower(m.question) CONTAINS toLower($term${index}) OR toLower(m.summary) CONTAINS toLower($term${index}))`,
          )
          .join(" OR ")
      : "true";
    const parameters: Record<string, string | number | boolean> = {
      limit,
      repositoryId: input.repositoryId,
      userId: input.userId,
    };
    terms.forEach((term, index) => {
      parameters[`term${index}`] = term;
    });

    const result = await this.graph.query(
      `MATCH (m:Memory)
       WHERE m.repositoryId = $repositoryId
         AND m.userId = $userId
         AND (${matchClause})
       RETURN m.id AS id,
              m.investigationId AS investigationId,
              m.repositoryId AS repositoryId,
              m.sourceCommitSha AS sourceCommitSha,
              m.createdAt AS createdAt,
              m.payload AS payload
       ORDER BY m.createdAt DESC
       LIMIT $limit`,
      parameters,
    );

    const memories: RepositoryInvestigationMemory[] = [];
    for (const row of result.rows) {
      const values = rowRecord(result.columns, row);
      const parsed = parseMemory({
        createdAt: stringValue(values.createdAt),
        id: stringValue(values.id),
        investigationId: stringValue(values.investigationId),
        payload: stringValue(values.payload),
        repositoryId: stringValue(values.repositoryId),
        sourceCommitSha: stringValue(values.sourceCommitSha),
      });
      if (parsed) {
        memories.push(parsed);
      }
    }

    return memories;
  }
}

export function memoryContext(memories: RepositoryInvestigationMemory[]): string {
  if (memories.length === 0) {
    return "";
  }

  const context = JSON.stringify(memories.map(compactMemory));
  return context.length <= MAX_MEMORY_CONTEXT_CHARS
    ? context
    : `${context.slice(0, MAX_MEMORY_CONTEXT_CHARS)}...`;
}
