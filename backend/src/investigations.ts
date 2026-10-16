import { randomUUID } from "node:crypto";

export type InvestigationStatus = "pending";

export interface InvestigationRecord {
  createdAt: string;
  id: string;
  question: string;
  repositoryId: string;
  status: InvestigationStatus;
  updatedAt: string;
}

export interface InvestigationStore {
  create(input: {
    question: string;
    repositoryId: string;
    userId: string;
  }): InvestigationRecord | null;
  get(userId: string, investigationId: string): InvestigationRecord | null;
}

export function createInvestigationStore(
  hasRepository: (userId: string, repositoryId: string) => boolean,
): InvestigationStore {
  const records = new Map<string, InvestigationRecord & { userId: string }>();

  return {
    create(input) {
      if (!hasRepository(input.userId, input.repositoryId)) {
        return null;
      }

      const now = new Date().toISOString();
      const record = {
        createdAt: now,
        id: `investigation_${randomUUID()}`,
        question: input.question,
        repositoryId: input.repositoryId,
        status: "pending" as const,
        updatedAt: now,
        userId: input.userId,
      };
      records.set(record.id, record);

      const { userId: _userId, ...publicRecord } = record;
      return publicRecord;
    },
    get(userId, investigationId) {
      const record = records.get(investigationId);
      if (!record || record.userId !== userId) {
        return null;
      }

      const { userId: _userId, ...publicRecord } = record;
      return publicRecord;
    },
  };
}
