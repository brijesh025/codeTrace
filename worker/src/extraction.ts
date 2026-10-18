import { createHash } from "node:crypto";
import { posix } from "node:path";

import Parser, { type SyntaxNode } from "tree-sitter";
import C from "tree-sitter-c";
import Cpp from "tree-sitter-cpp";
import Go from "tree-sitter-go";
import Java from "tree-sitter-java";
import JavaScript from "tree-sitter-javascript";
import Python from "tree-sitter-python";
import TypeScript from "tree-sitter-typescript";

import type { SupportedSourceExtension } from "./index.js";

const sourceExtensions = new Set<SupportedSourceExtension>([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".java",
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".cxx",
  ".hpp",
  ".go",
]);

type RelationshipKind = "CONTAINS" | "IMPORTS" | "CALLS";

export interface ExtractionFile {
  path: string;
  source: string;
}

export interface ExtractionInput {
  commitSha: string;
  files: ExtractionFile[];
  repositoryId: string;
}

export interface ExtractionRange {
  lineEnd: number;
  lineStart: number;
}

export type ExtractionEntityKind = "Class" | "File" | "Function" | "Module" | "Repository";

export interface ExtractionEntity extends ExtractionRange {
  confidence: number;
  id: string;
  kind: ExtractionEntityKind;
  name: string;
  path: string;
  provenance: "tree-sitter";
}

export interface ExtractionRelationship {
  confidence: number;
  fromId: string;
  id: string;
  kind: RelationshipKind;
  toId: string;
}

export interface ExtractionDiagnostic {
  message: string;
  path: string;
}

export interface ExtractionResult {
  diagnostics: ExtractionDiagnostic[];
  entities: ExtractionEntity[];
  relationships: ExtractionRelationship[];
}

function hashId(...parts: string[]): string {
  const digest = createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 24);
  return `ct_${digest}`;
}

function lineRange(node: SyntaxNode): ExtractionRange {
  return {
    lineEnd: node.endPosition.row + 1,
    lineStart: node.startPosition.row + 1,
  };
}

