import { z } from "zod";

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

import type { LlmClient, LlmContent, LlmFunctionCall, LlmGenerateRequest } from "./llm.js";
import { memoryContext, type RepositoryInvestigationMemory } from "./memory.js";

const MAX_AGENT_TURNS = 4;
const MAX_TOOL_CALLS = 8;
const MAX_TOOL_RESULT_CHARS = 12_000;

const toolNameSchema = z.enum([
  "find_entities",
  "find_dependencies",
  "find_callers",
  "traverse_relationships",
  "get_evidence_path",
  "get_source_locations",
]);

const toolInputSchemas = {
  find_callers: z
    .object({
      entityId: z.string().min(1).max(300),
      limit: z.number().int().min(1).max(50).optional(),
      maxDepth: z.number().int().min(1).max(4).optional(),
    })
    .strict(),
  find_dependencies: z
    .object({
      entityId: z.string().min(1).max(300),
      limit: z.number().int().min(1).max(50).optional(),
      maxDepth: z.number().int().min(1).max(4).optional(),
    })
    .strict(),
  find_entities: z
    .object({
      limit: z.number().int().min(1).max(50).optional(),
      query: z.string().min(1).max(200),
    })
    .strict(),
  get_evidence_path: z
    .object({
      fromEntityId: z.string().min(1).max(300),
      limit: z.number().int().min(1).max(50).optional(),
      maxDepth: z.number().int().min(1).max(4).optional(),
      toEntityId: z.string().min(1).max(300),
    })
    .strict(),
  get_source_locations: z
    .object({
      entityIds: z.array(z.string().min(1).max(300)).min(1).max(50),
      limit: z.number().int().min(1).max(50).optional(),
    })
    .strict(),
  traverse_relationships: z
    .object({
      direction: z.enum(["incoming", "outgoing", "both"]).optional(),
      entityId: z.string().min(1).max(300),
      limit: z.number().int().min(1).max(50).optional(),
      maxDepth: z.number().int().min(1).max(4).optional(),
    })
    .strict(),
};

type ToolResult = InvestigationResult | EvidencePathResult | SourceLocationResult;

export interface InvestigationAgentInput {
  commitSha: string;
  modelId?: string;
  priorMemories?: RepositoryInvestigationMemory[];
  question: string;
  repositoryId: string;
}

export interface InvestigationFinding {
  entity: InvestigationEntity;
  evidencePaths: InvestigationResult["results"][number]["evidencePaths"];
  priority: "high" | "low" | "medium";
  reason: string;
  sourceLocations: InvestigationEntity[];
}

export interface InvestigationReport {
  checklist: string[];
  findings: InvestigationFinding[];
  summary: string;
  uncertainty: string[];
}

export interface InvestigationTraceResult {
  entityIds?: string[];
  error?: string;
  findingEntityIds?: string[];
  locationCount?: number;
  pathCount?: number;
  resultCount?: number;
  truncated?: boolean;
}

export interface InvestigationTraceStep {
  arguments?: Record<string, unknown>;
  id: string;
  kind: "final" | "question" | "tool_call" | "tool_result";
  result?: InvestigationTraceResult;
  status?: "failed" | "requested" | "succeeded" | "validated";
  summary: string;
  toolName?: string;
  turn: number;
}

export interface InvestigationAgentResult {
  report: InvestigationReport;
  trace: InvestigationTraceStep[];
  toolCalls: number;
  turns: number;
}

export class InvestigationAgentError extends Error {
  public trace: InvestigationTraceStep[] = [];

  constructor(
    message: string,
    public readonly code:
      | "FINAL_RESPONSE_INVALID"
      | "FINAL_RESPONSE_MISSING_EVIDENCE"
      | "TOOL_ARGUMENTS_INVALID"
      | "TOOL_NOT_ALLOWED"
      | "TOOL_LIMIT_EXCEEDED",
  ) {
    super(message);
    this.name = "InvestigationAgentError";
  }
}

