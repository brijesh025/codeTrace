# CodeTrace Agent Plan

## Purpose

This document is the implementation contract for CodeTrace. It translates the repository README and the approved architectural direction into an ordered build plan.

The product is a codebase investigation agent. Given a supported public GitHub repository and a question about a changed or broken module or behavior, it should use a FalkorDB code graph to identify potentially affected files and symbols, rank them, and explain each result with verifiable graph paths and source locations.

This plan is intentionally incremental. Each phase must be implemented and verified before the next phase begins.

## Plan verification before implementation

The plan has been checked against the current `README.md` and preserves its core requirements:

- Next.js, TypeScript, Tailwind CSS, and shadcn/ui for the frontend.
- Node.js and TypeScript for the backend.
- FalkorDB as the graph-reasoning layer.
- TypeScript/JavaScript as the first supported language family.
- CodeGraph evaluation before deciding whether to use Tree-sitter.
- Safe repository ingestion without executing repository code or scripts.
- Idempotent graph loading.
- Parameterized investigation tools rather than unrestricted Cypher.
- Evidence-backed LLM answers with explicit uncertainty.
- Automated extraction, graph, evidence, and API tests.
- No vector database, multi-agent framework, cloud deployment, collaborative features, automatic edits, issue creation, or pull-request creation in the MVP.

The approved GitHub authentication requirement is added as a controlled extension: Auth.js/NextAuth will live in the Next.js frontend, while the backend remains responsible for API authorization and application behavior. The first ingestion implementation will support public GitHub repositories. Private-repository access is deferred until its permission and token-storage requirements are explicitly designed.

## Target architecture

```text
Browser
  |
  v
frontend (Next.js App Router + Auth.js/NextAuth)
  |  server-side authenticated API requests
  v
backend (Node.js + TypeScript API)
  |  typed worker calls
  v
worker (repository, extraction, graph, and investigation capabilities)
  |
  v
FalkorDB
```

The worker will initially be a separate workspace package imported by the backend. It will not be a separate network service or queue-backed deployment in the MVP. This preserves the requested `worker` boundary while avoiding an unnecessary service and operational dependency. The worker can later be isolated into a process or service if indexing workloads demonstrate that it is necessary.

## Repository structure to create

```text
frontend/
  app/
  components/
  lib/
  auth.ts
  package.json

backend/
  src/
    server.ts
    routes/
    auth/
    indexing/
    investigation/
    llm/
    validation/
    errors/
    types/
  package.json

worker/
  src/
    repository/
    extraction/
    graph/
    tools/
    jobs/
    types/
  package.json

docker-compose.yml
package.json
pnpm-workspace.yaml
tsconfig.base.json
frontend/.env.local
backend/.env
worker/.env
.gitignore
Agent_Plan.md
README.md
```

The exact directories may be adjusted after the CodeGraph evaluation, but the frontend/backend/worker ownership boundaries must remain clear.

## Architectural decisions

### Authentication

- Use Auth.js/NextAuth with GitHub as the initial provider.
- Keep GitHub client credentials and the Auth.js secret in server-side environment variables.
- Use the authenticated session to associate repositories, indexing jobs, and investigations with a user.
- Route browser API calls through the frontend or another server-side boundary so private backend configuration is never exposed to client code.
- Start with public repository URLs and minimal GitHub permissions.
- Do not store GitHub access tokens for the MVP.
- If private repositories are later required, evaluate a GitHub App or narrowly scoped token storage instead of adding broad OAuth permissions casually.

### Worker boundary

- The worker owns cloning, temporary workspace management, file filtering, extraction, graph loading, and graph investigation functions.
- The worker never installs dependencies, builds the repository, runs repository scripts, or executes repository code.
- Backend code calls typed worker functions instead of importing worker internals directly.
- Long-running work is represented by jobs and status records even while execution is in-process.

### Graph boundary

- Only the worker accesses FalkorDB.
- Backend and LLM tools use typed worker operations.
- User input and model output must never become unrestricted Cypher.
- All graph queries use bounded, parameterized templates.

### LLM boundary

