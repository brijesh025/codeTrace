# Phase 0 Evaluation: CodeGraph and FalkorDB

**Status:** Complete

**Decision:** Do not reuse FalkorDB CodeGraph as CodeTrace's production ingestion or extraction component. Build CodeTrace's TypeScript/JavaScript extractor in the Node.js worker using Tree-sitter, and load its normalized graph through CodeTrace-owned, parameterized FalkorDB queries.

## Why this decision was required

CodeTrace's MVP contract requires safe public-GitHub ingestion and extraction for TypeScript, TSX, JavaScript, and JSX, with source ranges, import/dependency evidence, and conservative call relationships. CodeGraph was evaluated before implementation as required by `README.md` and `Agent_Plan.md`.

## Evaluated CodeGraph revision

| Item | Evidence |
| --- | --- |
| Repository | <https://github.com/FalkorDB/code-graph> |
| Local revision | `2a7a52c0abb529c93e9f571e7358e097f1b76ab3` |
| Revision date | 2026-09-14 |
| Package version | `0.4.2` |
| License | MIT |
| Runtime declared by project | Python `>=3.12,<3.14` |
| Local Python | 3.14.5; incompatible with the declared range |
| Evaluation runtime | Disposable `python:3.13-bookworm` Docker container |

The MIT license permits selective reuse, but licensing is not sufficient reason to adopt a component that does not meet the required language, safety, or reliability boundaries.

## Findings

### Language coverage does not meet the MVP contract

The checked-out `SourceAnalyzer` registers `.js`, but not `.ts`, `.tsx`, or `.jsx`. Its source scan enumerates `.js` files only for the JavaScript family.

The JavaScript analyzer extracts only:

- `function_declaration` as `Function`;
- `class_declaration` as `Class`;
- `method_definition` as `Method`.

It therefore does not provide the required TypeScript/TSX/JSX coverage and is too narrow even for modern JavaScript code that primarily uses arrow functions, function expressions, or exports.

The CodeGraph README's supported-language section is stale relative to the evaluated source: it lists only Python, Java, and C#, while the current source additionally registers JavaScript and Kotlin. The source code, rather than that stale list, was used for this decision.

### JavaScript dependency evidence is incomplete

The evaluated JavaScript analyzer's `add_dependencies` method is a no-op and it does not implement JavaScript import resolution. This prevents CodeTrace from obtaining the required JavaScript `IMPORTS`/`DEPENDS_ON` evidence by direct reuse.

The CodeGraph graph model has useful concepts but is not a direct schema match:

| CodeGraph | CodeTrace |
| --- | --- |
| `File` | `File` |
| `Function` and `Method` | `Function` with a `kind` property where needed |
| `Class` | `Class` |
| `DEFINES` | `CONTAINS` |
| `CALLS` | `CALLS` |
| no JavaScript import mapping | `IMPORTS` and derived `DEPENDS_ON` implemented by CodeTrace |
| source `src_start`/`src_end` properties | `lineStart`/`lineEnd`, normalized to a documented user-facing convention |

CodeGraph stores Tree-sitter row positions, which are zero-based. CodeTrace will preserve raw parser ranges internally and expose one-based line numbers in user-facing evidence.

### Ingestion behavior is unsafe for CodeTrace reuse

The evaluated `Project._clone_source` implementation:

- accepts generic validated URLs rather than GitHub-only HTTPS URLs;
- performs a full clone rather than a bounded shallow clone;
- deletes an existing clone directory with the same derived name before cloning;
- has no repository-size, file-count, file-size, or timeout limits;
- stores clones under a process working directory rather than a CodeTrace-owned temporary workspace.

This conflicts with CodeTrace's required safe-ingestion boundary. CodeTrace will implement this boundary independently in Phase 3.

### Runtime reliability was insufficient in the live proof

The first CodeGraph run followed the documented pattern `--ignore .git`. Its substring-based ignore check treated the checkout directory `serve-static.git` as ignored, so it skipped every source file and produced an empty graph.

The second run omitted `--ignore .git` and did create graph data, but exited with code `139` after processing the JavaScript files. No Python traceback established the root cause, so this is recorded as an unconfirmed native/runtime failure rather than attributed to a specific package.