export const investigationToolDeclarations: NonNullable<LlmGenerateRequest["tools"]> = [
  {
    functionDeclarations: [
      {
        description: "Find indexed code entities by name or source path.",
        name: "find_entities",
        parameters: {
          properties: {
            limit: { description: "Maximum results, from 1 to 50.", type: "integer" },
            query: { description: "Entity name or path text to search for.", type: "string" },
          },
          required: ["query"],
          type: "object",
        },
      },
      {
        description: "Find bounded outgoing imports and calls from an entity.",
        name: "find_dependencies",
        parameters: {
          properties: {
            entityId: { type: "string" },
            limit: { type: "integer" },
            maxDepth: { type: "integer" },
          },
          required: ["entityId"],
          type: "object",
        },
      },
      {
        description: "Find bounded incoming CALLS relationships for an entity.",
        name: "find_callers",
        parameters: {
          properties: {
            entityId: { type: "string" },
            limit: { type: "integer" },
            maxDepth: { type: "integer" },
          },
          required: ["entityId"],
          type: "object",
        },
      },
      {
        description: "Traverse bounded indexed relationships in a selected direction.",
        name: "traverse_relationships",
        parameters: {
          properties: {
            direction: { enum: ["incoming", "outgoing", "both"], type: "string" },
            entityId: { type: "string" },
            limit: { type: "integer" },
            maxDepth: { type: "integer" },
          },
          required: ["entityId"],
          type: "object",
        },
      },
      {
        description: "Retrieve bounded graph evidence paths between two indexed entities.",
        name: "get_evidence_path",
        parameters: {
          properties: {
            fromEntityId: { type: "string" },
            limit: { type: "integer" },
            maxDepth: { type: "integer" },
            toEntityId: { type: "string" },
          },
          required: ["fromEntityId", "toEntityId"],
          type: "object",
        },
      },
      {
        description: "Retrieve source paths and line ranges for indexed entity IDs.",
        name: "get_source_locations",
        parameters: {
          properties: {
            entityIds: { items: { type: "string" }, type: "array" },
            limit: { type: "integer" },
          },
          required: ["entityIds"],
          type: "object",
        },
      },
    ],
  },
];

const finalResponseSchema = z
  .object({
    checklist: z.array(z.string().min(1).max(500)).max(10),
    findings: z
      .array(
        z
          .object({
            entityId: z.string().min(1).max(300),
            priority: z.enum(["high", "medium", "low"]),
            reason: z.string().min(1).max(2_000),
          })
          .strict(),
      )
      .max(20),
    summary: z.string().min(1).max(5_000),
    uncertainty: z.array(z.string().min(1).max(500)).max(10),
  })
  .strict();

const SYSTEM_PROMPT = `You are CodeTrace, an evidence-bound codebase investigation agent.
Use only the declared investigation tools. The repository and commit scope are fixed by the server and must not be requested from the user or changed.
Never invent entity IDs, paths, line numbers, relationship paths, or confidence values.
Use tools to retrieve graph evidence before making findings. A substantive finding must use an entity ID returned by a tool and have a retrieved evidence path.
Prior repository memory is a hint for investigation direction only. It may come from an older commit and is never evidence by itself; verify relevant claims with the current graph tools.
After gathering enough evidence, respond with JSON only using this shape:
{"summary":"...","findings":[{"entityId":"...","priority":"high|medium|low","reason":"..."}],"checklist":["..."],"uncertainty":["..."]}
Do not include evidence paths in your JSON; the server attaches verified evidence to each finding.
If graph coverage is insufficient, return no unsupported finding and explain the limitation in uncertainty.`;

function extractJson(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new InvestigationAgentError(
      "The model did not return a JSON investigation report.",
      "FINAL_RESPONSE_INVALID",
    );
  }
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    throw new InvestigationAgentError(
      "The model returned malformed investigation JSON.",
      "FINAL_RESPONSE_INVALID",
    );
  }
}

function contentForModel(response: { content?: LlmContent; text: string }): LlmContent {
  return response.content ?? { parts: [{ text: response.text }], role: "model" };
}

