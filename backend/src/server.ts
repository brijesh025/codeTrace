import "dotenv/config";

import { createGraphCommandClient, GraphStore, InvestigationTools } from "@codetrace/worker";

import { InvestigationAgent } from "./agent.js";
import { buildApp } from "./app.js";
import { loadBackendConfig } from "./config.js";
import { createGraphHealthClient } from "./graph-health.js";
import { IndexJobManager } from "./indexing.js";
import { createInvestigationPersistence } from "./investigation-persistence.js";
import { createInvestigationStore } from "./investigations.js";
import { RepositoryMemoryStore } from "./memory.js";
import { createModelRegistry } from "./models.js";

const config = loadBackendConfig();
const indexingService = new IndexJobManager({ falkordbUrl: config.FALKORDB_URL });
const investigationGraph = new GraphStore({
  client: createGraphCommandClient(config.FALKORDB_URL),
});
const modelRegistry = createModelRegistry(config);
const investigationTools = new InvestigationTools(investigationGraph);
const memoryStore = new RepositoryMemoryStore(investigationGraph);
const investigationStore = createInvestigationStore({
  close: () => investigationGraph.close(),
  getRevision: (userId, repositoryId) => indexingService.getLatestRevision(userId, repositoryId),
  hasRepository: (userId, repositoryId) => indexingService.hasRepository(userId, repositoryId),
  memoryStore,
  persistence: createInvestigationPersistence(investigationGraph),
  run: async (input) => {
    const investigationAgent = new InvestigationAgent(
      modelRegistry.createClient(input.modelId),
      investigationTools,
    );
    return investigationAgent.run(input);
  },
});
const app = buildApp({
  authInternalSecret: config.AUTH_INTERNAL_SECRET,
  graphHealthClient: createGraphHealthClient(config.FALKORDB_URL),
  indexingService,
  modelRegistry,
  investigationStore,
});

const close = async () => {
  await app.close();
  process.exit(0);
};

process.once("SIGINT", close);
process.once("SIGTERM", close);

await investigationStore.ready?.();

await app.listen({
  host: config.BACKEND_HOST,
  port: config.BACKEND_PORT,
});
