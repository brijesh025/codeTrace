import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  type CommandRunner,
  RepositoryIngestionError,
  clonePublicRepository,
  validatePublicGitHubUrl,
  withClonedRepository,
} from "../src/index.js";

const commitSha = "0123456789abcdef0123456789abcdef01234567";
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(async (directory) => {
      await import("node:fs/promises").then(({ rm }) =>
        rm(directory, { force: true, recursive: true }),
      );
    }),
  );
});

function createFakeGitRunner(): CommandRunner {
  return async (_file, args) => {
    if (args[0] === "-c") {
      const repositoryDir = args.at(-1);
      if (!repositoryDir) {
        throw new Error("missing clone destination");
      }

      await mkdir(join(repositoryDir, "src"), { recursive: true });
      await mkdir(join(repositoryDir, "node_modules", "ignored"), { recursive: true });
      await writeFile(
        join(repositoryDir, "src", "index.ts"),
        "export function answer() { return 42; }\n",
      );
      await writeFile(join(repositoryDir, "node_modules", "ignored", "index.js"), "ignored");
      await writeFile(join(repositoryDir, "logo.png"), "binary");
      return { stderr: "", stdout: "" };
    }

    if (args[0] === "rev-parse") {
      return { stderr: "", stdout: `${commitSha}\n` };
    }

    throw new Error(`unexpected git command: ${args.join(" ")}`);
  };
}

describe("validatePublicGitHubUrl", () => {
  it("canonicalizes a public GitHub repository URL", () => {
    expect(validatePublicGitHubUrl("https://GitHub.com/Example/Repo")).toEqual({
      canonicalUrl: "https://github.com/example/repo.git",
      owner: "example",
      repository: "repo",
      repositoryId: "example/repo",
    });
  });

  it.each([
    "http://github.com/example/repo",
    "https://gitlab.com/example/repo",
    "https://github.com/example/repo/issues",
    "https://github.com/example/repo?private=true",
  ])("rejects unsupported URL: %s", (url) => {
    expect(() => validatePublicGitHubUrl(url)).toThrowError(RepositoryIngestionError);
  });
});

describe("repository workspace", () => {
  it("clones, scans supported files, captures the revision, and cleans up", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "codetrace-test-root-"));
    temporaryRoots.push(tempRoot);
    let workspaceDir = "";

    const metadata = await withClonedRepository(
      "https://github.com/example/repo.git",
      async (workspace) => {
        workspaceDir = workspace.workspaceDir;
        expect(workspace.commitSha).toBe(commitSha);
        expect(workspace.fileCount).toBe(1);
        expect(workspace.files[0]?.relativePath).toBe("src/index.ts");
        return workspace;
      },
      { commandRunner: createFakeGitRunner(), tempRoot },
    );

    expect(metadata.repositoryId).toBe("example/repo");
    await expect(access(workspaceDir)).rejects.toThrow();
  });

  it("removes a workspace when a repository limit is exceeded", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "codetrace-test-root-"));
    temporaryRoots.push(tempRoot);

    await expect(
      clonePublicRepository("https://github.com/example/repo", {
        commandRunner: createFakeGitRunner(),
        limits: { maxFiles: 0 },
        tempRoot,
      }),
    ).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });

    const entries = await import("node:fs/promises").then(({ readdir }) => readdir(tempRoot));
    expect(entries).toEqual([]);
  });
});