function compactToolResult(result: unknown): unknown {
  const serialized = JSON.stringify(result);
  if (serialized.length <= MAX_TOOL_RESULT_CHARS) {
    return result;
  }

  if (typeof result === "object" && result !== null && !Array.isArray(result)) {
    const compact = { ...(result as Record<string, unknown>) };
    for (const key of ["results", "paths", "locations"]) {
      if (Array.isArray(compact[key])) {
        compact[key] = compact[key].slice(0, 8);
      }
    }
    const compactSerialized = JSON.stringify(compact);
    if (compactSerialized.length <= MAX_TOOL_RESULT_CHARS) {
      return compact;
    }
  }

  return {
    truncatedForModel: true,
    resultPreview: serialized.slice(0, MAX_TOOL_RESULT_CHARS),
  };
}

export class InvestigationAgent {
  constructor(
    private readonly llm: LlmClient,
    private readonly tools: Pick<
      WorkerInvestigationTools,
      | "find_callers"
      | "find_dependencies"
      | "find_entities"
      | "get_evidence_path"
      | "get_source_locations"
      | "traverse_relationships"
    >,
  ) {}

  async run(input: InvestigationAgentInput): Promise<InvestigationAgentResult> {
    const trace: InvestigationTraceStep[] = [
      {
        id: "trace-1",
        kind: "question",
        status: "requested",
        summary: input.priorMemories?.length
          ? `Question submitted with ${input.priorMemories.length} prior repository memor${
              input.priorMemories.length === 1 ? "y" : "ies"
            } available for verification.`
          : "Question submitted to the evidence-bound agent.",
        turn: 0,
      },
    ];

    try {
      return await this.runWithTrace(input, trace);
    } catch (error) {
      if (error instanceof InvestigationAgentError) {
        error.trace = trace;
      }
      throw error;
    }
  }