- The LLM is used for tool selection, evidence interpretation, and report composition.
- The backend controls available tools, arguments, query limits, and response validation.
- The LLM is not trusted to invent relationships, line numbers, source paths, or evidence.

## Phase 0 — Technical evaluation spike

### Objectives

Determine whether FalkorDB CodeGraph can provide a useful extraction foundation without creating an integration or licensing problem.

### Work

1. Inspect the official CodeGraph repository.
2. Record its license, supported languages, extraction process, dependencies, graph schema, and integration surface.
3. Run it against a small public TypeScript/JavaScript repository.
4. Inspect the generated nodes, edges, paths, and source-location metadata.
5. Start FalkorDB locally with Docker Compose.
6. Query FalkorDB from a minimal Node.js script.
7. Compare CodeGraph output with the minimum CodeTrace schema.
8. Decide whether to reuse CodeGraph extraction or implement the required subset with Tree-sitter.

### Exit criteria

- The decision and its evidence are written in the project documentation.
- FalkorDB starts and accepts a query locally.
- A sample repository produces inspectable graph data.
- The chosen extraction approach can preserve paths and line ranges.

## Phase 1 — Workspace and local infrastructure

Status: complete and verified. See the Phase 1 implementation in the workspace and the root `verify:phase1` command.

### Work

1. Create the workspace packages and root scripts.
2. Configure TypeScript, linting, formatting, and the test runner.
3. Add Docker Compose for FalkorDB.
4. Add environment parsing and per-package `.env` files.
5. Add health checks for the backend and FalkorDB connection.
6. Add basic package-level type boundaries.
7. Add a clean-checkout development command sequence.

### Initial environment contract by package

```text
frontend/.env.local
AUTH_GITHUB_ID
AUTH_GITHUB_SECRET
AUTH_SECRET
AUTH_INTERNAL_SECRET
BACKEND_URL

backend/.env
BACKEND_HOST
BACKEND_PORT
AUTH_INTERNAL_SECRET
FALKORDB_URL
LLM_API_KEY
LLM_MODEL

worker/.env
WORKER_TEMP_DIR
```

### Exit criteria

- All packages compile.
- Tests execute from the repository root.
- FalkorDB starts locally.
- Backend health checks work.
- No secrets are committed or sent to browser bundles.

## Phase 2 — Authentication and repository identity

Status: implementation complete for the local structural contract. Live GitHub OAuth remains an external verification step requiring a configured GitHub OAuth application.

### Work

1. Add Auth.js/NextAuth GitHub login to `frontend`.
2. Add signed-in and signed-out UI states.
3. Protect repository and investigation actions.
4. Define the user/session identity passed to backend requests.
5. Add backend authorization middleware.
6. Return consistent unauthenticated and unauthorized errors.

### Scope constraint

Authentication establishes application identity, but public repository ingestion remains the initial repository-access model. No private-repository token persistence will be introduced implicitly.

### Exit criteria

- A user can sign in and sign out with GitHub.
- Protected actions reject missing sessions.
- GitHub credentials remain server-only.
- Backend authorization tests pass.

## Phase 3 — Safe repository ingestion in the worker

Status: implementation complete and verified. The worker validates public GitHub URLs, performs bounded shallow clones, captures commit metadata, excludes unsafe/generated inputs, and cleans temporary workspaces.

### Work

Implement the worker repository boundary:

- GitHub HTTPS URL validation and canonicalization.
- Repository identity and revision tracking.
- Temporary isolated workspace creation.
- Shallow clone of the requested repository.
- Commit SHA capture.
- File count, file size, and repository size limits.
- Exclusion of `.git`, `node_modules`, build output, coverage output, and large binaries.
- Cleanup after success and failure.
- Structured ingestion errors and status updates.

The clone mechanism may invoke Git, but no repository-provided lifecycle scripts, binaries, package managers, or source code may be executed.

### Exit criteria

- Valid public repositories clone successfully.
- Invalid and unsupported URLs are rejected.
- Oversized inputs fail safely.
- Temporary directories are cleaned.
- Commit SHA and ingestion metadata are returned.

## Phase 4 — TypeScript/JavaScript extraction

