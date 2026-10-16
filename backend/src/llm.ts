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
        throw new LlmClientError("LLM_API_KEY is not configured.", "LLM_CONFIGURATION");
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
            const message =
              isRecord(payload) &&
              isRecord(payload.error) &&
              typeof payload.error.message === "string"
                ? payload.error.message
                : `Gemini request failed with status ${response.status}.`;
            const providerError = new LlmClientError(
              message,
              "LLM_REQUEST_FAILED",
              response.status,
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
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
