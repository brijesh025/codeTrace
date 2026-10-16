import type { ExtractionEntityKind } from "./extraction.js";
import type { GraphQueryResult } from "./graph-store.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const DEFAULT_DEPTH = 2;
const MAX_DEPTH = 4;
const MAX_PATHS_PER_ENTITY = 3;

const ENTITY_KINDS = new Set<ExtractionEntityKind>([
  "Class",
  "File",
  "Function",
  "Module",
  "Repository",
]);

export type InvestigationEntityKind = ExtractionEntityKind | "Unknown";
export type InvestigationRelationshipKind = "CALLS" | "CONTAINS" | "IMPORTS";
export type TraversalDirection = "incoming" | "outgoing" | "both";

export interface GraphScope {
  commitSha: string;
  repositoryId: string;
}

export interface FindEntitiesInput extends GraphScope {
  limit?: number;
  query: string;
}

export interface DependencyInput extends GraphScope {
  entityId: string;
  limit?: number;
  maxDepth?: number;
}

export interface CallerInput extends GraphScope {
  entityId: string;
  limit?: number;
  maxDepth?: number;
}

export interface RelationshipTraversalInput extends GraphScope {
  direction?: TraversalDirection;
  entityId: string;
  limit?: number;
  maxDepth?: number;
}

export interface EvidencePathInput extends GraphScope {
  fromEntityId: string;
  limit?: number;
  maxDepth?: number;
  toEntityId: string;
}

export interface SourceLocationInput extends GraphScope {
  entityIds: string[];
  limit?: number;
}

export interface InvestigationEntity {
  confidence: number;
  id: string;
  kind: InvestigationEntityKind;
  lineEnd: number;
  lineStart: number;
  name: string;
  path: string;
  provenance: string;
}

export interface InvestigationRelationship {
  confidence: number;
  direction: "incoming" | "outgoing";
  fromId: string;
  graphFromId: string;
  graphToId: string;
  id: string;
  kind: InvestigationRelationshipKind;
  toId: string;
}

export interface EvidencePath {
  distance: number;
  entities: InvestigationEntity[];
  relationships: InvestigationRelationship[];
}

export interface RankingFactors {
  confidence: number;
  directEvidence: number;
  exactEntityMatch: number;
  independentPaths: number;
  relationshipDistance: number;
  sourceLocation: number;
}

export interface RankedEntity extends InvestigationEntity {
  evidencePaths: EvidencePath[];
  ranking: RankingFactors;
  score: number;
}

export interface InvestigationResult {
  results: RankedEntity[];
  scope: GraphScope;
  truncated: boolean;
}

export interface EvidencePathResult {
  paths: EvidencePath[];
  scope: GraphScope;
  truncated: boolean;
}

export interface SourceLocationResult {
  locations: InvestigationEntity[];
  scope: GraphScope;
  truncated: boolean;
}

export interface GraphQueryClient {
  query(
    query: string,
    parameters: Record<string, string | number | boolean>,
  ): Promise<GraphQueryResult>;
}

export class InvestigationToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvestigationToolError";
  }
}

interface Candidate {
  entity: InvestigationEntity;
  paths: EvidencePath[];
}

interface Hop {
  relationship: InvestigationRelationship;
  target: InvestigationEntity;
}

interface PathState {
  entity: InvestigationEntity;
  path: EvidencePath;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function entityKind(value: unknown): InvestigationEntityKind {
  const kind = stringValue(value);
  return ENTITY_KINDS.has(kind as ExtractionEntityKind)
    ? (kind as InvestigationEntityKind)
    : "Unknown";
}

function rowRecord(result: GraphQueryResult, row: unknown[]): Record<string, unknown> {
  return Object.fromEntries(result.columns.map((column, index) => [column, row[index]]));
}

function entityFromRow(row: Record<string, unknown>, prefix = ""): InvestigationEntity {
  return {
    confidence: numberValue(row[`${prefix}Confidence`], 0),
    id: stringValue(row[`${prefix}Id`]),
    kind: entityKind(row[`${prefix}Kind`]),
    lineEnd: numberValue(row[`${prefix}LineEnd`], 0),
    lineStart: numberValue(row[`${prefix}LineStart`], 0),
    name: stringValue(row[`${prefix}Name`]),
    path: stringValue(row[`${prefix}Path`]),
    provenance: stringValue(row[`${prefix}Provenance`]),
  };
}

function validateScope(input: GraphScope): GraphScope {
  const repositoryId = input.repositoryId.trim();
  const commitSha = input.commitSha.trim();
  if (!repositoryId || repositoryId.length > 200) {
    throw new InvestigationToolError("repositoryId must be between 1 and 200 characters.");
  }
  if (!/^[0-9a-f]{40}$/i.test(commitSha)) {
    throw new InvestigationToolError("commitSha must be a 40-character hexadecimal SHA.");
  }
  return { commitSha, repositoryId };
}

function boundedLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new InvestigationToolError(`limit must be an integer between 1 and ${MAX_LIMIT}.`);
  }
  return limit;
}