Status: initial extraction slice implemented and verified. Tree-sitter now produces stable repository, file, module, function, and class entities, resolvable relative imports, unambiguous direct calls, source ranges, and syntax diagnostics.

### Work

Support the initial language family:

- `.ts`
- `.tsx`
- `.js`
- `.jsx`

Extract the minimum graph model:

### Nodes

- `Repository`
- `File`
- `Function`
- `Class`
- `Module`

### Relationships

- `CONTAINS`
- `IMPORTS`
- `CALLS`
- `DEPENDS_ON`

Preserve for every extracted item where available:

- repository identity;
- commit SHA;
- relative source path;
- symbol name;
- start and end lines;
- stable identifier;
- extraction provenance;
- confidence or uncertainty.

Rules:

- Do not create unresolved `CALLS` edges.
- Do not fabricate symbols or locations.
- Report syntax failures per file.
- Keep extraction deterministic.
- Exclude generated files where practical.

### Exit criteria

- Fixture repositories have extraction tests.
- Entities and line ranges are correct.
- Imports and supported calls produce verifiable relationships.
- Ambiguous relationships are marked uncertain or omitted.

## Phase 5 — Idempotent FalkorDB loading

Status: implementation complete and verified. The worker graph store uses parameterized `GRAPH.QUERY` calls with stable `MERGE` keys, revision metadata, counts, repeat-load idempotency, and replacement of older revisions.

### Work

1. Define stable node and relationship identifiers.
2. Implement parameterized `MERGE`-style writes.
3. Store repository, revision, path, line ranges, provenance, and confidence.
4. Return node and relationship counts.
5. Make repeated indexing of the same revision safe.
6. Define controlled replacement behavior for a newer repository revision.

Stable identity should include repository identity, commit SHA, entity kind, source path, symbol identity, and source location as appropriate.

The MVP will maintain one active indexed revision per repository unless the CodeGraph evaluation demonstrates a better low-complexity model.

### Exit criteria

- A real repository produces graph nodes and edges.
- Re-indexing the same revision does not duplicate data.
- Counts and revision information are reported.
- FalkorDB is inaccessible from the frontend.

## Phase 6 — Backend indexing API and job lifecycle

### Initial endpoints

```text
GET  /health
POST /repositories/index
GET  /repositories/:id/index-status
POST /investigations
GET  /investigations/:id
```

### Work

1. Add request validation.
2. Add authenticated repository and investigation ownership.
3. Start worker indexing jobs.
4. Track queued, running, succeeded, and failed states.
5. Return progress counts and error details.
6. Add idempotency behavior for duplicate index requests.
7. Keep the initial job manager in-process.

A queue or separate worker deployment is deferred until load testing demonstrates that in-process execution is insufficient.

### Exit criteria

- Indexing can be started through the API.
- Status can be polled.
- Duplicate requests behave predictably.
- Failures return structured errors.
- API tests cover authorization and invalid input.

## Phase 7 — Investigation tools and ranking

### Typed tools

1. `find_entities`
2. `find_dependencies`
3. `find_callers`
4. `traverse_relationships`
5. `get_evidence_path`
6. `get_source_locations`

### Tool result contract

Each result should include, where applicable:

- entity ID;
- entity type;
- source path;
- line range;
- relationship path;
- traversal distance;
- confidence;
- extraction provenance.

### Ranking

Begin with deterministic ranking based on:

1. exact entity match;
2. direct caller or dependency evidence;
3. relationship distance;
4. number of independent supporting paths;
5. confidence;
6. source-location availability.

The scoring should be explicit, bounded, and testable before any LLM-generated ranking is considered.

### Exit criteria

- Tools have unit and integration tests.
- Queries are bounded and parameterized.
- Results are reproducible.
- Every reported path maps to real graph data.

## Phase 8 — LLM agent workflow

### Work

1. Define the server-side model client.
2. Define the allowed tool schemas.
3. Validate tool arguments before execution.
4. Let the model select tools and interpret results.
5. Validate the final investigation response.
6. Require evidence for substantive findings.
7. Add uncertainty notes when graph coverage is incomplete.
8. Handle model, tool, timeout, and rate-limit failures.

