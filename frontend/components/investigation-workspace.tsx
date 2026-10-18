"use client";

import { useEffect, useMemo, useState } from "react";

type IndexStatus = "failed" | "queued" | "running" | "succeeded";
type InvestigationStatus = "failed" | "pending" | "queued" | "running" | "succeeded";

interface IndexJob {
  commitSha?: string;
  error?: ApiError;
  id: string;
  progress: {
    diagnosticsCount: number;
    filesDiscovered: number;
    filesProcessed: number;
    nodeCount: number;
    relationshipCount: number;
  };
  repositoryId: string;
  status: IndexStatus;
}

interface ApiError {
  code?: string;
  message: string;
}

interface Entity {
  id: string;
  kind: string;
  lineEnd: number;
  lineStart: number;
  name: string;
  path: string;
}

interface EvidencePath {
  distance: number;
  entities: Entity[];
  relationships: Array<{ kind: string }>;
}

interface Finding {
  entity: Entity;
  evidencePaths: EvidencePath[];
  priority: "high" | "low" | "medium";
  reason: string;
  sourceLocations: Entity[];
}

interface InvestigationRecord {
  commitSha?: string;
  error?: ApiError;
  id: string;
  report?: {
    checklist: string[];
    findings: Finding[];
    summary: string;
    uncertainty: string[];
  };
  status: InvestigationStatus;
}

interface Props {
  initialRepositoryUrl?: string;
}

interface ModelOption {
  description: string;
  id: string;
  label: string;
  provider: "gemini" | "groq";
  recommended: boolean;
}

