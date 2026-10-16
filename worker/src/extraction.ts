import { createHash } from "node:crypto";
import { posix } from "node:path";

import Parser, { type SyntaxNode } from "tree-sitter";
import JavaScript from "tree-sitter-javascript";
import TypeScript from "tree-sitter-typescript";

import type { SupportedSourceExtension } from "./index.js";

const sourceExtensions = new Set<SupportedSourceExtension>([".js", ".jsx", ".ts", ".tsx"]);

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
    id: hashId(kind, input.repositoryId, path, name, String(range.lineStart)),
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

  if (node.type !== "arrow_function" && node.type !== "function") {
    return null;
  }

  const parent = node.parent;
  if (parent?.type !== "variable_declarator") {
    return null;
  }

  return parent.childForFieldName("name")?.text ?? null;
}

function isFunctionNode(node: SyntaxNode): boolean {
  return [
    "arrow_function",
    "function",
    "function_declaration",
    "generator_function",
    "generator_function_declaration",
    "method_definition",
  ].includes(node.type);
}

function isClassNode(node: SyntaxNode): boolean {
  return ["class", "class_declaration"].includes(node.type);
}

function walk(node: SyntaxNode, visit: (child: SyntaxNode) => void): void {
  visit(node);
  for (const child of node.namedChildren) {
    walk(child, visit);
  }
}

function importedSource(node: SyntaxNode): string | null {
  if (node.type === "import_statement") {
    return node.childForFieldName("source")?.text.replace(/^['"]|['"]$/g, "") ?? null;
  }

  if (node.type === "call_expression" && node.childForFieldName("function")?.text === "require") {
    const argument = node.childForFieldName("arguments")?.namedChildren[0];
    return argument?.type === "string" ? argument.text.replace(/^['"]|['"]$/g, "") : null;
  }

  return null;
}

function resolveRelativeImport(
  fromPath: string,
  importPath: string,
  knownPaths: Set<string>,
): string | null {
  if (!importPath.startsWith(".")) {
    return null;
  }

  const basePath = normalizePath(posix.join(posix.dirname(fromPath), importPath));
  const candidates = [basePath];
  for (const extension of [".ts", ".tsx", ".js", ".jsx"]) {
    candidates.push(`${basePath}${extension}`);
  }
  for (const extension of [".ts", ".tsx", ".js", ".jsx"]) {
    candidates.push(posix.join(basePath, `index${extension}`));
  }

  return candidates.find((candidate) => knownPaths.has(candidate)) ?? null;
}

function parserForExtension(extension: SupportedSourceExtension): Parser {
  const parser = new Parser();
  parser.setLanguage(
    extension === ".ts"
      ? TypeScript.typescript
      : extension === ".tsx"
        ? TypeScript.tsx
        : JavaScript,
  );
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

      if (node.type === "call_expression") {
        const calledName =
          node.childForFieldName("function")?.type === "identifier"
            ? node.childForFieldName("function")?.text
            : null;
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
