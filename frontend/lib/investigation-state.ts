export type InvestigationResultStatus = "failed" | "pending" | "queued" | "running" | "succeeded";

export type InvestigationReportStatus = "COMPLETED" | "NO_VERIFIED_EVIDENCE";

export interface InvestigationStateInput {
  error?: {
    code?: string;
    message: string;
  };
  report?: {
    findings: unknown[];
    status?: InvestigationReportStatus;
    summary: string;
    uncertainty: string[];
  };
  status: InvestigationResultStatus;
}

export type InvestigationStateTone = "error" | "info" | "success" | "warning";

export interface InvestigationState {
  code?: string;
  detail?: string;
  message: string;
  title: string;
  tone: InvestigationStateTone;
}

function hasNoMatchSignal(input: InvestigationStateInput): boolean {
  const report = input.report;
  if (!report) {
    return false;
  }

  return [report.summary, ...report.uncertainty].some((value) =>
    /no matching graph entities|no matching code/i.test(value),
  );
}

export function getInvestigationState(input: InvestigationStateInput): InvestigationState {
  if (input.status === "failed") {
    const code = input.error?.code;
    switch (code) {
      case "LLM_QUOTA_EXCEEDED":
        return {
          code,
          detail: input.error?.message,
          message:
            "The selected provider rejected this request because its quota or rate limit was reached.",
          title: "Model limit reached",
          tone: "warning",
        };
      case "LLM_BAD_RESPONSE":
      case "FINAL_RESPONSE_INVALID":
      case "FINAL_RESPONSE_MISSING_EVIDENCE":
        return {
          code,
          detail: input.error?.message,
          message:
            "The provider returned a response CodeTrace could not verify against the repository graph.",
          title: "Provider response could not be verified",
          tone: "error",
        };
      default:
        return {
          code,
          detail: input.error?.message,
          message: "The investigation could not be completed.",
          title: "Investigation failed",
          tone: "error",
        };
    }
  }

  if (input.status === "queued" || input.status === "running" || input.status === "pending") {
    return {
      message:
        input.status === "queued"
          ? "The investigation is queued and will start shortly."
          : "The agent is gathering and validating graph evidence.",
      title: "Investigation in progress",
      tone: "info",
    };
  }

  if (input.report?.status === "NO_VERIFIED_EVIDENCE" || input.report?.findings.length === 0) {
    return hasNoMatchSignal(input)
      ? {
          message: "No indexed entity matched the question closely enough to support an answer.",
          title: "No matching code was found",
          tone: "warning",
        }
      : {
          message:
            "The graph was searched, but no verified relationship path supports a finding yet.",
          title: "No verified path was found",
          tone: "warning",
        };
  }

  return {
    message: "The answer is backed by entities and relationship paths retrieved from the graph.",
    title: "Evidence-backed result",
    tone: "success",
  };
}
