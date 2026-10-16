import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  createGraphCommandClient,
  extractRepository,
  GraphStore,
  RepositoryIngestionError,
  supportedSourceExtensions,
  validatePublicGitHubUrl,
  withClonedRepository,
  type GraphLoadResult,
} from "@codetrace/worker";

export type IndexJobStatus = "queued" | "running" | "succeeded" | "failed";

export interface IndexJobProgress {
  diagnosticsCount: number;
  filesDiscovered: number;
  filesProcessed: number;
  nodeCount: number;
  relationshipCount: number;
}

export interface IndexJobError {
  code: string;
  message: string;
}

export interface IndexJobSnapshot {
  commitSha?: string;
  createdAt: string;
  error?: IndexJobError;
  id: string;
  progress: IndexJobProgress;
  repositoryId: string;
  status: IndexJobStatus;
  updatedAt: string;
}

interface IndexJob extends IndexJobSnapshot {
  idempotencyKey?: string;
  repositoryUrl: string;
  userId: string;
}

export interface StartIndexRequest {
  idempotencyKey?: string;
  repositoryUrl: string;
  userId: string;
}

export interface StartIndexResult {
  duplicate: boolean;
  job: IndexJobSnapshot;
}

export interface RepositoryIndexResult extends GraphLoadResult {
  diagnosticsCount: number;
  filesProcessed: number;
}

export type IndexProgressReporter = (progress: Partial<IndexJobProgress>) => void;

export type RepositoryIndexer = (
  repositoryUrl: string,
  reportProgress: IndexProgressReporter,
) => Promise<RepositoryIndexResult>;

export interface IndexJobManagerOptions {
  graphName?: string;
  indexRepository?: RepositoryIndexer;
  falkordbUrl?: string;
}

export class IndexingConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IndexingConflictError";
  }
}

const initialProgress: IndexJobProgress = {
  diagnosticsCount: 0,
  filesDiscovered: 0,
  filesProcessed: 0,
  nodeCount: 0,
  relationshipCount: 0,
};

function isSupportedSourcePath(path: string): boolean {
  return supportedSourceExtensions.includes(
    extname(path).toLowerCase() as (typeof supportedSourceExtensions)[number],
  );
}

function errorDetails(error: unknown): IndexJobError {
  if (error instanceof RepositoryIngestionError) {
    return { code: error.code, message: error.message };
  }

  if (error instanceof Error) {
    return { code: "INDEX_FAILED", message: error.message };
  }

  return { code: "INDEX_FAILED", message: "Repository indexing failed." };
}

function ownerRepositoryKey(userId: string, repositoryId: string): string {
  return `${userId}\u0000${repositoryId}`;
}

function snapshot(job: IndexJob): IndexJobSnapshot {
  return {
    ...(job.commitSha ? { commitSha: job.commitSha } : {}),
    createdAt: job.createdAt,
    ...(job.error ? { error: job.error } : {}),
    id: job.id,
    progress: { ...job.progress },
    repositoryId: job.repositoryId,
    status: job.status,
    updatedAt: job.updatedAt,
  };
}

export function createRepositoryIndexer({
  falkordbUrl = "redis://127.0.0.1:6379",
  graphName = "codetrace",
}: {
  falkordbUrl?: string;
  graphName?: string;
} = {}): RepositoryIndexer {
  return async (repositoryUrl, reportProgress) =>
    withClonedRepository(repositoryUrl, async (workspace) => {
      const sourceFiles = [];

      for (const file of workspace.files) {
        if (!isSupportedSourcePath(file.relativePath)) {
          continue;
        }

        sourceFiles.push({
          path: file.relativePath,
          source: await readFile(join(workspace.repositoryDir, file.relativePath), "utf8"),
        });
      }

      reportProgress({
        filesDiscovered: sourceFiles.length,
      });

      const extraction = extractRepository({
        commitSha: workspace.commitSha,
        files: sourceFiles,
        repositoryId: workspace.repositoryId,
      });
      reportProgress({
        diagnosticsCount: extraction.diagnostics.length,
        filesDiscovered: sourceFiles.length,
        filesProcessed: sourceFiles.length,
      });

      const graphClient = createGraphCommandClient(falkordbUrl);
      const graphStore = new GraphStore({ client: graphClient, graphName });

      try {
        const graphResult = await graphStore.load({
          ...extraction,
          commitSha: workspace.commitSha,
          repositoryId: workspace.repositoryId,
        });

        reportProgress({
          nodeCount: graphResult.nodeCount,
          relationshipCount: graphResult.relationshipCount,
        });

        return {
          ...graphResult,
          diagnosticsCount: extraction.diagnostics.length,
          filesProcessed: sourceFiles.length,
        };
      } finally {
        await graphStore.close();
      }
    });
}

