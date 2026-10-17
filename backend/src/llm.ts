export interface LlmContent {
  parts: Array<Record<string, unknown>>;
  role: "model" | "user";
}

export interface LlmFunctionCall {
  args: Record<string, unknown>;
  id?: string;
  name: string;
}

export interface LlmGenerateRequest {
  contents: LlmContent[];
  generationConfig?: {
    temperature?: number;
  };
  systemInstruction?: {
    parts: Array<{ text: string }>;
  };
  toolConfig?: {
    functionCallingConfig: {
      allowedFunctionNames?: string[];
      mode: "AUTO" | "ANY" | "NONE";
    };
  };
  tools?: Array<{
    functionDeclarations: Array<{
      description: string;
      name: string;
      parameters: Record<string, unknown>;
    }>;
  }>;
}

export interface LlmGenerateResponse {
  content?: LlmContent;
  functionCalls: LlmFunctionCall[];
  text: string;
}

export interface LlmClient {
  generate(request: LlmGenerateRequest): Promise<LlmGenerateResponse>;
}

export class LlmClientError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "LLM_BAD_RESPONSE"
      | "LLM_CONFIGURATION"
      | "LLM_REQUEST_FAILED"
      | "LLM_TIMEOUT",
    public readonly status?: number,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "LlmClientError";
  }
}

export interface GeminiClientOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  model?: string;
  retryDelayMs?: number;
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFunctionCalls(content: LlmContent | undefined): LlmFunctionCall[] {
  if (!content) {
    return [];
  }

  return content.parts.flatMap((part) => {
    const functionCall = part.functionCall;
    if (!isRecord(functionCall) || typeof functionCall.name !== "string") {
      return [];
    }

    return [
      {
        ...(typeof functionCall.id === "string" ? { id: functionCall.id } : {}),
        args: isRecord(functionCall.args) ? functionCall.args : {},
        name: functionCall.name,
      },
    ];
  });
}

function parseContent(payload: unknown): LlmContent | undefined {
  if (!isRecord(payload) || !isRecord(payload.content) || !Array.isArray(payload.content.parts)) {
    return undefined;
  }

  const parts = payload.content.parts.filter(isRecord);
  if (parts.length === 0) {
    return undefined;
  }

  return {
    parts,
    role: payload.content.role === "user" ? "user" : "model",
  };
}

function parseText(content: LlmContent | undefined): string {
  return (
    content?.parts
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n") ?? ""
  );
}

function providerMessage(payload: unknown, status: number): string {
  return isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string"
    ? payload.error.message
    : `LLM request failed with status ${status}.`;
}

function retryAfterMilliseconds(response: Response, message: string): number | undefined {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) {
      return Math.max(0, Math.round(seconds * 1_000));
    }
  }

  const bodyMatch = message.match(/retry in ([\d.]+)s/i);
  return bodyMatch?.[1] ? Math.max(0, Math.round(Number(bodyMatch[1]) * 1_000)) : undefined;
}

