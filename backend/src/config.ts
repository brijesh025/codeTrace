import { z } from "zod";

const environmentSchema = z.object({
  BACKEND_HOST: z.string().default("127.0.0.1"),
  BACKEND_PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  FALKORDB_URL: z.url().default("redis://127.0.0.1:6379"),
  AUTH_INTERNAL_SECRET: z.string().min(32).optional(),
});

export type BackendConfig = z.infer<typeof environmentSchema>;

export function loadBackendConfig(environment: NodeJS.ProcessEnv = process.env): BackendConfig {
  return environmentSchema.parse(environment);
}
