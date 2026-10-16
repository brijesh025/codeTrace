import "dotenv/config";

import { buildApp } from "./app.js";
import { loadBackendConfig } from "./config.js";
import { createGraphHealthClient } from "./graph-health.js";
import { IndexJobManager } from "./indexing.js";
import { createInvestigationStore } from "./investigations.js";

const config = loadBackendConfig();
const indexingService = new IndexJobManager({ falkordbUrl: config.FALKORDB_URL });
const app = buildApp({
  authInternalSecret: config.AUTH_INTERNAL_SECRET,
  graphHealthClient: createGraphHealthClient(config.FALKORDB_URL),
  indexingService,
  investigationStore: createInvestigationStore((userId, repositoryId) =>
    indexingService.hasRepository(userId, repositoryId),
  ),
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
