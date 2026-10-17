import type { BackendConfig } from "./config.js";
import { createGeminiClient, createOpenAiCompatibleClient, type LlmClient } from "./llm.js";

export type LlmProvider = "gemini" | "groq";

export interface AvailableModel {
  description: string;
  id: string;
  label: string;
  provider: LlmProvider;
  recommended: boolean;
}

const modelCatalog: AvailableModel[] = [
  {
    description: "Fast Gemini model for general investigations.",
    id: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    provider: "gemini",
    recommended: false,
  },
  {
    description: "GPT-OSS through Groq with JSON and tool calling.",
    id: "openai/gpt-oss-20b",
    label: "GPT-OSS 20B · Groq",
    provider: "groq",
    recommended: true,
  },
];

function providerKey(config: BackendConfig, provider: LlmProvider): string | undefined {
  if (provider === "gemini") {
    return config.GEMINI_API_KEY;
  }
  return config.GROQ_API_KEY;
}

export class ModelSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelSelectionError";
  }
}

export class ModelRegistry {
  private readonly availableModels: AvailableModel[];

  constructor(private readonly config: BackendConfig) {
    this.availableModels = modelCatalog.filter((model) =>
      Boolean(providerKey(config, model.provider)),
    );
  }

  list(): AvailableModel[] {
    return this.availableModels.map((model) => ({ ...model }));
  }

  get defaultModel(): string | null {
    return (
      this.availableModels.find((model) => model.recommended)?.id ??
      this.availableModels[0]?.id ??
      null
    );
  }

  has(modelId: string): boolean {
    return this.availableModels.some((model) => model.id === modelId);
  }

  createClient(modelId?: string): LlmClient {
    const selectedId = modelId ?? this.defaultModel;
    const model = this.availableModels.find((candidate) => candidate.id === selectedId);
    if (!model) {
      throw new ModelSelectionError("The selected model is not configured or available.");
    }

    const apiKey = providerKey(this.config, model.provider);
    if (!apiKey) {
      throw new ModelSelectionError(`No API key is configured for ${model.provider}.`);
    }

    return model.provider === "groq"
      ? createOpenAiCompatibleClient({
          apiKey,
          model: model.id,
          timeoutMs: this.config.LLM_TIMEOUT_MS,
        })
      : createGeminiClient({ apiKey, model: model.id, timeoutMs: this.config.LLM_TIMEOUT_MS });
  }
}

export function createModelRegistry(config: BackendConfig): ModelRegistry {
  return new ModelRegistry(config);
}
