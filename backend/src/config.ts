import { z } from "zod";

const environmentSchema = z.object({
  BACKEND_HOST: z.string().default("127.0.0.1"),
  BACKEND_PORT: z.coerce.number().int().min(1).max(65535).default(5001),
  FALKORDB_URL: z.url().default("redis://127.0.0.1:6379"),
  AUTH_INTERNAL_SECRET: z.string().min(32).optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GROQ_API_KEY: z.string().min(1).optional(),
  CLOUDFLARE_ACCOUNT_ID: z.string().min(1).optional(),
  CLOUDFLARE_API_TOKEN: z.string().min(1).optional(),
  CLOUDFLARE_MODEL: z.string().min(1).default("@cf/openai/gpt-oss-20b"),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
});

export type BackendConfig = z.infer<typeof environmentSchema>;

export function loadBackendConfig(environment: NodeJS.ProcessEnv = process.env): BackendConfig {
  return environmentSchema.parse(environment);
}
