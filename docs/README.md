# Codebase Investigation Agent

## Goal

Build an agent that investigates a codebase using **FalkorDB as its graph-reasoning layer**. Given a repository and a question about a bug or code change, it should identify potentially affected components, rank where to investigate first, and explain each finding with verifiable graph paths and source locations.

## Current implementation status

- [Phase 0 evaluation](PHASE_0_EVALUATION.md) is complete: CodeTrace will use an owned Node.js Tree-sitter extractor rather than directly reusing FalkorDB CodeGraph.
- Phase 1 establishes the workspace, local FalkorDB service, environment contract, package boundaries, and backend health check.
- Phase 2 adds GitHub-only Auth.js authentication and a short-lived signed frontend-to-backend identity boundary. Local configuration lives in `frontend/.env.local`, `backend/.env`, and `worker/.env`.
- Phase 3 implements the worker repository boundary: public GitHub URL validation, bounded shallow cloning, commit metadata, file filtering, and cleanup.
- Phase 4 adds the first Tree-sitter extraction slice for TypeScript/JavaScript entities, source ranges, resolvable imports, direct calls, stable identifiers, and syntax diagnostics.
- Phase 5 adds worker-owned, parameterized FalkorDB graph loading with idempotent writes, revision replacement, evidence metadata, and counts.
- LLM orchestration and the investigation UI remain intentionally deferred to their planned phases.

### Phase 2 local authentication setup

1. Create a GitHub OAuth App with callback URL `http://localhost:3000/api/auth/callback/github`.
2. Put frontend values in `frontend/.env.local`, backend values in `backend/.env`, and worker values in `worker/.env`.
3. Use backend port `5001`; set `BACKEND_URL=http://127.0.0.1:5001` in the frontend environment.
4. Run the local verification gate with `pnpm verify:phase2`. The real GitHub sign-in redirect requires the OAuth App credentials from step 1.

This must be more than a generic code-chat interface or a wrapper around FalkorDB CodeGraph. Reuse existing extraction logic where appropriate; build the investigation workflow, graph queries, ranking, and evidence-backed answer flow as our contribution.

## Primary MVP

Support one repository and one language family first: **TypeScript/JavaScript**. The main investigation question is:

> If this module or behavior is broken or changed, which parts of the codebase should I investigate, and why?

A user should be able to submit a public GitHub repository URL and an investigation question, index the repository, and receive:

- A short investigation summary.
- A ranked list of potentially affected files/functions.
- The graph relationship path supporting each result.
- Source file paths and line locations where available.
- A concise, prioritized investigation checklist.
- An explicit uncertainty note when graph coverage or evidence is incomplete.

## Agreed Stack

