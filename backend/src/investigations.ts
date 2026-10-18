import { randomUUID } from "node:crypto";

import type {
  InvestigationAgentResult,
  InvestigationReport,
  InvestigationTraceStep,
} from "./agent.js";
import type { RepositoryRevision } from "./indexing.js";
import type { InvestigationMemoryStore, RepositoryInvestigationMemory } from "./memory.js";

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
  modelId?: string;
  question: string;
  report?: InvestigationReport;
  repositoryId: string;
  status: InvestigationStatus;
  trace?: InvestigationTraceStep[];
  toolCalls?: number;
  turns?: number;
  updatedAt: string;
}

export interface InvestigationRunInput extends RepositoryRevision {
  modelId?: string;
  priorMemories?: RepositoryInvestigationMemory[];
  question: string;
}

export type InvestigationRunner = (
  input: InvestigationRunInput,
) => Promise<InvestigationAgentResult>;

export interface InvestigationStore {
  close?(): Promise<void>;
  create(input: {
    modelId?: string;
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
  memoryStore?: InvestigationMemoryStore;
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
        ...(createInput.modelId ? { modelId: createInput.modelId } : {}),
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
          void runRecord(record, runner, revision, options.memoryStore);
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
  memoryStore?: InvestigationMemoryStore,
): Promise<void> {
  record.status = "running";
  record.updatedAt = new Date().toISOString();
  try {
    let priorMemories: RepositoryInvestigationMemory[] = [];
    if (memoryStore) {
      try {
        priorMemories = await memoryStore.search({
          question: record.question,
          repositoryId: revision.repositoryId,
          userId: record.userId,
        });
      } catch {
        priorMemories = [];
      }
    }

    const result = await run({
      commitSha: revision.commitSha,
      ...(record.modelId ? { modelId: record.modelId } : {}),
      ...(priorMemories.length > 0 ? { priorMemories } : {}),
      question: record.question,
      repositoryId: revision.repositoryId,
    });
    record.report = result.report;
    record.trace = result.trace;
    record.toolCalls = result.toolCalls;
    record.turns = result.turns;
    record.status = "succeeded";

    if (memoryStore) {
      try {
        await memoryStore.save({
          investigationId: record.id,
          question: record.question,
          report: result.report,
          repositoryId: revision.repositoryId,
          sourceCommitSha: revision.commitSha,
          userId: record.userId,
        });
      } catch {
        // Memory persistence is best effort and must not turn a valid report into a failure.
      }
    }
  } catch (error) {
    if (error instanceof Error && "trace" in error && Array.isArray(error.trace)) {
      record.trace = error.trace as InvestigationTraceStep[];
    }
    record.error = errorDetails(error);
    record.status = "failed";
  } finally {
    record.updatedAt = new Date().toISOString();
  }
}
