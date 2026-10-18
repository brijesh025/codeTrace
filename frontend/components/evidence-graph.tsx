"use client";

import { useMemo, useState } from "react";

interface GraphEntity {
  id: string;
  kind: string;
  lineEnd: number;
  lineStart: number;
  name: string;
  path: string;
}

interface GraphPath {
  distance: number;
  entities: GraphEntity[];
  relationships: Array<{ kind: string }>;
}

interface GraphFinding {
  entity: GraphEntity;
  evidencePaths: GraphPath[];
  priority: "high" | "low" | "medium";
}

const GRAPH_HEIGHT = 310;
const GRAPH_WIDTH = 960;

function shortLabel(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function locationLabel(entity: GraphEntity): string {
  const lines = entity.lineStart > 0 ? `:${entity.lineStart}-${entity.lineEnd}` : "";
  return `${entity.path}${lines}`;
}

export function EvidenceGraph({ findings }: { findings: GraphFinding[] }) {
  const [findingIndex, setFindingIndex] = useState(0);
  const [pathIndex, setPathIndex] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const finding = findings[findingIndex] ?? findings[0];
  const paths = finding?.evidencePaths ?? [];
  const path = paths[pathIndex] ?? paths[0];
  const selectedNode =
    path?.entities.find((entity) => entity.id === selectedNodeId) ?? path?.entities[0];
  const positions = useMemo(() => {
    if (!path) {
      return [];
    }
    const gap = GRAPH_WIDTH / (path.entities.length + 1);
    return path.entities.map((entity, index) => ({
      entity,
      x: gap * (index + 1),
      y: GRAPH_HEIGHT / 2,
    }));
  }, [path]);

  if (!finding || !path) {
    return (
      <section
        className="evidence-graph evidence-graph-empty"
        aria-labelledby="evidence-graph-title"
      >
        <div>
          <p className="eyebrow">Evidence graph</p>
          <h3 id="evidence-graph-title">No supported path to visualize yet.</h3>
          <p>Run a focused question that returns at least one graph-backed finding.</p>
        </div>
      </section>
    );
  }

  function selectFinding(nextIndex: number) {
    setFindingIndex(nextIndex);
    setPathIndex(0);
    setSelectedNodeId(null);
  }

  function selectPath(nextIndex: number) {
    setPathIndex(nextIndex);
    setSelectedNodeId(null);
  }

  function selectNode(entityId: string) {
    setSelectedNodeId(entityId);
  }

  return (
    <section className="evidence-graph" aria-labelledby="evidence-graph-title">
      <div className="evidence-graph-heading">
        <div>
          <p className="eyebrow">Evidence graph</p>
          <h3 id="evidence-graph-title">Walk the exact path behind a finding.</h3>
          <p>
            Select a finding, path, or node to inspect the relationships returned from FalkorDB.
          </p>
        </div>
        <span className="graph-badge">
          {path.distance} hop{path.distance === 1 ? "" : "s"}
        </span>
      </div>

      <div className="evidence-graph-controls">
        <label>
          Finding
          <select
            value={findingIndex}
            onChange={(event) => selectFinding(Number(event.target.value))}
          >
            {findings.map((item, index) => (
              <option key={item.entity.id} value={index}>
                {item.priority} · {shortLabel(item.entity.name || item.entity.path, 52)}
              </option>
            ))}
          </select>
        </label>
        <div className="path-picker">
          <span>Path</span>
          {paths.map((item, index) => (
            <button
              className={index === pathIndex ? "is-selected" : ""}
              key={`${item.distance}-${item.entities.map((entity) => entity.id).join("-")}`}
              onClick={() => selectPath(index)}
              type="button"
            >
              {index + 1}
            </button>
          ))}
        </div>
      </div>

      <div className="evidence-graph-canvas">
        <svg
          aria-label={`Evidence path for ${finding.entity.name}`}
          className="evidence-graph-svg"
          role="img"
          viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
        >
          <defs>
            <marker
              id="evidence-arrow"
              markerHeight="7"
              markerWidth="7"
              orient="auto"
              refX="6"
              refY="3.5"
            >
              <path d="M0 0L7 3.5L0 7z" fill="currentColor" />
            </marker>
          </defs>
          {path.relationships.map((relationship, index) => {
            const source = positions[index];
            const target = positions[index + 1];
            if (!source || !target) {
              return null;
            }
            return (
              <g
                className="evidence-graph-edge"
                key={`${relationship.kind}-${source.entity.id}-${target.entity.id}`}
              >
                <line
                  markerEnd="url(#evidence-arrow)"
                  x1={source.x + 76}
                  x2={target.x - 76}
                  y1={source.y}
                  y2={target.y}
                />
                <text x={(source.x + target.x) / 2} y={source.y - 15}>
                  {relationship.kind}
                </text>
              </g>
            );
          })}
          {positions.map(({ entity, x, y }, index) => {
            const selected = selectedNode?.id === entity.id;
            return (
              <foreignObject
                className="evidence-graph-node"
                key={entity.id}
                height="82"
                width="152"
                x={x - 76}
                y={y - 41}
              >
                <button
                  aria-label={`${entity.kind} ${entity.name || entity.path}`}
                  aria-pressed={selected}
                  className={`evidence-graph-node-button ${selected ? "is-selected" : ""}`}
                  onClick={() => selectNode(entity.id)}
                  type="button"
                >
                  <span className="evidence-graph-node-kind">
                    <span className="evidence-graph-node-dot" />
                    {entity.kind}
                  </span>
                  <span className="evidence-graph-node-name">
                    {shortLabel(entity.name || entity.path, 22)}
                  </span>
                  <span className="evidence-graph-node-index">
                    {index + 1} / {path.entities.length}
                  </span>
                </button>
              </foreignObject>
            );
          })}
        </svg>
      </div>

      <div className="evidence-graph-footer">
        <div>
          <span className="evidence-graph-label">Selected node</span>
          <strong>{selectedNode?.name || selectedNode?.path}</strong>
          <code>{selectedNode ? locationLabel(selectedNode) : "Choose a node above"}</code>
        </div>
        <div>
          <span className="evidence-graph-label">Relationship sequence</span>
          <strong>
            {path.relationships.map((relationship) => relationship.kind).join(" → ") ||
              "Direct entity"}
          </strong>
          <code>{path.entities.map((entity) => entity.name || entity.path).join(" → ")}</code>
        </div>
      </div>
    </section>
  );
}
