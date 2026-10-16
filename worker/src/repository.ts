import { execFile } from "node:child_process";
import { mkdtemp, readdir, lstat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const GITHUB_HOST = "github.com";
const CLONE_TIMEOUT_MS = 120_000;
const DEFAULT_LIMITS: RepositoryLimits = {
  maxFileBytes: 1_000_000,
  maxFiles: 10_000,
  maxRepositoryBytes: 100_000_000,
};

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

const BINARY_EXTENSIONS = new Set([
  ".7z",
  ".avi",
  ".bin",
  ".dll",
  ".exe",
  ".gif",
  ".gz",
  ".ico",
  ".jpeg",
  ".jpg",
  ".mov",
  ".mp3",
  ".mp4",
  ".pdf",
  ".png",
  ".tar",
  ".ttf",
  ".wasm",
  ".wav",
  ".webp",
  ".woff",
  ".woff2",
  ".zip",
]);

const GITHUB_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export interface RepositoryReference {
  canonicalUrl: string;
  owner: string;
  repository: string;
  repositoryId: string;
}

export interface RepositoryLimits {
  maxFileBytes: number;
  maxFiles: number;
  maxRepositoryBytes: number;
}

export interface RepositoryFile {
  relativePath: string;
  size: number;
}

export interface RepositoryMetadata extends RepositoryReference {
  commitSha: string;
  fileCount: number;
  files: RepositoryFile[];
  totalBytes: number;
}

export interface RepositoryWorkspace extends RepositoryMetadata {
  repositoryDir: string;
  workspaceDir: string;
}

export interface CommandResult {
  stderr: string;
  stdout: string;
}

export type CommandRunner = (
  file: string,
  args: string[],
  options: { cwd?: string; timeout: number },
) => Promise<CommandResult>;

export interface CloneRepositoryOptions {
  commandRunner?: CommandRunner;
  limits?: Partial<RepositoryLimits>;
  tempRoot?: string;
}

export class RepositoryIngestionError extends Error {
  constructor(
    public readonly code:
      | "CLONE_FAILED"
      | "INVALID_GITHUB_URL"
      | "LIMIT_EXCEEDED"
      | "METADATA_FAILED"
      | "WORKSPACE_FAILED",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RepositoryIngestionError";
  }
}

const defaultCommandRunner: CommandRunner = async (file, args, options) => {
  const result = await execFileAsync(file, args, {
    cwd: options.cwd,
    maxBuffer: 2 * 1024 * 1024,
    timeout: options.timeout,
    windowsHide: true,
  });

  return {
    stderr: result.stderr,
    stdout: result.stdout,
  };
};

export function validatePublicGitHubUrl(input: string): RepositoryReference {
  let url: URL;

  try {
    url = new URL(input);
  } catch (error) {
    throw new RepositoryIngestionError("INVALID_GITHUB_URL", "Repository URL is not valid.", {
      cause: error,
    });
  }

  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== GITHUB_HOST ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new RepositoryIngestionError(
      "INVALID_GITHUB_URL",
      "Only public GitHub HTTPS repository URLs are supported.",
    );
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) {
    throw new RepositoryIngestionError(
      "INVALID_GITHUB_URL",
      "GitHub repository URLs must contain exactly an owner and repository.",
    );
  }

  const owner = segments[0];
  const repositoryWithSuffix = segments[1];
  const repository = repositoryWithSuffix?.replace(/\.git$/i, "");

  if (
    !owner ||
    !repository ||
    !GITHUB_SEGMENT.test(owner) ||
    !GITHUB_SEGMENT.test(repository) ||
    repository === "." ||
    repository === ".."
  ) {
    throw new RepositoryIngestionError(
      "INVALID_GITHUB_URL",
      "GitHub owner or repository is invalid.",
    );
  }

  const normalizedOwner = owner.toLowerCase();
  const normalizedRepository = repository.toLowerCase();

  return {
    canonicalUrl: `https://${GITHUB_HOST}/${normalizedOwner}/${normalizedRepository}.git`,
    owner: normalizedOwner,
    repository: normalizedRepository,
    repositoryId: `${normalizedOwner}/${normalizedRepository}`,
  };
}

function mergeLimits(limits?: Partial<RepositoryLimits>): RepositoryLimits {
  return {
    ...DEFAULT_LIMITS,
    ...limits,
  };
}

function isBinaryFile(path: string): boolean {
  const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
  return BINARY_EXTENSIONS.has(extension);
}

