interface ActionPlanItem {
  entityIds: string[];
  kind: "inspect" | "issue" | "patch" | "test";
  rationale: string;
  steps: string[];
  title: string;
}

interface ActionPlanFinding {
  entity: {
    id: string;
    name: string;
    path: string;
  };
}

const actionLabels: Record<ActionPlanItem["kind"], string> = {
  inspect: "Inspect",
  issue: "Issue draft",
  patch: "Patch proposal",
  test: "Test plan",
};

export function ActionPlan({
  actions,
  findings,
}: {
  actions: ActionPlanItem[];
  findings: ActionPlanFinding[];
}) {
  if (actions.length === 0) {
    return null;
  }

  const findingById = new Map(findings.map((finding) => [finding.entity.id, finding.entity]));

  return (
    <section className="action-plan" aria-labelledby="action-plan-title">
      <div className="action-plan-heading">
        <div>
          <p className="eyebrow">Suggested next actions</p>
          <h3 id="action-plan-title">Safe drafts for what to do next.</h3>
          <p>
            Each proposal is linked to retrieved graph evidence. CodeTrace does not edit files,
            create issues, or push changes.
          </p>
        </div>
        <span className="action-plan-badge">Draft only</span>
      </div>

      <div className="action-list">
        {actions.map((action) => (
          <article className="action-card" key={`${action.kind}-${action.title}`}>
            <div className="action-card-heading">
              <span className={`action-kind action-kind-${action.kind}`}>
                {actionLabels[action.kind]}
              </span>
              <h4>{action.title}</h4>
            </div>
            <p className="action-rationale">{action.rationale}</p>
            <ol className="action-steps">
              {action.steps.map((step) => (
                <li key={`${action.title}-${step}`}>{step}</li>
              ))}
            </ol>
            <div className="action-evidence">
              <span className="evidence-label">Evidence scope</span>
              <div>
                {action.entityIds.map((entityId) => {
                  const entity = findingById.get(entityId);
                  return (
                    <code key={entityId}>
                      {entity ? `${entity.name || entity.path} · ${entity.path}` : entityId}
                    </code>
                  );
                })}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
