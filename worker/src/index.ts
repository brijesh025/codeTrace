export const supportedSourceExtensions = [".ts", ".tsx", ".js", ".jsx"] as const;

export type SupportedSourceExtension = (typeof supportedSourceExtensions)[number];

export type CodeEntityKind = "Repository" | "File" | "Function" | "Class" | "Module";

export interface SourceRange {
  lineStart: number;
  lineEnd: number;
}

export interface CodeEntity extends SourceRange {
  id: string;
  kind: CodeEntityKind;
  name: string;
  path: string;
}

export {
  cleanupRepositoryWorkspace,
  clonePublicRepository,
  RepositoryIngestionError,
  validatePublicGitHubUrl,
  withClonedRepository,
} from "./repository.js";
export type {
  CloneRepositoryOptions,
  CommandResult,
  CommandRunner,
  RepositoryFile,
  RepositoryLimits,
  RepositoryMetadata,
  RepositoryReference,
  RepositoryWorkspace,
} from "./repository.js";
export { extractRepository } from "./extraction.js";
export type {
  ExtractionDiagnostic,
  ExtractionEntity,
  ExtractionEntityKind,
  ExtractionFile,
  ExtractionInput,
  ExtractionRelationship,
  ExtractionResult,
} from "./extraction.js";
export { createGraphCommandClient, GraphStore } from "./graph-store.js";
export type {
  GraphCommandClient,
  GraphLoadInput,
  GraphLoadResult,
  GraphQueryResult,
  GraphStoreOptions,
} from "./graph-store.js";
export { InvestigationToolError, InvestigationTools } from "./investigation.js";
export type {
  CallerInput,
  DependencyInput,
  EvidencePath,
  EvidencePathInput,
  EvidencePathResult,
  FindEntitiesInput,
  GraphQueryClient,
  GraphScope,
  InvestigationEntity,
  InvestigationEntityKind,
  InvestigationRelationship,
  InvestigationRelationshipKind,
  InvestigationResult,
  RankedEntity,
  RankingFactors,
  RelationshipTraversalInput,
  SourceLocationInput,
  SourceLocationResult,
  TraversalDirection,
} from "./investigation.js";