  private async runWithTrace(
    input: InvestigationAgentInput,
    trace: InvestigationTraceStep[],
  ): Promise<InvestigationAgentResult> {
    const contents: LlmContent[] = [
      {
        parts: [
          {
            text: `Repository: ${input.repositoryId}\nCommit: ${input.commitSha}\nQuestion: ${input.question}${
              input.priorMemories?.length
                ? `\nPrior repository memory (verify before relying on it): ${memoryContext(input.priorMemories)}`
                : ""
            }`,
          },
        ],
        role: "user",
      },
    ];
    const entities = new Map<string, InvestigationEntity>();
    const evidencePaths = new Map<
      string,
      InvestigationResult["results"][number]["evidencePaths"]
    >();
    const sourceLocations = new Map<string, InvestigationEntity[]>();
    const toolErrors: string[] = [];
    let toolCalls = 0;

    for (let turn = 1; turn <= MAX_AGENT_TURNS; turn += 1) {
      const response = await this.llm.generate({
        contents,
        generationConfig: { temperature: 0.1 },
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        toolConfig: { functionCallingConfig: { mode: "AUTO" } },
        tools: investigationToolDeclarations,
      });
      contents.push(contentForModel(response));

      if (response.functionCalls.length > 0) {
        if (toolCalls + response.functionCalls.length > MAX_TOOL_CALLS) {
          throw new InvestigationAgentError(
            "The investigation exceeded its tool-call limit.",
            "TOOL_LIMIT_EXCEEDED",
          );
        }

        const functionResponses = [];
        for (const call of response.functionCalls) {
          toolCalls += 1;
          trace.push({
            arguments: traceArguments(call.args),
            id: `trace-${trace.length + 1}`,
            kind: "tool_call",
            status: "requested",
            summary: `Agent requested the ${call.name} graph tool.`,
            toolName: call.name,
            turn,
          });
          const result = await this.executeTool(call, input);
          if ("error" in result) {
            toolErrors.push(result.error);
          } else {
            this.catalogResult(result, entities, evidencePaths, sourceLocations);
          }
          trace.push({
            id: `trace-${trace.length + 1}`,
            kind: "tool_result",
            result: summarizeToolResult(result),
            status: "error" in result ? "failed" : "succeeded",
            summary:
              "error" in result
                ? `${call.name} failed: ${result.error}`
                : summarizeToolResultText(call.name, result),
            toolName: call.name,
            turn,
          });
          functionResponses.push({
            functionResponse: {
              id: call.id,
              name: call.name,
              response: { result: compactToolResult(result) },
            },
          });
        }
        contents.push({ parts: functionResponses, role: "user" });
        continue;
      }

      const parsed = finalResponseSchema.safeParse(extractJson(response.text));
      if (!parsed.success) {
        throw new InvestigationAgentError(
          "The model report failed final schema validation.",
          "FINAL_RESPONSE_INVALID",
        );
      }
      const findings: InvestigationFinding[] = [];
      for (const finding of parsed.data.findings) {
        const entity = entities.get(finding.entityId);
        const paths = evidencePaths.get(finding.entityId) ?? [];
        if (!entity || paths.length === 0) {
          throw new InvestigationAgentError(
            `Finding ${finding.entityId} has no retrieved graph evidence.`,
            "FINAL_RESPONSE_MISSING_EVIDENCE",
          );
        }
        findings.push({
          entity,
          evidencePaths: paths,
          priority: finding.priority,
          reason: finding.reason,
          sourceLocations: sourceLocations.get(finding.entityId) ?? [],
        });
      }

      const uncertainty = [...parsed.data.uncertainty];
      if (toolErrors.length > 0) {
        uncertainty.push(`Some investigation tools failed: ${toolErrors.join("; ")}`);
      }
      const report = { ...parsed.data, findings, uncertainty: [...new Set(uncertainty)] };
      trace.push({
        id: `trace-${trace.length + 1}`,
        kind: "final",
        result: {
          findingEntityIds: findings.map((finding) => finding.entity.id),
          resultCount: findings.length,
        },
        status: "validated",
        summary: `Validated ${findings.length} finding${findings.length === 1 ? "" : "s"} against retrieved graph evidence.`,
        turn,
      });
      return { report, trace, toolCalls, turns: turn };
    }

    contents.push({
      parts: [
        {
          text: "Stop using tools and return the final investigation JSON now. Use only evidence already retrieved.",
        },
      ],
      role: "user",
    });
    const finalResponse = await this.llm.generate({
      contents,
      generationConfig: { temperature: 0.1 },
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      toolConfig: { functionCallingConfig: { mode: "NONE" } },
    });
    const parsed = finalResponseSchema.safeParse(extractJson(finalResponse.text));
    if (!parsed.success) {
      throw new InvestigationAgentError(
        "The model did not produce a final investigation report.",
        "FINAL_RESPONSE_INVALID",
      );
    }
    const findings: InvestigationFinding[] = [];
    for (const finding of parsed.data.findings) {
      const entity = entities.get(finding.entityId);
      const paths = evidencePaths.get(finding.entityId) ?? [];
      if (!entity || paths.length === 0) {
        throw new InvestigationAgentError(
          `Finding ${finding.entityId} has no retrieved graph evidence.`,
          "FINAL_RESPONSE_MISSING_EVIDENCE",
        );
      }
      findings.push({
        entity,
        evidencePaths: paths,
        priority: finding.priority,
        reason: finding.reason,
        sourceLocations: sourceLocations.get(finding.entityId) ?? [],
      });
    }
    const report = {
      ...parsed.data,
      findings,
      uncertainty: [...new Set([...parsed.data.uncertainty, ...toolErrors])],
    };
    trace.push({
      id: `trace-${trace.length + 1}`,
      kind: "final",
      result: {
        findingEntityIds: findings.map((finding) => finding.entity.id),
        resultCount: findings.length,
      },
      status: "validated",
      summary: `Validated ${findings.length} finding${findings.length === 1 ? "" : "s"} after the tool-call limit was reached.`,
      turn: MAX_AGENT_TURNS + 1,
    });
    return { report, trace, toolCalls, turns: MAX_AGENT_TURNS + 1 };
  }