The final response format should contain:

- short investigation summary;
- ranked affected files/functions;
- evidence relationship paths;
- source locations;
- prioritized investigation checklist;
- uncertainty and limitations.

The model must not modify source files, create issues, create pull requests, execute arbitrary commands, or generate unrestricted Cypher.

### Exit criteria

- A realistic question produces an evidence-backed report.
- Each substantive finding includes evidence or an explicit limitation.
- Tool failures do not become fabricated answers.
- Provider and model configuration remain environment-driven.

## Phase 9 — Frontend workflow

### Screens and states

Implement a minimal UI for:

- GitHub authentication;
- repository URL entry;
- indexing status;
- question entry;
- investigation progress;
- investigation result;
- ranked findings;
- relationship paths;
- source locations;
- prioritized checklist;
- uncertainty notes.

Support clear states for:

- signed out;
- empty form;
- invalid repository;
- indexing;
- indexing failure;
- investigation in progress;
- no evidence;
- successful answer;
- backend or LLM failure.

### Exit criteria

- A user can complete the full workflow from the browser.
- Evidence and model interpretation are visually distinct.
- Errors are actionable.
- The frontend does not contain backend secrets.

## Phase 10 — End-to-end validation and regression tests

### Required automated coverage

- URL validation.
- Safe clone behavior.
- Workspace cleanup.
- File filtering.
- TypeScript/JavaScript extraction.
- Line preservation.
- Graph node creation.
- Graph relationship creation.
- Idempotent indexing.
- Traversal queries.
- Ranking.
- Evidence formatting.
- Tool argument validation.
- Authentication and authorization.
- API error handling.
- Unsupported-question handling.

### Required realistic scenario

1. Sign in with GitHub.
2. Submit a public TypeScript/JavaScript repository.
3. Index the repository.
4. Ask which components could be affected if a selected function changes.
5. Verify that the answer contains ranked components, graph paths, source locations, and uncertainty where appropriate.
6. Re-index the same revision and confirm graph counts remain idempotent.

Compare at least a few investigations against a simple keyword-search baseline. Record observations rather than claiming improvement without evidence.

## Phase 11 — Documentation and handoff

Update `README.md` with:

- prerequisites;
- Node.js and package-manager versions;
- FalkorDB startup instructions;
- GitHub OAuth setup;
- environment setup;
- development commands;
- test commands;
- supported extensions;
- graph schema;
- ingestion limits;
- known extraction limitations;
- troubleshooting;
- clean-checkout setup.

The implementation is not considered MVP-complete until another developer can run the full local flow from a clean checkout.

## MVP acceptance checklist

- [ ] User can authenticate with GitHub.
- [ ] User can submit a supported public GitHub repository.
- [ ] Repository is cloned without executing repository code or scripts.
- [ ] Graph contains real entities and evidence-backed relationships.
- [ ] Re-indexing the same revision is idempotent.
- [ ] Investigation traverses FalkorDB relationships.
- [ ] Results are ranked deterministically before model explanation.
- [ ] Substantive findings include graph-path evidence.
- [ ] Source paths and line ranges are shown where available.
- [ ] Missing evidence produces an uncertainty note.
- [ ] Invalid inputs and service failures produce clear messages.
- [ ] Automated tests pass.
- [ ] Local setup documentation is complete.

## Deferred scope

Do not implement these in the initial MVP:

- private repository access;
- cloud deployment;
- CI/CD;
- vector database;
- multi-agent framework;
- collaborative workspaces;
- persistent conversational memory;
- automatic code edits;
- issue creation;
- pull-request creation;
- multi-language extraction;
- separate queue infrastructure;
- separate worker hosting.

## First coding slice after approval

1. Create the workspace and package boundaries.
2. Add FalkorDB Docker Compose configuration.
3. Add TypeScript builds, environment validation, and tests.
4. Complete the CodeGraph evaluation spike.
5. Add a small TypeScript/JavaScript fixture repository.
6. Write and query one real graph.
7. Record the CodeGraph-versus-Tree-sitter decision.

No broad feature implementation should begin until this slice passes its exit criteria.