async function scanRepository(
  repositoryDir: string,
  limits: RepositoryLimits,
): Promise<{
  fileCount: number;
  files: RepositoryFile[];
  totalBytes: number;
}> {
  const files: RepositoryFile[] = [];
  let totalBytes = 0;

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      if (IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      const absolutePath = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }

      if (!entry.isFile() || isBinaryFile(entry.name)) {
        continue;
      }

      const stats = await lstat(absolutePath);
      if (stats.size > limits.maxFileBytes) {
        throw new RepositoryIngestionError(
          "LIMIT_EXCEEDED",
          `File exceeds the ${limits.maxFileBytes}-byte limit: ${relative(repositoryDir, absolutePath)}`,
        );
      }

      totalBytes += stats.size;
      if (totalBytes > limits.maxRepositoryBytes) {
        throw new RepositoryIngestionError(
          "LIMIT_EXCEEDED",
          `Repository exceeds the ${limits.maxRepositoryBytes}-byte limit.`,
        );
      }

      files.push({
        relativePath: relative(repositoryDir, absolutePath).split(sep).join("/"),
        size: stats.size,
      });

      if (files.length > limits.maxFiles) {
        throw new RepositoryIngestionError(
          "LIMIT_EXCEEDED",
          `Repository exceeds the ${limits.maxFiles}-file limit.`,
        );
      }
    }
  }

  await visit(repositoryDir);
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  return { fileCount: files.length, files, totalBytes };
}

async function readCommitSha(repositoryDir: string, commandRunner: CommandRunner): Promise<string> {
  try {
    const result = await commandRunner("git", ["rev-parse", "HEAD"], {
      cwd: repositoryDir,
      timeout: 15_000,
    });
    const commitSha = result.stdout.trim();

    if (!/^[0-9a-f]{40}$/i.test(commitSha)) {
      throw new Error("Git returned an invalid commit SHA.");
    }

    return commitSha;
  } catch (error) {
    throw new RepositoryIngestionError("METADATA_FAILED", "Could not read the cloned commit SHA.", {
      cause: error,
    });
  }
}

export async function clonePublicRepository(
  input: string,
  options: CloneRepositoryOptions = {},
): Promise<RepositoryWorkspace> {
  const reference = validatePublicGitHubUrl(input);
  const limits = mergeLimits(options.limits);
  const commandRunner = options.commandRunner ?? defaultCommandRunner;
  const tempRoot = options.tempRoot ?? tmpdir();
  let workspaceDir: string;

  try {
    workspaceDir = await mkdtemp(join(tempRoot, "codetrace-repository-"));
  } catch (error) {
    throw new RepositoryIngestionError(
      "WORKSPACE_FAILED",
      "Could not create a temporary workspace.",
      {
        cause: error,
      },
    );
  }

  const repositoryDir = join(workspaceDir, "repository");
  let completed = false;

  try {
    await commandRunner(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "clone",
        "--depth",
        "1",
        "--no-tags",
        "--no-recurse-submodules",
        "--filter=blob:none",
        reference.canonicalUrl,
        repositoryDir,
      ],
      { timeout: CLONE_TIMEOUT_MS },
    );

    const [commitSha, scan] = await Promise.all([
      readCommitSha(repositoryDir, commandRunner),
      scanRepository(repositoryDir, limits),
    ]);

    const result = {
      ...reference,
      ...scan,
      commitSha,
      repositoryDir,
      workspaceDir,
    };

    completed = true;
    return result;
  } catch (error) {
    if (error instanceof RepositoryIngestionError) {
      throw error;
    }

    throw new RepositoryIngestionError(
      "CLONE_FAILED",
      "Could not clone the public GitHub repository.",
      {
        cause: error,
      },
    );
  } finally {
    if (!completed) {
      await cleanupRepositoryWorkspace(workspaceDir).catch(() => undefined);
    }
  }
}

export async function cleanupRepositoryWorkspace(workspaceDir: string): Promise<void> {
  await rm(workspaceDir, { force: true, recursive: true });
}

export async function withClonedRepository<T>(
  input: string,
  callback: (workspace: RepositoryWorkspace) => Promise<T>,
  options: CloneRepositoryOptions = {},
): Promise<T> {
  const workspace = await clonePublicRepository(input, options);

  try {
    return await callback(workspace);
  } finally {
    await cleanupRepositoryWorkspace(workspace.workspaceDir);
  }
}