function normalizePath(path: string): string {
  return posix.normalize(path.replaceAll("\\", "/")).replace(/^\.\//, "");
}

function extensionForPath(path: string): SupportedSourceExtension | null {
  const extension = posix.extname(path).toLowerCase();
  return sourceExtensions.has(extension as SupportedSourceExtension)
    ? (extension as SupportedSourceExtension)
    : null;
}

function createEntity(
  input: ExtractionInput,
  kind: ExtractionEntityKind,
  name: string,
  path: string,
  range: ExtractionRange,
  confidence = 1,
): ExtractionEntity {
  return {
    ...range,
    confidence,
    id: hashId(kind, input.repositoryId, input.commitSha, path, name, String(range.lineStart)),
    kind,
    name,
    path,
    provenance: "tree-sitter",
  };
}

function createRelationship(
  fromId: string,
  kind: RelationshipKind,
  toId: string,
  confidence = 1,
): ExtractionRelationship {
  return {
    confidence,
    fromId,
    id: hashId("relationship", fromId, kind, toId),
    kind,
    toId,
  };
}

function symbolName(node: SyntaxNode): string | null {
  const name = node.childForFieldName("name");
  return name?.text ?? null;
}

function functionName(node: SyntaxNode): string | null {
  const directName = symbolName(node);
  if (directName) {
    return directName;
  }

  if (["function_definition", "function_declaration"].includes(node.type)) {
    const declarator = node.childForFieldName("declarator");
    const named = declarator?.namedChildren.find((child) =>
      ["identifier", "field_identifier", "type_identifier"].includes(child.type),
    );
    return named?.text ?? null;
  }

  if (node.type === "method_declaration" || node.type === "method_definition") {
    return node.childForFieldName("name")?.text ?? null;
  }

  if (node.type !== "arrow_function" && node.type !== "function") {
    return null;
  }

  const parent = node.parent;
  return parent?.type === "variable_declarator"
    ? (parent.childForFieldName("name")?.text ?? null)
    : null;
}

function isFunctionNode(node: SyntaxNode): boolean {
  return [
    "arrow_function",
    "function",
    "function_declaration",
    "generator_function",
    "generator_function_declaration",
    "method_definition",
    "function_definition",
    "function_declaration",
    "method_declaration",
    "function_item",
  ].includes(node.type);
}

function isClassNode(node: SyntaxNode): boolean {
  return ["class", "class_declaration", "class_definition", "class_specifier"].includes(node.type);
}

function walk(node: SyntaxNode, visit: (child: SyntaxNode) => void): void {
  visit(node);
  for (const child of node.namedChildren) {
    walk(child, visit);
  }
}

function importedSource(node: SyntaxNode): string | null {
  if (node.type === "import_statement" && node.childForFieldName("source")) {
    return node.childForFieldName("source")?.text.replace(/^['"]|['"]$/g, "") ?? null;
  }

  if (node.type === "call_expression" && node.childForFieldName("function")?.text === "require") {
    const argument = node.childForFieldName("arguments")?.namedChildren[0];
    return argument?.type === "string" ? argument.text.replace(/^['"]|['"]$/g, "") : null;
  }

  if (["import_statement", "import_from_statement"].includes(node.type)) {
    return (
      (
        node.childForFieldName("name")?.text ??
        node.childForFieldName("module")?.text ??
        node.text.replace(/^from\s+/, "").split(/\s+import\s+/)[0]
      )?.replace(/^['"]|['"]$/g, "") ?? null
    );
  }

  if (node.type === "import_declaration") {
    const quoted = node.text.match(/["]([^"]+)["]/);
    return (
      quoted?.[1] ??
      node.text
        .replace(/^import\s+/, "")
        .replace(/;$/, "")
        .trim()
    );
  }

  if (node.type === "preproc_include") {
    const match = node.text.match(/[<"]([^>"]+)[>"]/);
    return match?.[1] ?? null;
  }

  if (node.type === "import_spec") {
    const match = node.text.match(/["]([^"]+)["]/);
    return match?.[1] ?? null;
  }

  return null;
}

function resolveRelativeImport(
  fromPath: string,
  importPath: string,
  knownPaths: Set<string>,
): string | null {
  const relativeImportPath = importPath.startsWith("./")
    ? importPath.slice(2)
    : importPath.replace(/^\.+/, "");
  const basePath = importPath.startsWith(".")
    ? normalizePath(posix.join(posix.dirname(fromPath), relativeImportPath))
    : normalizePath(importPath.replaceAll(".", "/"));
  const candidates = [basePath];
  for (const extension of [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".py",
    ".java",
    ".c",
    ".h",
    ".cc",
    ".cpp",
    ".cxx",
    ".hpp",
    ".go",
  ]) {
    candidates.push(`${basePath}${extension}`);
  }
  for (const extension of [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".py",
    ".java",
    ".c",
    ".h",
    ".cc",
    ".cpp",
    ".cxx",
    ".hpp",
    ".go",
  ]) {
    candidates.push(posix.join(basePath, `index${extension}`));
  }

  return (
    candidates.find((candidate) => knownPaths.has(candidate)) ??
    [...knownPaths].find(
      (candidate) =>
        candidate.endsWith(importPath) ||
        candidate.replace(/\.[^.]+$/, "").endsWith(importPath.replaceAll(".", "/")),
    ) ??
    null
  );
}

function parserForExtension(extension: SupportedSourceExtension): Parser {
  const parser = new Parser();
  const language =
    extension === ".ts"
      ? TypeScript.typescript
      : extension === ".tsx"
        ? TypeScript.tsx
        : [".js", ".jsx"].includes(extension)
          ? JavaScript
          : extension === ".py"
            ? Python
            : extension === ".java"
              ? Java
              : extension === ".go"
                ? Go
                : [".cc", ".cpp", ".cxx", ".hpp"].includes(extension)
                  ? Cpp
                  : C;
  parser.setLanguage(language as unknown as Parameters<Parser["setLanguage"]>[0]);
  return parser;
}

export function extractRepository(input: ExtractionInput): ExtractionResult {
  const diagnostics: ExtractionDiagnostic[] = [];
  const entities: ExtractionEntity[] = [];
  const relationships: ExtractionRelationship[] = [];
  const normalizedFiles = input.files
    .map((file) => ({ ...file, path: normalizePath(file.path) }))
    .filter((file) => extensionForPath(file.path));
  const knownPaths = new Set(normalizedFiles.map((file) => file.path));
  const fileEntities = new Map<string, ExtractionEntity>();
  const moduleEntities = new Map<string, ExtractionEntity>();
  const functionEntitiesByName = new Map<string, ExtractionEntity[]>();
  const parsedFiles: Array<{ entity: ExtractionEntity; root: SyntaxNode }> = [];

  const repositoryEntity = createEntity(input, "Repository", input.repositoryId, "", {
    lineEnd: 1,
    lineStart: 1,
  });
  entities.push(repositoryEntity);

  for (const file of normalizedFiles) {
    const fileEntity = createEntity(input, "File", file.path, file.path, {
      lineEnd: 1,
      lineStart: 1,
    });
    const moduleEntity = createEntity(input, "Module", file.path, file.path, {
      lineEnd: 1,
      lineStart: 1,
    });
    fileEntities.set(file.path, fileEntity);
    moduleEntities.set(file.path, moduleEntity);
    entities.push(fileEntity, moduleEntity);
    relationships.push(
      createRelationship(repositoryEntity.id, "CONTAINS", fileEntity.id),
      createRelationship(fileEntity.id, "CONTAINS", moduleEntity.id),
    );

    const parser = parserForExtension(extensionForPath(file.path) as SupportedSourceExtension);
    const tree = parser.parse(file.source);
    parsedFiles.push({ entity: fileEntity, root: tree.rootNode });

    if (tree.rootNode.hasError) {
      diagnostics.push({
        message: "Tree-sitter reported a syntax error in this file.",
        path: file.path,
      });
    }

    walk(tree.rootNode, (node) => {
      if (isClassNode(node)) {
        const name = symbolName(node);
        if (name) {
          const entity = createEntity(input, "Class", name, file.path, lineRange(node), 0.95);
          entities.push(entity);
          relationships.push(createRelationship(fileEntity.id, "CONTAINS", entity.id));
        }
      }

      if (isFunctionNode(node)) {
        const name = functionName(node);
        if (name) {
          const entity = createEntity(input, "Function", name, file.path, lineRange(node), 0.95);
          entities.push(entity);
          relationships.push(createRelationship(fileEntity.id, "CONTAINS", entity.id));
          const existing = functionEntitiesByName.get(name) ?? [];
          existing.push(entity);
          functionEntitiesByName.set(name, existing);
        }
      }
    });
  }

  for (const file of normalizedFiles) {
    const fileEntity = fileEntities.get(file.path);
    if (!fileEntity) {
      continue;
    }

    const parsedFile = parsedFiles.find((candidate) => candidate.entity.id === fileEntity.id);
    if (!parsedFile) {
      continue;
    }

    walk(parsedFile.root, (node) => {
      const importPath = importedSource(node);
      if (importPath) {
        const targetPath = resolveRelativeImport(file.path, importPath, knownPaths);
        const targetEntity = targetPath ? moduleEntities.get(targetPath) : undefined;
        if (targetEntity) {
          relationships.push(createRelationship(fileEntity.id, "IMPORTS", targetEntity.id, 0.9));
        }
      }

      if (["call_expression", "call", "method_invocation"].includes(node.type)) {
        const calledName =
          node.childForFieldName("function")?.text ??
          node.childForFieldName("name")?.text ??
          node.namedChildren.find((child) =>
            ["identifier", "field_identifier"].includes(child.type),
          )?.text ??
          null;
        const targets = calledName ? (functionEntitiesByName.get(calledName) ?? []) : [];
        const target = targets.length === 1 ? targets[0] : undefined;
        if (target) {
          const caller = entities.find(
            (entity) =>
              entity.kind === "Function" &&
              entity.path === file.path &&
              entity.lineStart <= node.startPosition.row + 1 &&
              entity.lineEnd >= node.endPosition.row + 1,
          );
          if (caller && caller.id !== target.id) {
            relationships.push(createRelationship(caller.id, "CALLS", target.id, 0.75));
          }
        }
      }
    });
  }

  const uniqueRelationships = [
    ...new Map(relationships.map((relationship) => [relationship.id, relationship])).values(),
  ];
  return {
    diagnostics,
    entities,
    relationships: uniqueRelationships,
  };
}
