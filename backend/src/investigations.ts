import { randomUUID } from "node:crypto";

import type { InvestigationAgentResult, InvestigationReport } from "./agent.js";
import type { RepositoryRevision } from "./indexing.js";

export type InvestigationStatus = "failed" | "pending" | "queued" | "running" | "succeeded";

export interface InvestigationError {
  code: string;
  message: string;
}

export interface InvestigationRecord {
  commitSha?: string;
  createdAt: string;
  error?: InvestigationError;
  id: string;
  question: string;
  report?: InvestigationReport;
  repositoryId: string;
  status: InvestigationStatus;
  toolCalls?: number;
  turns?: number;
  updatedAt: string;
}

export interface InvestigationRunInput extends RepositoryRevision {
  question: string;
}

export type InvestigationRunner = (
  input: InvestigationRunInput,
) => Promise<InvestigationAgentResult>;

export interface InvestigationStore {
  close?(): Promise<void>;
  create(input: {
    question: string;
    repositoryId: string;
    userId: string;
  }): InvestigationRecord | null;
  get(userId: string, investigationId: string): InvestigationRecord | null;
}

export interface InvestigationStoreOptions {
  close?: () => Promise<void>;
  getRevision?: (userId: string, repositoryId: string) => RepositoryRevision | null;
  hasRepository: (userId: string, repositoryId: string) => boolean;
  run?: InvestigationRunner;
}

function publicRecord(record: InvestigationRecord & { userId: string }): InvestigationRecord {
  const { userId: _userId, ...result } = record;
  return result;
}

function errorDetails(error: unknown): InvestigationError {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return { code: error.code, message: error.message };
  }
  return {
    code: "INVESTIGATION_FAILED",
    message: error instanceof Error ? error.message : "Investigation failed.",
  };
}

export function createInvestigationStore(
  hasRepository: (userId: string, repositoryId: string) => boolean,
): InvestigationStore;
export function createInvestigationStore(options: InvestigationStoreOptions): InvestigationStore;
export function createInvestigationStore(
  input: ((userId: string, repositoryId: string) => boolean) | InvestigationStoreOptions,
): InvestigationStore {
  const options: InvestigationStoreOptions =
    typeof input === "function" ? { hasRepository: input } : input;
  const records = new Map<string, InvestigationRecord & { userId: string }>();

  const store: InvestigationStore = {
    ...(options.close ? { close: options.close } : {}),
    create(createInput) {
      if (!options.hasRepository(createInput.userId, createInput.repositoryId)) {
        return null;
      }

      const revision = options.getRevision?.(createInput.userId, createInput.repositoryId);
      if (options.getRevision && !revision) {
        return null;
      }

      const now = new Date().toISOString();
      const record: InvestigationRecord & { userId: string } = {
        ...(revision ? { commitSha: revision.commitSha } : {}),
        createdAt: now,
        id: `investigation_${randomUUID()}`,
        question: createInput.question,
        ...(options.run ? { status: "queued" as const } : { status: "pending" as const }),
        repositoryId: createInput.repositoryId,
        updatedAt: now,
        userId: createInput.userId,
      };
      records.set(record.id, record);

      const runner = options.run;
      if (runner && revision) {
        queueMicrotask(() => {
          void runRecord(record, runner, revision);
        });
      }

      return publicRecord(record);
    },
    get(userId, investigationId) {
      const record = records.get(investigationId);
      return record && record.userId === userId ? publicRecord(record) : null;
    },
  };

  return store;
}

async function runRecord(
  record: InvestigationRecord & { userId: string },
  run: InvestigationRunner,
  revision: RepositoryRevision,
): Promise<void> {
  record.status = "running";
  record.updatedAt = new Date().toISOString();
  try {
    const result = await run({
      commitSha: revision.commitSha,
      question: record.question,
      repositoryId: revision.repositoryId,
    });
    record.report = result.report;
    record.toolCalls = result.toolCalls;
    record.turns = result.turns;
    record.status = "succeeded";
  } catch (error) {
    record.error = errorDetails(error);
    record.status = "failed";
  } finally {
    record.updatedAt = new Date().toISOString();
  }
}