function boundedDepth(value: number | undefined): number {
  const depth = value ?? DEFAULT_DEPTH;
  if (!Number.isInteger(depth) || depth < 1 || depth > MAX_DEPTH) {
    throw new InvestigationToolError(`maxDepth must be an integer between 1 and ${MAX_DEPTH}.`);
  }
  return depth;
}

function requiredId(value: string, field: string): string {
  const id = value.trim();
  if (!id || id.length > 300) {
    throw new InvestigationToolError(`${field} must be between 1 and 300 characters.`);
  }
  return id;
}

function relationshipPredicate(kinds: InvestigationRelationshipKind[]): string {
  return kinds.map((kind) => `type(r) = '${kind}'`).join(" OR ");
}

function entityProjection(alias: string, prefix: string): string {
  return `
    ${alias}.id AS ${prefix}Id,
    ${alias}.kind AS ${prefix}Kind,
    ${alias}.name AS ${prefix}Name,
    ${alias}.path AS ${prefix}Path,
    ${alias}.lineStart AS ${prefix}LineStart,
    ${alias}.lineEnd AS ${prefix}LineEnd,
    ${alias}.provenance AS ${prefix}Provenance,
    ${alias}.confidence AS ${prefix}Confidence`;
}

function hopQuery(direction: "incoming" | "outgoing", predicate: string): string {
  if (direction === "outgoing") {
    return `MATCH (source)-[r]->(target)
      WHERE source.id = $entityId
        AND source.repositoryId = $repositoryId
        AND source.commitSha = $commitSha
        AND target.repositoryId = $repositoryId
        AND target.commitSha = $commitSha
        AND (${predicate})
      RETURN ${entityProjection("source", "source")},
        ${entityProjection("target", "target")},
        r.id AS relationshipId,
        type(r) AS relationshipKind,
        r.confidence AS relationshipConfidence,
        source.id AS graphFromId,
        target.id AS graphToId
      ORDER BY target.id, relationshipKind, relationshipId
      LIMIT $limit`;
  }

  return `MATCH (target)-[r]->(source)
    WHERE source.id = $entityId
      AND source.repositoryId = $repositoryId
      AND source.commitSha = $commitSha
      AND target.repositoryId = $repositoryId
      AND target.commitSha = $commitSha
      AND (${predicate})
    RETURN ${entityProjection("source", "source")},
      ${entityProjection("target", "target")},
      r.id AS relationshipId,
      type(r) AS relationshipKind,
      r.confidence AS relationshipConfidence,
      target.id AS graphFromId,
      source.id AS graphToId
    ORDER BY target.id, relationshipKind, relationshipId
    LIMIT $limit`;
}

function sortPaths(paths: EvidencePath[]): EvidencePath[] {
  return [...paths].sort((left, right) => {
    if (left.distance !== right.distance) {
      return left.distance - right.distance;
    }
    const leftKey = left.entities.map((entity) => entity.id).join("/");
    const rightKey = right.entities.map((entity) => entity.id).join("/");
    return leftKey.localeCompare(rightKey);
  });
}

function rankCandidates(candidates: Candidate[], query?: string): RankedEntity[] {
  const normalizedQuery = query?.trim().toLowerCase();
  const ranked = candidates.map(({ entity, paths }) => {
    const exactEntityMatch =
      normalizedQuery && entity.name.toLowerCase() === normalizedQuery ? 1 : 0;
    const directEvidence = paths.some((path) => path.distance === 1) ? 1 : 0;
    const shortestDistance = paths.length > 0 ? Math.min(...paths.map((path) => path.distance)) : 0;
    const relationshipDistance = shortestDistance > 0 ? 1 / shortestDistance : 0;
    const independentPaths = Math.min(paths.length, MAX_PATHS_PER_ENTITY) / MAX_PATHS_PER_ENTITY;
    const confidence = entity.confidence;
    const sourceLocation = entity.lineStart > 0 && entity.lineEnd >= entity.lineStart ? 1 : 0;
    const score = Number(
      (
        exactEntityMatch * 5 +
        directEvidence * 3 +
        relationshipDistance * 2 +
        independentPaths +
        confidence +
        sourceLocation
      ).toFixed(6),
    );

    return {
      ...entity,
      evidencePaths: sortPaths(paths),
      ranking: {
        confidence,
        directEvidence,
        exactEntityMatch,
        independentPaths,
        relationshipDistance,
        sourceLocation,
      },
      score,
    };
  });

  return ranked.sort((left, right) => {
    if (left.score !== right.score) {
      return right.score - left.score;
    }
    if (left.ranking.relationshipDistance !== right.ranking.relationshipDistance) {
      return right.ranking.relationshipDistance - left.ranking.relationshipDistance;
    }
    if (left.ranking.confidence !== right.ranking.confidence) {
      return right.ranking.confidence - left.ranking.confidence;
    }
    return left.id.localeCompare(right.id);
  });
}