async function responsePayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export function createGeminiClient({
  apiKey,
  fetchImpl = fetch,
  maxRetries = 2,
  model = "gemini-3.8-flash",
  retryDelayMs = 250,
  timeoutMs = 30_000,
}: GeminiClientOptions = {}): LlmClient {
  const normalizedModel = model.replace(/^models\//, "");

  return {
    async generate(request) {
      if (!apiKey) {
        throw new LlmClientError(
          "The selected provider API key is not configured.",
          "LLM_CONFIGURATION",
        );
      }

      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const response = await fetchImpl(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(normalizedModel)}:generateContent`,
            {
              body: JSON.stringify(request),
              headers: {
                "content-type": "application/json",
                "x-goog-api-key": apiKey,
              },
              method: "POST",
              signal: controller.signal,
            },
          );
          const payload = await responsePayload(response);

          if (!response.ok) {
            const message = providerMessage(payload, response.status);
            const providerError = new LlmClientError(
              message,
              "LLM_REQUEST_FAILED",
              response.status,
              retryAfterMilliseconds(response, message),
            );
            throw providerError;
          }

          if (!isRecord(payload) || !Array.isArray(payload.candidates)) {
            throw new LlmClientError("Gemini returned an invalid response.", "LLM_BAD_RESPONSE");
          }

          const content = parseContent(payload.candidates[0]);
          return {
            ...(content ? { content } : {}),
            functionCalls: parseFunctionCalls(content),
            text: parseText(content),
          };
        } catch (error) {
          if (error instanceof LlmClientError) {
            if (
              attempt < maxRetries &&
              error.status !== undefined &&
              isRetryableStatus(error.status)
            ) {
              await delay(retryDelayMs * 2 ** attempt);
              continue;
            }
            throw error;
          }
          if (error instanceof DOMException && error.name === "AbortError") {
            throw new LlmClientError("Gemini request timed out.", "LLM_TIMEOUT");
          }
          throw new LlmClientError(
            error instanceof Error ? error.message : "Gemini request failed.",
            "LLM_REQUEST_FAILED",
          );
        } finally {
          clearTimeout(timeout);
        }
      }

      throw new LlmClientError("Gemini request failed after retries.", "LLM_REQUEST_FAILED");
    },
  };
}

function isRetryableStatus(status: number): boolean {
  return status === 500 || status === 502 || status === 503 || status === 504;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export interface OpenAiCompatibleClientOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  model?: string;
  retryDelayMs?: number;
  timeoutMs?: number;
}

function textFromPart(part: Record<string, unknown>): string {
  return typeof part.text === "string" ? part.text : "";
}

function openAiMessages(request: LlmGenerateRequest): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = [];
  const systemText = request.systemInstruction?.parts.map((part) => part.text).join("\n");
  if (systemText) {
    messages.push({ content: systemText, role: "system" });
  }

  for (const content of request.contents) {
    const functionCalls = content.parts.filter((part) => isRecord(part.functionCall));
    const functionResponses = content.parts.filter((part) => isRecord(part.functionResponse));
    const text = content.parts.map(textFromPart).filter(Boolean).join("\n");

    if (functionCalls.length > 0) {
      messages.push({
        ...(text ? { content: text } : { content: null }),
        role: "assistant",
        tool_calls: functionCalls.map((part, index) => {
          const call = part.functionCall as Record<string, unknown>;
          return {
            function: {
              arguments: JSON.stringify(isRecord(call.args) ? call.args : {}),
              name: typeof call.name === "string" ? call.name : "unknown",
            },
            id: typeof call.id === "string" ? call.id : `call_${index}`,
            type: "function",
          };
        }),
      });
    } else if (functionResponses.length > 0) {
      for (const part of functionResponses) {
        const functionResponse = part.functionResponse as Record<string, unknown>;
        const response = isRecord(functionResponse.response) ? functionResponse.response : {};
        messages.push({
          content: JSON.stringify(response.result ?? response),
          name: typeof functionResponse.name === "string" ? functionResponse.name : undefined,
          role: "tool",
          tool_call_id:
            typeof functionResponse.id === "string" ? functionResponse.id : "unknown_call",
        });
      }
    } else {
      messages.push({ content: text, role: content.role === "model" ? "assistant" : "user" });
    }
  }
  return messages;
}

function openAiTools(request: LlmGenerateRequest): Array<Record<string, unknown>> | undefined {
  return request.tools?.flatMap((tool) =>
    tool.functionDeclarations.map((declaration) => ({
      function: declaration,
      type: "function",
    })),
  );
}

function parseOpenAiResponse(payload: unknown): LlmGenerateResponse {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || !isRecord(payload.choices[0])) {
    throw new LlmClientError("LLM returned an invalid response.", "LLM_BAD_RESPONSE");
  }

  const message = isRecord(payload.choices[0].message) ? payload.choices[0].message : {};
  const functionCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls.flatMap((toolCall) => {
        if (!isRecord(toolCall) || !isRecord(toolCall.function)) {
          return [];
        }
        const functionPart = toolCall.function;
        const argumentsText =
          typeof functionPart.arguments === "string" ? functionPart.arguments : "{}";
        let args: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(argumentsText);
          if (isRecord(parsed)) {
            args = parsed;
          }
        } catch {
          args = {};
        }
        if (typeof functionPart.name !== "string") {
          return [];
        }
        return [
          {
            ...(typeof toolCall.id === "string" ? { id: toolCall.id } : {}),
            args,
            name: functionPart.name,
          },
        ];
      })
    : [];
  const text =
    typeof message.content === "string"
      ? message.content
      : Array.isArray(message.content)
        ? message.content
            .filter(isRecord)
            .map((part) => (typeof part.text === "string" ? part.text : ""))
            .filter(Boolean)
            .join("\n")
        : "";

  return {
    content: {
      parts: [
        ...(text ? [{ text }] : []),
        ...functionCalls.map((call) => ({
          functionCall: { args: call.args, ...(call.id ? { id: call.id } : {}), name: call.name },
        })),
      ],
      role: "model",
    },
    functionCalls,
    text,
  };
}

export function createOpenAiCompatibleClient({
  apiKey,
  baseUrl = "https://api.groq.com/openai/v1/chat/completions",
  fetchImpl = fetch,
  maxRetries = 2,
  model = "openai/gpt-oss-20b",
  retryDelayMs = 250,
  timeoutMs = 30_000,
}: OpenAiCompatibleClientOptions = {}): LlmClient {
  return {
    async generate(request) {
      if (!apiKey) {
        throw new LlmClientError(
          "The selected provider API key is not configured.",
          "LLM_CONFIGURATION",
        );
      }

      const body = {
        ...(request.generationConfig?.temperature !== undefined
          ? { temperature: request.generationConfig.temperature }
          : {}),
        ...(openAiTools(request) ? { tools: openAiTools(request) } : {}),
        messages: openAiMessages(request),
        model,
        tool_choice: request.toolConfig?.functionCallingConfig.mode === "NONE" ? "none" : "auto",
      };

      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetchImpl(baseUrl, {
            body: JSON.stringify(body),
            headers: {
              authorization: `Bearer ${apiKey}`,
              "content-type": "application/json",
            },
            method: "POST",
            signal: controller.signal,
          });
          const payload = await responsePayload(response);
          if (!response.ok) {
            const message = providerMessage(payload, response.status);
            throw new LlmClientError(
              message,
              "LLM_REQUEST_FAILED",
              response.status,
              retryAfterMilliseconds(response, message),
            );
          }
          return parseOpenAiResponse(payload);
        } catch (error) {
          if (error instanceof LlmClientError) {
            if (
              attempt < maxRetries &&
              error.status !== undefined &&
              isRetryableStatus(error.status)
            ) {
              await delay(retryDelayMs * 2 ** attempt);
              continue;
            }
            throw error;
          }
          if (error instanceof DOMException && error.name === "AbortError") {
            throw new LlmClientError("LLM request timed out.", "LLM_TIMEOUT");
          }
          throw new LlmClientError(
            error instanceof Error ? error.message : "LLM request failed.",
            "LLM_REQUEST_FAILED",
          );
        } finally {
          clearTimeout(timeout);
        }
      }

      throw new LlmClientError("LLM request failed after retries.", "LLM_REQUEST_FAILED");
    },
  };
}
