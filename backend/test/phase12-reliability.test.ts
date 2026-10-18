import { describe, expect, it } from "vitest";

import { InvestigationAgent, type InvestigationReport } from "../src/agent.js";
import type { LlmClient, LlmGenerateResponse } from "../src/llm.js";
import type {
  CallerInput,
  DependencyInput,
  EvidencePathInput,
  EvidencePathResult,
  FindEntitiesInput,
  InvestigationEntity,
  InvestigationResult,
  InvestigationTools as WorkerInvestigationTools,
  RelationshipTraversalInput,
  SourceLocationInput,
  SourceLocationResult,
} from "@codetrace/worker";

const scope = {
  commitSha: "0123456789abcdef0123456789abcdef01234567",
  repositoryId: "example/repository",
};

const root: InvestigationEntity = {
  confidence: 0.95,
  id: "entity-root",
  kind: "Function",
  lineEnd: 10,
  lineStart: 2,
  name: "run",
  path: "src/run.ts",
  provenance: "tree-sitter",
};

const affected: InvestigationEntity = {
  confidence: 0.9,
  id: "entity-affected",
  kind: "Function",
  lineEnd: 24,
  lineStart: 16,
  name: "consumer",
  path: "src/consumer.ts",
  provenance: "tree-sitter",
};

const evidencePath = {
  distance: 1,
  entities: [root, affected],
  relationships: [
    {
      confidence: 0.8,
      direction: "outgoing" as const,
      fromId: root.id,
      graphFromId: root.id,
      graphToId: affected.id,
      id: "relationship-1",
      kind: "CALLS" as const,
      toId: affected.id,
    },
  ],
};

function rankedResult(): InvestigationResult {
  return {
    results: [
      {
        ...affected,
        evidencePaths: [evidencePath],
        ranking: {
          confidence: affected.confidence,
          directEvidence: 1,
          exactEntityMatch: 0,
          independentPaths: 1 / 3,
          relationshipDistance: 1,
          sourceLocation: 1,
        },
        score: 7.2,
      },
    ],
    scope,
    truncated: false,
  };
}

function emptyResult(input: { commitSha: string; repositoryId: string; [key: string]: unknown }) {
  return { results: [], scope: input, truncated: false };
}

function sourceResult(): SourceLocationResult {
  return { locations: [affected], scope, truncated: false };
}

class FakeLlm implements LlmClient {
  readonly requests: Array<Parameters<LlmClient["generate"]>[0]> = [];

  constructor(private readonly responses: LlmGenerateResponse[]) {}

  async generate(request: Parameters<LlmClient["generate"]>[0]): Promise<LlmGenerateResponse> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (!response) {
      throw new Error("No fake response available.");
    }
    return response;
  }
}

function functionCall(
  name: string,
  args: Record<string, unknown>,
  id: string,
): LlmGenerateResponse {
  return {
    content: { parts: [{ functionCall: { args, id, name } }], role: "model" },
    functionCalls: [{ args, id, name }],
    text: "",
  };
}

function finalResponse(report: Partial<InvestigationReport>): LlmGenerateResponse {
  const text = JSON.stringify(report);
  return {
    content: { parts: [{ text }], role: "model" },
    functionCalls: [],
    text,
  };
}

function emptyReport(summary = "No supported graph evidence was found."): LlmGenerateResponse {
  return finalResponse({
    checklist: ["Verify the repository and commit scope."],
    findings: [],
    summary,
    uncertainty: ["The graph returned no matching evidence for this question."],
  });
}

function fakeTools(): Pick<
  WorkerInvestigationTools,
  | "find_callers"
  | "find_dependencies"
  | "find_entities"
  | "get_evidence_path"
  | "get_source_locations"
  | "traverse_relationships"
> {
  return {
    find_callers: async (input: CallerInput) => ({ ...rankedResult(), scope: input }),
    find_dependencies: async (input: DependencyInput) => ({
      ...(input.entityId === root.id ? rankedResult() : emptyResult(input)),
      scope: input,
    }),
    find_entities: async (input: FindEntitiesInput) => {
      if (input.query.toLowerCase().includes("authentication")) {
        return emptyResult(input);
      }
      const initialResult = rankedResult().results[0];
      if (!initialResult) {
        throw new Error("Missing fake ranked result.");
      }
      return {
        results: [{ ...root, evidencePaths: [], ranking: initialResult.ranking, score: 2 }],
        scope: input,
        truncated: false,
      };
    },
    get_evidence_path: async (input: EvidencePathInput): Promise<EvidencePathResult> => ({
      paths:
        input.fromEntityId === root.id && input.toEntityId === affected.id ? [evidencePath] : [],
      scope: input,
      truncated: false,
    }),
    get_source_locations: async (input: SourceLocationInput) => ({
      ...(input.entityIds.includes(affected.id)
        ? sourceResult()
        : { locations: [], scope, truncated: false }),
      scope: input,
    }),
    traverse_relationships: async (input: RelationshipTraversalInput) => ({
      ...(input.entityId === root.id ? rankedResult() : emptyResult(input)),
      scope: input,
    }),
  };
}