export class InvestigationTools {
  constructor(private readonly graph: GraphQueryClient) {}

  async find_entities(input: FindEntitiesInput): Promise<InvestigationResult> {
    const scope = validateScope(input);
    const query = input.query.trim();
    const limit = boundedLimit(input.limit);
    if (!query || query.length > 200) {
      throw new InvestigationToolError("query must be between 1 and 200 characters.");
    }

    const result = await this.graph.query(
      `MATCH (n)
       WHERE n.repositoryId = $repositoryId
         AND n.commitSha = $commitSha
         AND (toLower(n.name) CONTAINS toLower($query) OR toLower(n.path) CONTAINS toLower($query))
       RETURN ${entityProjection("n", "")}
       ORDER BY n.id
       LIMIT $limit`,
      { commitSha: scope.commitSha, limit, query, repositoryId: scope.repositoryId },
    );
    const candidates = result.rows.map((row) => ({
      entity: entityFromRow(rowRecord(result, row)),
      paths: [],
    }));
    return {
      results: rankCandidates(candidates, query),
      scope,
      truncated: result.rows.length >= limit,
    };
  }

  async find_dependencies(input: DependencyInput): Promise<InvestigationResult> {
    return this.traverse(input, "outgoing", ["IMPORTS", "CALLS"]);
  }

  async find_callers(input: CallerInput): Promise<InvestigationResult> {
    return this.traverse(input, "incoming", ["CALLS"]);
  }

  async traverse_relationships(input: RelationshipTraversalInput): Promise<InvestigationResult> {
    const direction = input.direction ?? "both";
    if (!["incoming", "outgoing", "both"].includes(direction)) {
      throw new InvestigationToolError("direction must be incoming, outgoing, or both.");
    }
    return this.traverse(input, direction, ["CALLS", "CONTAINS", "IMPORTS"]);
  }

  async get_evidence_path(input: EvidencePathInput): Promise<EvidencePathResult> {
    const scope = validateScope(input);
    const fromEntityId = requiredId(input.fromEntityId, "fromEntityId");
    const toEntityId = requiredId(input.toEntityId, "toEntityId");
    const limit = boundedLimit(input.limit);
    const maxDepth = boundedDepth(input.maxDepth);
    const start = await this.findEntity(scope, fromEntityId);
    if (!start) {
      return { paths: [], scope, truncated: false };
    }

    const collected = await this.collectPaths(
      scope,
      start,
      "both",
      ["CALLS", "CONTAINS", "IMPORTS"],
      maxDepth,
      limit,
      toEntityId,
    );
    return {
      paths: collected.paths.filter((path) => path.entities.at(-1)?.id === toEntityId),
      scope,
      truncated: collected.truncated,
    };
  }

  async get_source_locations(input: SourceLocationInput): Promise<SourceLocationResult> {
    const scope = validateScope(input);
    const limit = boundedLimit(input.limit);
    if (
      !Array.isArray(input.entityIds) ||
      input.entityIds.length < 1 ||
      input.entityIds.length > MAX_LIMIT
    ) {
      throw new InvestigationToolError(`entityIds must contain between 1 and ${MAX_LIMIT} IDs.`);
    }

    const locations: InvestigationEntity[] = [];
    for (const entityId of input.entityIds.slice(0, limit)) {
      const entity = await this.findEntity(scope, requiredId(entityId, "entityId"));
      if (entity) {
        locations.push(entity);
      }
    }
    locations.sort((left, right) => left.id.localeCompare(right.id));
    return {
      locations,
      scope,
      truncated: input.entityIds.length > limit,
    };
  }

