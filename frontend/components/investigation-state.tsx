import { getInvestigationState, type InvestigationStateInput } from "../lib/investigation-state";

export function InvestigationStateBanner({ input }: { input: InvestigationStateInput }) {
  const state = getInvestigationState(input);

  return (
    <div className={`investigation-state investigation-state-${state.tone}`} role="status">
      <div className="investigation-state-heading">
        <span className="investigation-state-mark" aria-hidden="true" />
        <div>
          <p className="investigation-state-title">{state.title}</p>
          <p className="investigation-state-message">{state.message}</p>
        </div>
        {state.code ? <code>{state.code}</code> : null}
      </div>
      {state.detail ? (
        <p className="investigation-state-detail">Provider detail: {state.detail}</p>
      ) : null}
      {input.status === "failed" ? (
        <p className="investigation-state-next-step">
          Try another configured model or retry after the provider limit resets.
        </p>
      ) : null}
      {input.report?.status === "NO_VERIFIED_EVIDENCE" ? (
        <p className="investigation-state-next-step">
          Try a concrete function, class, module, or file name from the indexed repository.
        </p>
      ) : null}
    </div>
  );
}