Because CodeTrace's core value depends on reliable evidence, an extractor that can crash after partial graph writes is not an acceptable production dependency for the MVP.

## Live proof of concept

### FalkorDB

FalkorDB was started locally through the evaluated CodeGraph Docker Compose configuration. A dependency-free Node.js TCP client sent raw Redis `GRAPH.QUERY` commands successfully.

The Node proof created and read this graph evidence:

```text
(:File {path: 'src/example.ts', lineStart: 1, lineEnd: 3})
  -[:CONTAINS]->
(:Function {name: 'example', lineStart: 1, lineEnd: 3})
```

This confirms that FalkorDB accepts CodeTrace's required property-graph shape and can be queried directly from Node.js. Phase 1 will replace the raw protocol spike with a supported Node client behind the worker boundary.

### CodeGraph against a public JavaScript repository

| Item | Result |
| --- | --- |
| Repository | <https://github.com/expressjs/serve-static.git> |
| Evaluated commit | `109a299c26d2d532027bb6e66e50e365eeb8fcdd` |
| Indexed graph | `code:serve-static.git:master` |
| Nodes written before process exit | 11 |
| Relationships written before process exit | 7 |
| Process exit code | 139 |

Despite the process failure, the generated graph provided inspectable source evidence. Examples include:

| File | Function | Start line | End line |
| --- | --- | ---: | ---: |
| `index.js` | `serveStatic` | 36 | 125 |
| `index.js` | `collapseLeadingSlashes` | 131 | 141 |
| `index.js` | `createHtmlDocument` | 151 | 162 |
| `index.js` | `createNotFoundDirectoryListener` | 169 | 173 |
| `index.js` | `createRedirectDirectoryListener` | 180 | 207 |
| `scripts/version-history.js` | `getLocaleDate` | 36 | 42 |
| `scripts/version-history.js` | `zeroPad` | 44 | 46 |

Each example had a persisted `(:File)-[:DEFINES]->(:Function)` path. The run did not produce reliable `CALLS` or JavaScript import relationships before it exited.

## Chosen approach: Node.js Tree-sitter extractor

CodeTrace will implement an owned Tree-sitter extraction layer in the `worker` package.

It will:

1. Parse `.ts`, `.tsx`, `.js`, and `.jsx` without executing repository code.
2. Emit normalized file, function, class, and module entities with exact source ranges.
3. Extract static import/export relationships into `IMPORTS` and cautiously derive `DEPENDS_ON` only from supported evidence.
4. Emit `CALLS` only when a target can be resolved by a deterministic rule; unresolved dynamic calls are omitted and represented as uncertainty, not edges.
5. Store normalized, one-based source locations and parser provenance in FalkorDB through CodeTrace-owned, parameterized queries.
6. Keep repository cloning, limits, cleanup, and idempotency outside the parser and under CodeTrace's worker control.

No CodeGraph source will be copied into CodeTrace during the MVP. Its broad approach—AST extraction plus a graph-backed evidence workflow—is compatible with the project goal, but the actual extraction, graph schema, ingestion safety, and tool boundary will be owned by CodeTrace.

## Phase 0 exit criteria

| Criterion | Status | Evidence |
| --- | --- | --- |
| Decision and evidence are documented | Pass | This document |
| FalkorDB starts and accepts a local query | Pass | Docker Compose started FalkorDB; Node.js wrote and read a graph record |
| A public sample repository produces inspectable graph data | Pass, with reliability failure recorded | `serve-static` produced 11 nodes, 7 relationships, source paths, and source ranges before CodeGraph exited 139 |
| The chosen approach can preserve paths and line ranges | Pass | CodeGraph's Tree-sitter-generated JavaScript graph preserved file paths and ranges; CodeTrace will preserve the same parser evidence in its normalized schema |

## Result

Phase 0 is complete. The next authorized phase is Phase 1: workspace and local infrastructure. Do not begin Phase 2 or later until Phase 1's compile, test, FalkorDB, health-check, and secret-handling exit criteria are all verified.
