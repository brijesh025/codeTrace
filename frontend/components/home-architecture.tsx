"use client";

import { useState, type ReactNode } from "react";
import { Bot, Database, FileCode2, GitBranch, MessageSquare, ShieldCheck } from "lucide-react";

type ExplorerView = "graph" | "agent" | "answer";

const views: Array<{ id: ExplorerView; label: string; eyebrow: string }> = [
  { id: "graph", label: "Evidence graph", eyebrow: "01 / Structure" },
  { id: "agent", label: "Agent loop", eyebrow: "02 / Reasoning" },
  { id: "answer", label: "Answer anatomy", eyebrow: "03 / Output" },
];

export function HomeArchitecture() {
  const [activeView, setActiveView] = useState<ExplorerView>("graph");

  return (
    <section className="home-architecture" aria-labelledby="architecture-title">
      <div className="home-section-heading architecture-heading">
        <p className="eyebrow">See the system</p>
        <h2 id="architecture-title">A graph is the difference between a guess and a trace.</h2>
        <p>
          Explore the three layers behind every CodeTrace answer. Select a layer to see what is
          connected, what the agent can inspect, and why the final response is auditable.
        </p>
      </div>

      <div className="architecture-explorer">
        <div className="architecture-tabs" role="tablist" aria-label="CodeTrace system layers">
          {views.map((view) => (
            <button
              aria-selected={activeView === view.id}
              className={`architecture-tab ${activeView === view.id ? "is-active" : ""}`}
              key={view.id}
              onClick={() => setActiveView(view.id)}
              role="tab"
              type="button"
            >
              <span>{view.eyebrow}</span>
              <strong>{view.label}</strong>
            </button>
          ))}
        </div>

        <div className="architecture-panel" role="tabpanel">
          {activeView === "graph" ? <GraphView /> : null}
          {activeView === "agent" ? <AgentView /> : null}
          {activeView === "answer" ? <AnswerView /> : null}
        </div>
      </div>
    </section>
  );
}

function GraphView() {
  return (
    <div className="architecture-view">
      <div className="architecture-copy">
        <p className="view-kicker">The repository becomes navigable context</p>
        <h3>Files are only the surface. Relationships are the signal.</h3>
        <p>
          CodeTrace reads source files without running them, then records the relationships that
          matter during change: definitions, imports, calls, references, and source locations.
        </p>
        <div className="view-facts">
          <span><FileCode2 size={15} /> Source files</span>
          <span><GitBranch size={15} /> Relationships</span>
          <span><Database size={15} /> FalkorDB graph</span>
        </div>
      </div>
      <div className="graph-canvas" aria-label="Repository graph illustration">
        <span className="graph-line graph-line-one" />
        <span className="graph-line graph-line-two" />
        <span className="graph-line graph-line-three" />
        <GraphNode className="graph-node-root" icon={<GitBranch size={18} />} label="repository" />
        <GraphNode className="graph-node-a" icon={<FileCode2 size={17} />} label="auth.ts" />
        <GraphNode className="graph-node-b" icon={<FileCode2 size={17} />} label="api.ts" />
        <GraphNode className="graph-node-c" icon={<FileCode2 size={17} />} label="graph.ts" />
        <GraphNode className="graph-node-d" icon={<Database size={17} />} label="evidence" />
      </div>
    </div>
  );
}

function AgentView() {
  return (
    <div className="architecture-view">
      <div className="architecture-copy">
        <p className="view-kicker">The model follows bounded tools</p>
        <h3>The agent searches the graph before it explains anything.</h3>
        <p>
          A question becomes a small investigation loop. The model can ask for entities,
          dependencies, callers, relationships, evidence paths, and source locations—nothing
          outside the declared tool boundary.
        </p>
        <div className="view-facts">
          <span><MessageSquare size={15} /> Question</span>
          <span><Bot size={15} /> Tool calls</span>
          <span><ShieldCheck size={15} /> Verified evidence</span>
        </div>
      </div>
      <div className="agent-canvas" aria-label="Agent investigation loop illustration">
        <div className="agent-step agent-step-question"><MessageSquare size={18} /><span>ask</span></div>
        <div className="agent-step agent-step-tools"><Bot size={18} /><span>query tools</span></div>
        <div className="agent-step agent-step-graph"><Database size={18} /><span>retrieve graph</span></div>
        <div className="agent-step agent-step-evidence"><ShieldCheck size={18} /><span>verify paths</span></div>
        <span className="agent-loop agent-loop-one" />
        <span className="agent-loop agent-loop-two" />
        <span className="agent-loop agent-loop-three" />
        <span className="agent-loop agent-loop-four" />
      </div>
    </div>
  );
}

function AnswerView() {
  return (
    <div className="architecture-view">
      <div className="architecture-copy">
        <p className="view-kicker">The answer carries its trail</p>
        <h3>Findings are useful because you can walk back to the code.</h3>
        <p>
          The result separates supported findings from uncertainty and attaches relationship paths
          and source locations to every supported finding.
        </p>
        <div className="view-facts">
          <span><ShieldCheck size={15} /> Supported</span>
          <span><FileCode2 size={15} /> Source location</span>
          <span><GitBranch size={15} /> Evidence path</span>
        </div>
      </div>
      <div className="answer-canvas" aria-label="Investigation answer illustration">
        <div className="answer-card answer-card-main">
          <div className="answer-card-heading"><span className="answer-dot" /> supported finding</div>
          <strong>auth.ts could affect session middleware</strong>
          <code>auth.ts → middleware.ts → api.ts</code>
        </div>
        <div className="answer-card answer-card-side">
          <span className="answer-side-label">confidence</span>
          <strong>evidence-bound</strong>
          <span className="answer-side-line" />
          <span className="answer-side-label">next step</span>
          <strong>inspect callers</strong>
        </div>
      </div>
    </div>
  );
}

function GraphNode({
  className,
  icon,
  label,
}: {
  className: string;
  icon: ReactNode;
  label: string;
}) {
  return <span className={`graph-node ${className}`}>{icon}<small>{label}</small></span>;
}