  private async traverse(
    input: GraphScope & { entityId: string; limit?: number; maxDepth?: number },
    direction: TraversalDirection,
    relationshipKinds: InvestigationRelationshipKind[],
  ): Promise<InvestigationResult> {
    const scope = validateScope(input);
    const entityId = requiredId(input.entityId, "entityId");
    const limit = boundedLimit(input.limit);
    const maxDepth = boundedDepth(input.maxDepth);
    const start = await this.findEntity(scope, entityId);
    if (!start) {
      return { results: [], scope, truncated: false };
    }

    const collected = await this.collectPaths(
      scope,
      start,
      direction,
      relationshipKinds,
      maxDepth,
      limit,
    );
    const candidates = [...collected.candidates.values()].map((paths) => ({
      entity: paths[0]?.entities.at(-1) as InvestigationEntity,
      paths,
    }));
    return {
      results: rankCandidates(candidates),
      scope,
      truncated: collected.truncated,
    };
  }

  private async findEntity(
    scope: GraphScope,
    entityId: string,
  ): Promise<InvestigationEntity | null> {
    const result = await this.graph.query(
      `MATCH (n)
       WHERE n.id = $entityId
         AND n.repositoryId = $repositoryId
         AND n.commitSha = $commitSha
       RETURN ${entityProjection("n", "")}
       LIMIT 1`,
      { commitSha: scope.commitSha, entityId, repositoryId: scope.repositoryId },
    );
    const row = result.rows[0];
    return row ? entityFromRow(rowRecord(result, row)) : null;
  }

  private async expand(
    scope: GraphScope,
    entityId: string,
    direction: "incoming" | "outgoing",
    relationshipKinds: InvestigationRelationshipKind[],
    limit: number,
  ): Promise<{ hops: Hop[]; truncated: boolean }> {
    const result = await this.graph.query(
      hopQuery(direction, relationshipPredicate(relationshipKinds)),
      { commitSha: scope.commitSha, entityId, limit, repositoryId: scope.repositoryId },
    );
    const hops = result.rows.map((row) => {
      const values = rowRecord(result, row);
      return {
        relationship: {
          confidence: numberValue(values.relationshipConfidence, 0),
          direction,
          fromId: entityId,
          graphFromId: stringValue(values.graphFromId),
          graphToId: stringValue(values.graphToId),
          id: stringValue(values.relationshipId),
          kind: stringValue(values.relationshipKind) as InvestigationRelationshipKind,
          toId: stringValue(values.targetId),
        },
        target: entityFromRow(values, "target"),
      } satisfies Hop;
    });
    return { hops, truncated: result.rows.length >= limit };
  }

  private async collectPaths(
    scope: GraphScope,
    start: InvestigationEntity,
    direction: TraversalDirection,
    relationshipKinds: InvestigationRelationshipKind[],
    maxDepth: number,
    limit: number,
    targetEntityId?: string,
  ): Promise<{
    candidates: Map<string, EvidencePath[]>;
    paths: EvidencePath[];
    truncated: boolean;
  }> {
    const candidates = new Map<string, EvidencePath[]>();
    const matchingPaths: EvidencePath[] = [];
    let frontier: PathState[] = [
      { entity: start, path: { distance: 0, entities: [start], relationships: [] } },
    ];
    let truncated = false;

    for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
      const nextFrontier: PathState[] = [];
      for (const state of frontier) {
        const directions: Array<"incoming" | "outgoing"> =
          direction === "both" ? ["outgoing", "incoming"] : [direction];
        for (const hopDirection of directions) {
          const expansion = await this.expand(
            scope,
            state.entity.id,
            hopDirection,
            relationshipKinds,
            Math.max(1, limit - candidates.size),
          );
          truncated ||= expansion.truncated;

          for (const hop of expansion.hops) {
            if (state.path.entities.some((entity) => entity.id === hop.target.id)) {
              continue;
            }
            const path: EvidencePath = {
              distance: depth,
              entities: [...state.path.entities, hop.target],
              relationships: [...state.path.relationships, hop.relationship],
            };
            if (targetEntityId && hop.target.id === targetEntityId) {
              matchingPaths.push(path);
            }

            if (!targetEntityId || hop.target.id !== targetEntityId) {
              const paths = candidates.get(hop.target.id) ?? [];
              if (paths.length < MAX_PATHS_PER_ENTITY) {
                paths.push(path);
                candidates.set(hop.target.id, sortPaths(paths));
                if (paths.length === 1) {
                  nextFrontier.push({ entity: hop.target, path });
                }
              }
            }
            if (candidates.size >= limit) {
              truncated = true;
              break;
            }
          }
          if (candidates.size >= limit) {
            break;
          }
        }
        if (candidates.size >= limit) {
          break;
        }
      }
      frontier = nextFrontier;
      if (candidates.size >= limit) {
        break;
      }
    }

    return { candidates, paths: sortPaths(matchingPaths).slice(0, limit), truncated };
  }
}