- **Frontend:** Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui.
- **Backend:** Node.js + TypeScript, exposed through a small API service.
- **Graph database:** FalkorDB, run locally with Docker Compose during development.
- **Code extraction:** First evaluate [FalkorDB CodeGraph](https://github.com/FalkorDB/code-graph). Reuse its extraction logic only after checking current capabilities, license, dependencies, and how it can be integrated. If it does not fit, use Tree-sitter for TypeScript/JavaScript parsing and implement only the missing extraction/mapping logic.
- **LLM:** A tool-calling model accessed server-side through an API key in environment variables. Keep provider/model configuration out of source code.
- **Tests:** Automated tests for extraction, graph ingestion/querying, and evidence formatting.

Do not add a vector database, multi-agent framework, or additional services unless a demonstrated MVP requirement justifies them.

## Architecture

1. **Repository ingestion:** Validate a public GitHub HTTPS URL; clone it into a temporary workspace without executing repository code or scripts.
2. **Extraction:** Parse supported source files and produce normalized code entities and relationships. Preserve source paths and line ranges.
3. **Graph loading:** Upsert nodes and edges into FalkorDB using stable IDs and idempotent `MERGE`-style writes.
4. **Investigation tools:** Expose narrow backend functions for entity search, dependency/caller traversal, relationship-path retrieval, and source-location lookup.
5. **Agent orchestration:** Let the LLM select from those tools, interpret their results, and compose a report. The backend—not the LLM—controls query templates and validates tool arguments.
6. **Results UI:** Show the answer, ranked findings, evidence paths, source locations, and next steps. Clearly separate retrieved evidence from model-generated interpretation.

## Initial Graph Model

Start with the smallest useful schema and extend only when required:

- **Nodes:** `Repository`, `File`, `Function`, `Class`, `Module`.
- **Relationships:** `CONTAINS`, `IMPORTS`, `CALLS`, `DEPENDS_ON`.
- Add a relationship only when the extractor has evidence for it. Do not invent unresolved call edges. Record extraction provenance and confidence where practical.
- Use stable identifiers based on repository identity and symbol/file location. Re-indexing the same revision must not create duplicate nodes or edges.
- Preserve file paths and line ranges for evidence display.

If the existing CodeGraph schema differs, document the mapping rather than forcing a needless rewrite.

## Implementation Plan

### Phase 1 — Inspect before building

- Inspect the current workspace and its existing files before changing anything.
- Review the official CodeGraph repository, its license, supported languages, extraction process, graph schema, query interface, and integration options.
- Run a small local proof of concept against a public TypeScript/JavaScript repository and inspect the actual generated graph.
- Confirm FalkorDB can be started locally and queried from Node.js.
- Write down what can be reused and what is genuinely missing. Do not assume CodeGraph capabilities without testing them.

### Phase 2 — Reliable indexing

- Create the project structure and local Docker Compose configuration for FalkorDB.
- Implement or adapt repository ingestion and extraction for the selected language.
- Load nodes and relationships into FalkorDB with repeatable, idempotent indexing.
- Add a command or API endpoint to index a repository and report indexing status/counts.
- Test that re-indexing the same revision does not duplicate graph data.

### Phase 3 — Graph investigation tools

- Implement tested, parameterized Cypher query functions for entity lookup, dependency/caller traversal, and evidence-path retrieval.
- Return structured results including node IDs, relationship paths, source paths, line ranges, and confidence where available.
- Add deterministic ranking based on graph evidence and distance first; keep the ranking understandable and tunable.
- Do not expose unrestricted model-generated Cypher execution.

### Phase 4 — Agent workflow

- Define a small tool set for the LLM: find code entities, traverse relationships, retrieve source evidence, and build an investigation result.
- Require claims about affected components to include retrieved evidence. If evidence is missing, say so rather than guessing.
- Produce ranked findings and a prioritized checklist. Do not modify source files or automatically create issues/PRs.
- Keep the workflow deterministic enough to test; use the LLM for tool selection and explanation, not as a substitute for graph queries.

### Phase 5 — Local UI

- Build a simple interface for repository URL entry, question entry, indexing status, and investigation results.
- Show affected files/functions, relationship paths, source locations, and why each result was ranked.
- Include useful loading, empty, and error states. Keep the UI minimal until the end-to-end flow works.

### Phase 6 — Validate the MVP

- Test one realistic investigation from repository URL through graph-backed answer.
- Add tests for extraction, idempotent indexing, graph traversal, evidence attachment, tool argument validation, and error handling.
- Compare the investigation with a simple baseline such as keyword search; record a few test questions and whether the graph added useful connected context. Do not claim measured improvements without results.
- Finish local setup instructions and ensure another developer can run the project from a clean checkout.

## Acceptance Criteria

The MVP is complete only when all of these work locally:

1. A user can index a supported public repository from the UI.
2. The extracted graph contains real code entities and evidence-backed relationships.
3. Re-indexing the same revision is idempotent.
4. An investigation traverses FalkorDB relationships and returns ranked affected components.
5. Each substantive finding links to graph-path evidence and source locations where available.
6. Unsupported questions, missing relationships, and indexing/LLM failures produce clear messages rather than fabricated answers.
7. Tests and local run instructions are included.

## Constraints for Codex

- Work incrementally. Finish and test each phase before starting the next.
- Inspect existing code and preserve working project choices; do not overwrite files blindly.
- Start with the CodeGraph evaluation spike. Choose reuse vs. Tree-sitter based on findings, not assumptions.
- Keep TypeScript types explicit at API, extraction, graph, and agent boundaries.
- Keep each package's secrets in its local `.env.local` or `.env` file, excluded from Git.
- Validate repository URLs and tool inputs. Never execute code from an ingested repository.
- Use bounded, parameterized graph queries and restrict graph access to the backend.
- Track source provenance and uncertainty. Never fabricate call relationships, line numbers, or proof paths.
- Avoid premature abstractions and unnecessary dependencies. Keep the MVP runnable after every phase.
- Do not implement cloud deployment, hosting, CI/CD, collaborative features, persistent conversational memory, automatic code edits, issue creation, or pull-request creation in this phase. GitHub-only authentication is the approved controlled extension described above.

## Local Development Deliverables

- Next.js frontend and Node.js/TypeScript backend.
- Local FalkorDB Docker Compose configuration.
- Per-package `.env.local`/`.env` files with required variable names.
- Repeatable indexing and investigation workflow.
- Automated tests and concise local setup/run instructions.