const terminalIndexStatuses = new Set<IndexStatus>(["failed", "succeeded"]);
const terminalInvestigationStatuses = new Set<InvestigationStatus>(["failed", "succeeded"]);

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed with status ${response.status}.`);
  }
  return payload;
}

function statusLabel(status: string): string {
  return status.replace(/^./, (character) => character.toUpperCase());
}

function locationLabel(entity: Entity): string {
  const lines = entity.lineStart > 0 ? `:${entity.lineStart}-${entity.lineEnd}` : "";
  return `${entity.path}${lines}`;
}

function pathLabel(path: EvidencePath): string {
  return path.entities.map((entity) => entity.name || entity.path).join(" → ");
}

function errorLabel(error: ApiError | undefined, fallback: string): string {
  return error ? `${error.code ? `${error.code}: ` : ""}${error.message}` : fallback;
}

export function InvestigationWorkspace({ initialRepositoryUrl }: Props = {}) {
  const [repositoryUrl, setRepositoryUrl] = useState(initialRepositoryUrl ?? "");
  const [question, setQuestion] = useState("");
  const [job, setJob] = useState<IndexJob | null>(null);
  const [investigation, setInvestigation] = useState<InvestigationRecord | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isIndexing, setIsIndexing] = useState(false);
  const [isInvestigating, setIsInvestigating] = useState(false);

  const canAskQuestion = job?.status === "succeeded" && Boolean(selectedModel);
  const indexProgress = useMemo(() => job?.progress, [job?.progress]);
  const jobId = job?.id;
  const jobStatus = job?.status;
  const investigationId = investigation?.id;
  const investigationStatus = investigation?.status;

  useEffect(() => {
    let active = true;
    const loadModels = async () => {
      try {
        const response = await fetch("/api/backend/models", { cache: "no-store" });
        const payload = await readJson<{ defaultModel: string | null; models: ModelOption[] }>(
          response,
        );
        if (active) {
          setModels(payload.models);
          setSelectedModel(payload.defaultModel ?? payload.models[0]?.id ?? "");
        }
      } catch (requestError) {
        if (active) {
          setError(requestError instanceof Error ? requestError.message : "Could not load models.");
        }
      }
    };

    void loadModels();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!jobId || !jobStatus || terminalIndexStatuses.has(jobStatus)) {
      return;
    }

    let active = true;
    const poll = async () => {
      try {
        const response = await fetch(
          `/api/backend/repositories/${encodeURIComponent(jobId)}/index-status`,
          {
            cache: "no-store",
          },
        );
        const nextJob = await readJson<IndexJob>(response);
        if (active) {
          setJob(nextJob);
        }
      } catch (pollError) {
        if (active) {
          setError(
            pollError instanceof Error ? pollError.message : "Could not read indexing status.",
          );
        }
      }
    };

    void poll();
    const interval = window.setInterval(() => void poll(), 1_500);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [jobId, jobStatus]);

  useEffect(() => {
    if (
      !investigationId ||
      !investigationStatus ||
      terminalInvestigationStatuses.has(investigationStatus)
    ) {
      return;
    }

    let active = true;
    const poll = async () => {
      try {
        const response = await fetch(
          `/api/backend/investigations/${encodeURIComponent(investigationId)}`,
          {
            cache: "no-store",
          },
        );
        const nextInvestigation = await readJson<InvestigationRecord>(response);
        if (active) {
          setInvestigation(nextInvestigation);
        }
      } catch (pollError) {
        if (active) {
          setError(
            pollError instanceof Error ? pollError.message : "Could not read investigation status.",
          );
        }
      }
    };

    void poll();
    const interval = window.setInterval(() => void poll(), 1_500);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [investigationId, investigationStatus]);

  async function indexRepository(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setInvestigation(null);
    setIsIndexing(true);
    try {
      const response = await fetch("/api/backend/repositories/index", {
        body: JSON.stringify({
          idempotencyKey: `browser-${Date.now()}`,
          repositoryUrl,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const nextJob = await readJson<IndexJob>(response);
      setJob(nextJob);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not start indexing.");
    } finally {
      setIsIndexing(false);
    }
  }

  async function startInvestigation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!job || !canAskQuestion) {
      return;
    }

    setError(null);
    setIsInvestigating(true);
    try {
      const response = await fetch("/api/backend/investigations", {
        body: JSON.stringify({ modelId: selectedModel, question, repositoryId: job.repositoryId }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const nextInvestigation = await readJson<InvestigationRecord>(response);
      setInvestigation(nextInvestigation);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Could not start investigation.",
      );
    } finally {
      setIsInvestigating(false);
    }
  }

  return (
    <div className="workspace-shell">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">CodeTrace / Investigation workspace</p>
          <h1>Trace the impact of a code change.</h1>
          <p className="workspace-subtitle">
            Index a public GitHub repository, then ask a focused question about affected code. Every
            finding is paired with graph evidence from the indexed revision.
          </p>
        </div>
      </header>

      {error ? (
        <div className="alert alert-error" role="alert">
          <strong>Something needs attention.</strong>
          <span>{error}</span>
          <button className="text-button" onClick={() => setError(null)} type="button">
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="workflow-grid">
        <section className="card workflow-card">
          <div className="step-heading">
            <span className="step-number">01</span>
            <div>
              <p className="eyebrow">Repository</p>
              <h2>Build the evidence graph</h2>
            </div>
          </div>
          <p className="card-copy">
            Use a public GitHub HTTPS URL. CodeTrace reads source files without installing or
            running repository code.
          </p>
          <form className="stack-form" onSubmit={indexRepository}>
            <label htmlFor="repository-url">GitHub repository URL</label>
            <input
              id="repository-url"
              onChange={(event) => setRepositoryUrl(event.target.value)}
              placeholder="https://github.com/owner/repository"
              required
              type="url"
              value={repositoryUrl}
            />
            <button
              className="primary-button"
              disabled={isIndexing || !repositoryUrl.trim()}
              type="submit"
            >
              {isIndexing ? "Starting index…" : "Index repository"}
            </button>
          </form>

          {job ? (
            <div className="status-panel" aria-live="polite">
              <div className="status-line">
                <span className={`status-badge status-${job.status}`}>
                  {statusLabel(job.status)}
                </span>
                <span className="muted-text">{job.repositoryId}</span>
              </div>
              {indexProgress ? (
                <div className="metric-grid">
                  <span>
                    <strong>{indexProgress.filesProcessed}</strong> files processed
                  </span>
                  <span>
                    <strong>{indexProgress.nodeCount}</strong> graph nodes
                  </span>
                  <span>
                    <strong>{indexProgress.relationshipCount}</strong> relationships
                  </span>
                  <span>
                    <strong>{indexProgress.diagnosticsCount}</strong> diagnostics
                  </span>
                </div>
              ) : null}
              {job.status === "failed" ? (
                <p className="inline-error">{errorLabel(job.error, "Indexing failed.")}</p>
              ) : null}
              {job.status === "succeeded" ? (
                <p className="success-text">
                  Revision {job.commitSha?.slice(0, 12)} is ready for questions.
                </p>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className={`card workflow-card ${canAskQuestion ? "" : "card-muted"}`}>
          <div className="step-heading">
            <span className="step-number">02</span>
            <div>
              <p className="eyebrow">Investigation</p>
              <h2>Ask what could be affected</h2>
            </div>
          </div>
          <p className="card-copy">
            Start with a concrete behavior or symbol. The agent selects bounded graph tools and
            returns only findings backed by retrieved paths.
          </p>
          <form className="stack-form" onSubmit={startInvestigation}>
            <label htmlFor="investigation-question">Investigation question</label>
            <textarea
              disabled={!canAskQuestion}
              id="investigation-question"
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="If the request handler changes, which callers should I inspect?"
              required
              rows={5}
              value={question}
            />
            <label htmlFor="investigation-model">Model</label>
            <select
              disabled={models.length === 0}
              id="investigation-model"
              onChange={(event) => setSelectedModel(event.target.value)}
              value={selectedModel}
            >
              {models.length === 0 ? <option value="">No configured models</option> : null}
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label} · {model.provider}
                  {model.recommended ? " · recommended" : ""}
                </option>
              ))}
            </select>
            {selectedModel ? (
              <p className="model-description">
                {models.find((model) => model.id === selectedModel)?.description}
              </p>
            ) : null}
            <button
              className="primary-button"
              disabled={!canAskQuestion || isInvestigating || !question.trim()}
              type="submit"
            >
              {isInvestigating ? "Starting investigation…" : "Investigate"}
            </button>
          </form>
          {!job ? (
            <p className="muted-text helper-text">Index a repository first to unlock this step.</p>
          ) : null}
          {job && job.status !== "succeeded" && job.status !== "failed" ? (
            <p className="muted-text helper-text">This form unlocks when indexing succeeds.</p>
          ) : null}
        </section>
      </div>

      {investigation ? <InvestigationResultCard investigation={investigation} /> : null}
    </div>
  );
}

function InvestigationResultCard({ investigation }: { investigation: InvestigationRecord }) {
  return (
    <section className="card result-card" aria-live="polite">
      <div className="result-heading">
        <div>
          <p className="eyebrow">Investigation result</p>
          <h2>
            <span className={`status-badge status-${investigation.status}`}>
              {statusLabel(investigation.status)}
            </span>
          </h2>
        </div>
        {investigation.commitSha ? (
          <code className="commit-label">{investigation.commitSha.slice(0, 12)}</code>
        ) : null}
      </div>

      {investigation.status === "failed" ? (
        <div className="alert alert-error result-alert">
          <span>{errorLabel(investigation.error, "The investigation failed.")}</span>
          <span>Choose another model above and retry.</span>
        </div>
      ) : null}

      {investigation.status === "queued" || investigation.status === "running" ? (
        <div className="progress-message">
          <span className="pulse-dot" />
          {investigation.status === "queued"
            ? "The investigation is queued."
            : "The agent is gathering graph evidence…"}
        </div>
      ) : null}

      {investigation.report ? <ReportContent report={investigation.report} /> : null}
    </section>
  );
}

function ReportContent({ report }: { report: NonNullable<InvestigationRecord["report"]> }) {
  return (
    <div className="report-content">
      <div className="summary-block">
        <p className="eyebrow">Summary</p>
        <p className="summary-text">{report.summary}</p>
      </div>

      <div className="report-columns">
        <div>
          <div className="section-heading">
            <h3>Ranked findings</h3>
            <span className="muted-text">{report.findings.length} supported</span>
          </div>
          {report.findings.length > 0 ? (
            <div className="finding-list">
              {report.findings.map((finding) => (
                <article className="finding-card" key={finding.entity.id}>
                  <div className="finding-title-row">
                    <div>
                      <span className={`priority priority-${finding.priority}`}>
                        {finding.priority}
                      </span>
                      <h4>{finding.entity.name}</h4>
                    </div>
                    <span className="entity-kind">{finding.entity.kind}</span>
                  </div>
                  <p className="finding-location">{locationLabel(finding.entity)}</p>
                  <p className="finding-reason">{finding.reason}</p>
                  <div className="evidence-block">
                    <p className="evidence-label">Verified graph evidence</p>
                    {finding.evidencePaths.map((path) => (
                      <p
                        className="evidence-path"
                        key={`${finding.entity.id}-${path.distance}-${path.entities
                          .map((entity) => entity.id)
                          .join(">")}`}
                      >
                        <span>{pathLabel(path)}</span>
                        <small>
                          {path.distance} hop{path.distance === 1 ? "" : "s"} ·{" "}
                          {path.relationships.map((relationship) => relationship.kind).join(" → ")}
                        </small>
                      </p>
                    ))}
                  </div>
                  {finding.sourceLocations.length > 0 ? (
                    <div className="source-block">
                      <p className="evidence-label">Source locations</p>
                      <ul>
                        {finding.sourceLocations.map((location) => (
                          <li key={location.id}>{locationLabel(location)}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              No supported findings were returned for this question.
            </div>
          )}
        </div>

        <aside className="side-column">
          <div className="side-block">
            <div className="section-heading">
              <h3>Investigation checklist</h3>
            </div>
            <ol className="checklist">
              {report.checklist.map((item) => (
                <li key={item}>
                  <span>{report.checklist.indexOf(item) + 1}</span>
                  {item}
                </li>
              ))}
            </ol>
          </div>
          <div className="side-block uncertainty-block">
            <div className="section-heading">
              <h3>Uncertainty</h3>
            </div>
            {report.uncertainty.length > 0 ? (
              <ul className="uncertainty-list">
                {report.uncertainty.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="muted-text">No limitations were reported.</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
