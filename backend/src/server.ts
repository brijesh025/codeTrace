import "dotenv/config";

import { createGraphCommandClient, GraphStore, InvestigationTools } from "@codetrace/worker";

import { InvestigationAgent } from "./agent.js";
import { buildApp } from "./app.js";
import { loadBackendConfig } from "./config.js";
import { createGraphHealthClient } from "./graph-health.js";
import { IndexJobManager } from "./indexing.js";
import { createInvestigationStore } from "./investigations.js";
import { createModelRegistry } from "./models.js";

const config = loadBackendConfig();
const indexingService = new IndexJobManager({ falkordbUrl: config.FALKORDB_URL });
const investigationGraph = new GraphStore({
  client: createGraphCommandClient(config.FALKORDB_URL),
});
const modelRegistry = createModelRegistry(config);
const investigationTools = new InvestigationTools(investigationGraph);
const app = buildApp({
  authInternalSecret: config.AUTH_INTERNAL_SECRET,
  graphHealthClient: createGraphHealthClient(config.FALKORDB_URL),
  indexingService,
  modelRegistry,
  investigationStore: createInvestigationStore({
    close: () => investigationGraph.close(),
    getRevision: (userId, repositoryId) => indexingService.getLatestRevision(userId, repositoryId),
    hasRepository: (userId, repositoryId) => indexingService.hasRepository(userId, repositoryId),
    run: async (input) => {
      const investigationAgent = new InvestigationAgent(
        modelRegistry.createClient(input.modelId),
        investigationTools,
      );
      return investigationAgent.run(input);
    },
  }),
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
