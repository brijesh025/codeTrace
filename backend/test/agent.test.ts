import { describe, expect, it } from "vitest";

import {
  InvestigationAgent,
  type InvestigationAgentError,
  type InvestigationReport,
} from "../src/agent.js";
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
  return {
    content: { parts: [{ text: JSON.stringify(report) }], role: "model" },
    functionCalls: [],
    text: JSON.stringify(report),
  };
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
  const initialResult = rankedResult().results[0];
  if (!initialResult) {
    throw new Error("Missing fake ranked result.");
  }

  return {
    find_callers: async (input: CallerInput) => ({ ...rankedResult(), scope: input }),
    find_dependencies: async (input: DependencyInput) => ({ ...rankedResult(), scope: input }),
    find_entities: async (input: FindEntitiesInput) => ({
      results: [{ ...root, evidencePaths: [], ranking: initialResult.ranking, score: 2 }],
      scope: input,
      truncated: false,
    }),
    get_evidence_path: async (input: EvidencePathInput): Promise<EvidencePathResult> => ({
      paths: [evidencePath],
      scope: input,
      truncated: false,
    }),
    get_source_locations: async (input: SourceLocationInput) => ({
      ...sourceResult(),
      scope: input,
    }),
    traverse_relationships: async (input: RelationshipTraversalInput) => ({
      ...rankedResult(),
      scope: input,
    }),
  };
}

describe("InvestigationAgent", () => {
  it("executes only declared tools and attaches verified evidence to the final report", async () => {
    const llm = new FakeLlm([
      functionCall("find_entities", { query: "run" }, "call-1"),
      functionCall("find_dependencies", { entityId: "entity-root", maxDepth: 2 }, "call-2"),
      functionCall("get_source_locations", { entityIds: ["entity-affected"] }, "call-3"),
      finalResponse({
        checklist: ["Inspect the consumer before changing run."],
        findings: [
          { entityId: "entity-affected", priority: "high", reason: "It is directly connected." },
        ],
        summary: "The consumer is directly connected to the changed function.",
        uncertainty: [],
      }),
    ]);
    const agent = new InvestigationAgent(llm, fakeTools());

    const result = await agent.run({ ...scope, question: "What could break if run changes?" });

    expect(result.toolCalls).toBe(3);
    expect(result.turns).toBe(4);
    expect(result.trace.map((step) => step.kind)).toEqual([
      "question",
      "tool_call",
      "tool_result",
      "tool_call",
      "tool_result",
      "tool_call",
      "tool_result",
      "final",
    ]);
    expect(result.trace[2]).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({ resultCount: 1 }),
        status: "succeeded",
        toolName: "find_entities",
      }),
    );
    expect(result.report.findings[0]).toEqual(
      expect.objectContaining({
        entity: affected,
        evidencePaths: [evidencePath],
        sourceLocations: [affected],
      }),
    );
    expect(
      llm.requests[1]?.contents.some((content) =>
        content.parts.some((part) => "functionResponse" in part),
      ),
    ).toBe(true);
    expect(llm.requests[0]?.tools?.[0]?.functionDeclarations.map(({ name }) => name)).toContain(
      "get_evidence_path",
    );
  });

  it("rejects a model finding that has no retrieved evidence", async () => {
    const llm = new FakeLlm([
      functionCall("find_entities", { query: "run" }, "call-1"),
      finalResponse({
        checklist: [],
        findings: [{ entityId: "entity-root", priority: "medium", reason: "Unsupported claim." }],
        summary: "Unsupported.",
        uncertainty: ["No relationship evidence was found."],
      }),
    ]);
    const agent = new InvestigationAgent(llm, fakeTools());

    await expect(
      agent.run({ ...scope, question: "What is affected?" }),
    ).rejects.toMatchObject<InvestigationAgentError>({
      code: "FINAL_RESPONSE_MISSING_EVIDENCE",
      trace: expect.arrayContaining([
        expect.objectContaining({ kind: "question" }),
        expect.objectContaining({ kind: "tool_result", status: "succeeded" }),
      ]),
    });
  });
});