  private async executeTool(
    call: LlmFunctionCall,
    input: InvestigationAgentInput,
  ): Promise<ToolResult | { error: string }> {
    const parsedName = toolNameSchema.safeParse(call.name);
    if (!parsedName.success) {
      return { error: `Tool ${call.name} is not allowed.` };
    }
    const name = parsedName.data;
    const parsedArguments = toolInputSchemas[name].safeParse(call.args);
    if (!parsedArguments.success) {
      return { error: `Invalid arguments for ${name}.` };
    }

    try {
      const scope = { commitSha: input.commitSha, repositoryId: input.repositoryId };
      switch (name) {
        case "find_entities":
          return await this.tools.find_entities({
            ...scope,
            ...parsedArguments.data,
          } as FindEntitiesInput);
        case "find_dependencies":
          return await this.tools.find_dependencies({
            ...scope,
            ...parsedArguments.data,
          } as DependencyInput);
        case "find_callers":
          return await this.tools.find_callers({
            ...scope,
            ...parsedArguments.data,
          } as CallerInput);
        case "traverse_relationships":
          return await this.tools.traverse_relationships({
            ...scope,
            ...parsedArguments.data,
          } as RelationshipTraversalInput);
        case "get_evidence_path":
          return await this.tools.get_evidence_path({
            ...scope,
            ...parsedArguments.data,
          } as EvidencePathInput);
        case "get_source_locations":
          return await this.tools.get_source_locations({
            ...scope,
            ...parsedArguments.data,
          } as SourceLocationInput);
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : `Tool ${name} failed.` };
    }
  }

  private catalogResult(
    result: ToolResult,
    entities: Map<string, InvestigationEntity>,
    evidencePaths: Map<string, InvestigationResult["results"][number]["evidencePaths"]>,
    sourceLocations: Map<string, InvestigationEntity[]>,
  ): void {
    if ("results" in result) {
      for (const ranked of result.results) {
        entities.set(ranked.id, ranked);
        if (ranked.evidencePaths.length > 0) {
          evidencePaths.set(ranked.id, [
            ...(evidencePaths.get(ranked.id) ?? []),
            ...ranked.evidencePaths,
          ]);
        }
      }
    }
    if ("paths" in result) {
      for (const path of result.paths) {
        const entity = path.entities.at(-1);
        if (entity) {
          entities.set(entity.id, entity);
          evidencePaths.set(entity.id, [...(evidencePaths.get(entity.id) ?? []), path]);
        }
      }
    }
    if ("locations" in result) {
      for (const location of result.locations) {
        entities.set(location.id, location);
        sourceLocations.set(location.id, [...(sourceLocations.get(location.id) ?? []), location]);
      }
    }
  }
}

function summarizeToolResult(result: ToolResult | { error: string }): InvestigationTraceResult {
  if ("error" in result) {
    return { error: result.error };
  }
  if ("results" in result) {
    return {
      entityIds: result.results.slice(0, 8).map((entity) => entity.id),
      resultCount: result.results.length,
      truncated: result.truncated,
    };
  }
  if ("paths" in result) {
    return {
      entityIds: [
        ...new Set(result.paths.flatMap((path) => path.entities.map((entity) => entity.id))),
      ].slice(0, 8),
      pathCount: result.paths.length,
      truncated: result.truncated,
    };
  }
  return {
    entityIds: result.locations.slice(0, 8).map((location) => location.id),
    locationCount: result.locations.length,
    truncated: result.truncated,
  };
}

function traceArguments(args: Record<string, unknown>): Record<string, unknown> {
  const serialized = JSON.stringify(args);
  if (serialized.length <= 2_000) {
    return args;
  }
  return {
    truncated: true,
    preview: serialized.slice(0, 2_000),
  };
}

function summarizeToolResultText(toolName: string, result: ToolResult): string {
  const summary = summarizeToolResult(result);
  if (summary.resultCount !== undefined) {
    return `${toolName} returned ${summary.resultCount} graph result${summary.resultCount === 1 ? "" : "s"}.`;
  }
  if (summary.pathCount !== undefined) {
    return `${toolName} retrieved ${summary.pathCount} evidence path${summary.pathCount === 1 ? "" : "s"}.`;
  }
  return `${toolName} retrieved ${summary.locationCount ?? 0} source location${summary.locationCount === 1 ? "" : "s"}.`;
}