export class IndexJobManager {
  private readonly idempotencyJobs = new Map<string, string>();
  private readonly indexRepository: RepositoryIndexer;
  private readonly jobs = new Map<string, IndexJob>();
  private readonly activeRepositories = new Map<string, string>();
  private readonly ownedRepositories = new Set<string>();

  constructor(options: IndexJobManagerOptions = {}) {
    this.indexRepository =
      options.indexRepository ??
      createRepositoryIndexer({ falkordbUrl: options.falkordbUrl, graphName: options.graphName });
  }

  hasRepository(userId: string, repositoryId: string): boolean {
    return this.ownedRepositories.has(ownerRepositoryKey(userId, repositoryId));
  }

  start(input: StartIndexRequest): StartIndexResult {
    const reference = validatePublicGitHubUrl(input.repositoryUrl);
    const repositoryKey = ownerRepositoryKey(input.userId, reference.repositoryId);
    const normalizedIdempotencyKey = input.idempotencyKey?.trim();

    if (normalizedIdempotencyKey) {
      const idempotencyMapKey = ownerRepositoryKey(input.userId, normalizedIdempotencyKey);
      const existingJobId = this.idempotencyJobs.get(idempotencyMapKey);
      if (existingJobId) {
        const existingJob = this.jobs.get(existingJobId);
        if (existingJob && existingJob.repositoryId !== reference.repositoryId) {
          throw new IndexingConflictError(
            "The idempotency key was already used for another repository.",
          );
        }
        if (existingJob) {
          return { duplicate: true, job: snapshot(existingJob) };
        }
      }
    }

    const activeJobId = this.activeRepositories.get(repositoryKey);
    if (activeJobId) {
      const activeJob = this.jobs.get(activeJobId);
      if (activeJob) {
        if (normalizedIdempotencyKey) {
          this.idempotencyJobs.set(
            ownerRepositoryKey(input.userId, normalizedIdempotencyKey),
            activeJob.id,
          );
        }
        return { duplicate: true, job: snapshot(activeJob) };
      }
    }

    const now = new Date().toISOString();
    const job: IndexJob = {
      ...(normalizedIdempotencyKey ? { idempotencyKey: normalizedIdempotencyKey } : {}),
      createdAt: now,
      id: `index_${randomUUID()}`,
      progress: { ...initialProgress },
      repositoryId: reference.repositoryId,
      repositoryUrl: input.repositoryUrl,
      status: "queued",
      updatedAt: now,
      userId: input.userId,
    };

    this.jobs.set(job.id, job);
    this.activeRepositories.set(repositoryKey, job.id);
    this.ownedRepositories.add(repositoryKey);
    if (normalizedIdempotencyKey) {
      this.idempotencyJobs.set(ownerRepositoryKey(input.userId, normalizedIdempotencyKey), job.id);
    }

    queueMicrotask(() => {
      void this.run(job, repositoryKey);
    });
    return { duplicate: false, job: snapshot(job) };
  }

  getStatus(userId: string, jobId: string): IndexJobSnapshot | null {
    const job = this.jobs.get(jobId);
    if (!job || job.userId !== userId) {
      return null;
    }

    return snapshot(job);
  }

  private async run(job: IndexJob, repositoryKey: string): Promise<void> {
    job.status = "running";
    job.updatedAt = new Date().toISOString();

    try {
      const result = await this.indexRepository(job.repositoryUrl, (progress) => {
        job.progress = { ...job.progress, ...progress };
        job.updatedAt = new Date().toISOString();
      });

      job.commitSha = result.commitSha;
      job.progress = {
        ...job.progress,
        diagnosticsCount: result.diagnosticsCount,
        filesProcessed: result.filesProcessed,
        nodeCount: result.nodeCount,
        relationshipCount: result.relationshipCount,
      };
      job.status = "succeeded";
    } catch (error) {
      job.error = errorDetails(error);
      job.status = "failed";
    } finally {
      job.updatedAt = new Date().toISOString();
      if (this.activeRepositories.get(repositoryKey) === job.id) {
        this.activeRepositories.delete(repositoryKey);
      }
    }
  }
}