describe("Phase 12 reliability fixtures", () => {
  it("reproduces a natural-language discovery query returning zero graph results", async () => {
    const llm = new FakeLlm([
      functionCall("find_entities", { query: "authentication using google fails" }, "call-1"),
      emptyReport(),
    ]);

    const result = await new InvestigationAgent(llm, fakeTools()).run({
      ...scope,
      question: "Why does authentication using Google fail?",
    });

    expect(result.report.findings).toHaveLength(0);
    expect(result.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tool_result",
          result: expect.objectContaining({ resultCount: 0 }),
          status: "succeeded",
          toolName: "find_entities",
        }),
      ]),
    );
  });

  it("normalizes stringified numeric arguments before executing a graph tool", async () => {
    const llm = new FakeLlm([
      functionCall("find_entities", { query: "run" }, "call-1"),
      functionCall(
        "find_dependencies",
        { entityId: root.id, limit: "10", maxDepth: "2" },
        "call-2",
      ),
      emptyReport("The entity was found, but dependency arguments were rejected."),
    ]);

    const result = await new InvestigationAgent(llm, fakeTools()).run({
      ...scope,
      question: "What depends on run?",
    });

    expect(result.report.uncertainty).not.toContain(
      "Some investigation tools failed: Invalid arguments for find_dependencies.",
    );
    expect(result.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tool_result",
          result: expect.objectContaining({ resultCount: 1 }),
          status: "succeeded",
          toolName: "find_dependencies",
        }),
      ]),
    );
  });

  it("rejects a natural-language entity ID with an actionable tool error", async () => {
    const llm = new FakeLlm([
      functionCall(
        "find_dependencies",
        { entityId: "google authentication", limit: 10, maxDepth: 2 },
        "call-1",
      ),
      emptyReport("The requested entity was not resolved in the indexed graph."),
    ]);

    const result = await new InvestigationAgent(llm, fakeTools()).run({
      ...scope,
      question: "Trace Google authentication.",
    });

    expect(result.report.findings).toHaveLength(0);
    expect(result.report.uncertainty).toContain(
      'Some investigation tools failed: Unknown entity ID "google authentication" for find_dependencies.',
    );
    expect(result.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tool_result",
          result: expect.objectContaining({
            nextStep:
              "Call find_entities first, then use an exact entity ID returned by that tool.",
            toolErrorCode: "ENTITY_NOT_FOUND",
          }),
          status: "failed",
          toolName: "find_dependencies",
        }),
      ]),
    );
  });

  it("recovers from a malformed forced-final response while preserving the investigation trace", async () => {
    const llm = new FakeLlm([
      functionCall("find_entities", { query: "authentication" }, "call-1"),
      functionCall("find_entities", { query: "authentication" }, "call-2"),
      functionCall("find_entities", { query: "authentication" }, "call-3"),
      functionCall("find_entities", { query: "authentication" }, "call-4"),
      functionCall("find_entities", { query: "authentication" }, "call-5"),
      functionCall("find_entities", { query: "authentication" }, "call-6"),
      {
        content: { parts: [{ text: "I need more tools." }], role: "model" },
        functionCalls: [],
        text: "I need more tools.",
      },
      emptyReport("No verified evidence was found after bounded discovery."),
    ]);

    const result = await new InvestigationAgent(llm, fakeTools()).run({
      ...scope,
      question: "Investigate authentication.",
    });

    expect(result.report.status).toBe("NO_VERIFIED_EVIDENCE");
    expect(result.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "question" }),
        expect.objectContaining({ kind: "tool_call" }),
        expect.objectContaining({ kind: "tool_result" }),
        expect.objectContaining({ kind: "final", status: "failed" }),
        expect.objectContaining({ kind: "final", status: "validated" }),
      ]),
    );
  });

  it("returns structured no-evidence output after finalization recovery is exhausted", async () => {
    const llm = new FakeLlm([
      functionCall("find_entities", { query: "authentication" }, "call-1"),
      functionCall("find_entities", { query: "authentication" }, "call-2"),
      functionCall("find_entities", { query: "authentication" }, "call-3"),
      functionCall("find_entities", { query: "authentication" }, "call-4"),
      functionCall("find_entities", { query: "authentication" }, "call-5"),
      functionCall("find_entities", { query: "authentication" }, "call-6"),
      {
        content: { parts: [{ text: "not json" }], role: "model" },
        functionCalls: [],
        text: "not json",
      },
      {
        content: { parts: [{ text: "still not json" }], role: "model" },
        functionCalls: [],
        text: "still not json",
      },
    ]);

    const result = await new InvestigationAgent(llm, fakeTools()).run({
      ...scope,
      question: "Investigate authentication.",
    });

    expect(result.report.status).toBe("NO_VERIFIED_EVIDENCE");
    expect(result.report.uncertainty[0]).toContain("NO_VERIFIED_EVIDENCE");
    expect(
      result.trace.filter((step) => step.kind === "final" && step.status === "failed"),
    ).toHaveLength(2);
    expect(result.trace.at(-1)).toEqual(
      expect.objectContaining({
        kind: "final",
        status: "validated",
        summary: "Returned a structured NO_VERIFIED_EVIDENCE result.",
      }),
    );
  });
});
