import { describe, expect, it } from "vitest";

import { extractRepository } from "../src/index.js";

const commitSha = "0123456789abcdef0123456789abcdef01234567";

describe("extractRepository", () => {
  it.each([
    [".py", "def helper():\n    pass\ndef run():\n    helper()", "helper"],
    [".java", "class Runner {\n void helper() {}\n void run() {\n  helper();\n }\n}", "helper"],
    [".c", "void helper() {}\nvoid run() {\n helper();\n}", "helper"],
    [".cpp", "class Runner {\n void helper() {}\n void run() {\n  helper();\n }\n};", "helper"],
    [".go", "package main\nfunc helper() {}\nfunc run() { helper() }", "helper"],
  ])("extracts functions and calls for %s", (extension, source, calledName) => {
    const result = extractRepository({
      commitSha,
      files: [{ path: `src/example${extension}`, source }],
      repositoryId: "example/repo",
    });

    expect(
      result.entities.some((entity) => entity.kind === "Function" && entity.name === calledName),
    ).toBe(true);
    expect(result.relationships.some((relationship) => relationship.kind === "CALLS")).toBe(true);
  });

  it("resolves common-language imports to repository files", () => {
    const result = extractRepository({
      commitSha,
      repositoryId: "example/repo",
      files: [
        { path: "pkg/main.py", source: "from .helper import helper\ndef run():\n helper()" },
        { path: "pkg/helper.py", source: "def helper():\n pass" },
        { path: "src/main.c", source: '#include "helper.h"\nvoid run() {}' },
        { path: "src/helper.h", source: "void helper();" },
      ],
    });

    expect(
      result.relationships.filter((relationship) => relationship.kind === "IMPORTS"),
    ).toHaveLength(2);
  });

  it("extracts entities, resolvable imports, calls, and source ranges", () => {
    const result = extractRepository({
      commitSha,
      repositoryId: "example/repo",
      files: [
        {
          path: "src/index.ts",
          source: `import { helper } from "./util";

export function run() {
  return helper();
}

export class Runner {}
`,
        },
        {
          path: "src/util.ts",
          source: `export function helper() {
  return 42;
}
`,
        },
        {
          path: "README.md",
          source: "This file is not a supported source file.",
        },
      ],
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.entities.filter((entity) => entity.kind === "File")).toHaveLength(2);
    expect(
      result.entities.some((entity) => entity.kind === "Function" && entity.name === "run"),
    ).toBe(true);
    expect(
      result.entities.some((entity) => entity.kind === "Function" && entity.name === "helper"),
    ).toBe(true);
    expect(
      result.entities.some((entity) => entity.kind === "Class" && entity.name === "Runner"),
    ).toBe(true);
    expect(
      result.entities.find((entity) => entity.kind === "Function" && entity.name === "run"),
    ).toMatchObject({
      lineStart: 3,
      lineEnd: 5,
      path: "src/index.ts",
    });
    expect(result.relationships.some((relationship) => relationship.kind === "IMPORTS")).toBe(true);
    expect(result.relationships.some((relationship) => relationship.kind === "CALLS")).toBe(true);
  });

  it("reports syntax errors without inventing symbols", () => {
    const result = extractRepository({
      commitSha,
      repositoryId: "example/repo",
      files: [{ path: "src/broken.ts", source: "export function broken( {" }],
    });

    expect(result.diagnostics).toEqual([
      {
        message: "Tree-sitter reported a syntax error in this file.",
        path: "src/broken.ts",
      },
    ]);
    expect(result.entities.filter((entity) => entity.kind === "Function")).toHaveLength(0);
  });

  it("keeps identifiers stable for the same repository revision and source", () => {
    const input = {
      commitSha,
      repositoryId: "example/repo",
      files: [{ path: "src/index.js", source: "function run() { return 1; }" }],
    };

    const first = extractRepository(input);
    const second = extractRepository(input);

    expect(first.entities.map((entity) => entity.id)).toEqual(
      second.entities.map((entity) => entity.id),
    );
    expect(first.relationships.map((relationship) => relationship.id)).toEqual(
      second.relationships.map((relationship) => relationship.id),
    );
  });
});
