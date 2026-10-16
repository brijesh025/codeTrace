import { describe, expect, it, vi } from "vitest";

import {
  IndexJobManager,
  type RepositoryIndexResult,
  type RepositoryIndexer,
} from "../src/indexing.js";
import { RepositoryIngestionError } from "@codetrace/worker";

const successfulResult: RepositoryIndexResult = {
  commitSha: "0123456789abcdef0123456789abcdef01234567",
  diagnosticsCount: 1,
  filesProcessed: 3,
  nodeCount: 8,
  relationshipCount: 7,
  repositoryId: "octocat/hello-world",
};

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("IndexJobManager", () => {
  it("tracks progress, enforces ownership, and makes active duplicates predictable", async () => {
    let resolveIndex!: (result: RepositoryIndexResult) => void;
    const indexPromise = new Promise<RepositoryIndexResult>((resolve) => {
      resolveIndex = resolve;
    });
    const indexRepository: RepositoryIndexer = vi.fn(async (_url, reportProgress) => {
      reportProgress({ filesDiscovered: 3, filesProcessed: 1 });
      return indexPromise;
    });
    const manager = new IndexJobManager({ indexRepository });

    const first = manager.start({
      repositoryUrl: "https://github.com/octocat/Hello-World",
      userId: "github-user-1",
    });
    expect(first.duplicate).toBe(false);
    expect(first.job.repositoryId).toBe("octocat/hello-world");
    expect(manager.hasRepository("github-user-1", "octocat/hello-world")).toBe(true);

    const duplicate = manager.start({
      repositoryUrl: "https://github.com/octocat/hello-world.git",
      userId: "github-user-1",
    });
    expect(duplicate).toEqual({
      duplicate: true,
      job: expect.objectContaining({ id: first.job.id }),
    });

    const foreignStatus = manager.getStatus("github-user-2", first.job.id);
    expect(foreignStatus).toBeNull();

    resolveIndex(successfulResult);
    await tick();
    await tick();

    expect(manager.getStatus("github-user-1", first.job.id)).toEqual(
      expect.objectContaining({
        commitSha: successfulResult.commitSha,
        progress: expect.objectContaining({
          filesDiscovered: 3,
          filesProcessed: 3,
          nodeCount: 8,
          relationshipCount: 7,
        }),
        status: "succeeded",
      }),
    );
  });

  it("returns structured failures and rejects idempotency-key reuse across repositories", async () => {
    const indexRepository: RepositoryIndexer = vi.fn(async () => {
      throw new RepositoryIngestionError("LIMIT_EXCEEDED", "Repository is too large.");
    });
    const manager = new IndexJobManager({ indexRepository });

    const first = manager.start({
      idempotencyKey: "request-1",
      repositoryUrl: "https://github.com/octocat/hello-world",
      userId: "github-user-1",
    });
    await tick();
    expect(manager.getStatus("github-user-1", first.job.id)).toEqual(
      expect.objectContaining({
        error: { code: "LIMIT_EXCEEDED", message: "Repository is too large." },
        status: "failed",
      }),
    );

    expect(() =>
      manager.start({
        idempotencyKey: "request-1",
        repositoryUrl: "https://github.com/octocat/other-repository",
        userId: "github-user-1",
      }),
    ).toThrow("already used for another repository");
  });
});
