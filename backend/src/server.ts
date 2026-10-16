import "dotenv/config";

import { buildApp } from "./app.js";
import { loadBackendConfig } from "./config.js";
import { createGraphHealthClient } from "./graph-health.js";

const config = loadBackendConfig();
const app = buildApp({
  authInternalSecret: config.AUTH_INTERNAL_SECRET,
  graphHealthClient: createGraphHealthClient(config.FALKORDB_URL),
});

const close = async () => {
  await app.close();
  process.exit(0);
};

process.once("SIGINT", close);
process.once("SIGTERM", close);

await app.listen({
  host: config.BACKEND_HOST,
  port: config.BACKEND_PORT,
});
