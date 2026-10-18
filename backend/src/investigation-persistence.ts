import type { GraphQueryClient } from "@codetrace/worker";

import type { InvestigationPersistence, StoredInvestigationRecord } from "./investigations.js";

function rowRecord(columns: string[], row: unknown[]): Record<string, unknown> {
  return Object.fromEntries(columns.map((column, index) => [column, row[index]]));
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function parseRecord(values: Record<string, unknown>): StoredInvestigationRecord | null {
  try {
    const parsed: unknown = JSON.parse(stringValue(values.payload));
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const record = parsed as StoredInvestigationRecord;
    if (
      typeof record.id !== "string" ||
      typeof record.repositoryId !== "string" ||
      typeof record.question !== "string" ||
      typeof record.status !== "string"
    ) {
      return null;
    }

    return {
      ...record,
      userId: stringValue(values.userId),
    };
  } catch {
    return null;
  }
}

export function createInvestigationPersistence(graph: GraphQueryClient): InvestigationPersistence {
  return {
    async load() {
      const result = await graph.query(
        `MATCH (i:Investigation)
         RETURN i.userId AS userId, i.payload AS payload
         ORDER BY i.updatedAt DESC`,
        {},
      );
      const records: StoredInvestigationRecord[] = [];
      for (const row of result.rows) {
        const record = parseRecord(rowRecord(result.columns, row));
        if (record) {
          records.push(record);
        }
      }
      return records;
    },

    async save(record) {
      await graph.query(
        `MERGE (i:Investigation {id: $id})
         SET i.userId = $userId,
             i.repositoryId = $repositoryId,
             i.status = $status,
             i.updatedAt = $updatedAt,
             i.payload = $payload,
             i.createdAt = $createdAt`,
        {
          createdAt: record.createdAt,
          id: record.id,
          payload: JSON.stringify(record),
          repositoryId: record.repositoryId,
          status: record.status,
          updatedAt: record.updatedAt,
          userId: record.userId,
        },
      );
    },
  };
}
