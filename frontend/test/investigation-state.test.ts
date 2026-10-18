import { describe, expect, it } from "vitest";

import { getInvestigationState } from "../lib/investigation-state";

describe("getInvestigationState", () => {
  it("explains provider quota failures as provider limits", () => {
    const state = getInvestigationState({
      error: { code: "LLM_QUOTA_EXCEEDED", message: "rate limit" },
      status: "failed",
    });

    expect(state.title).toBe("Model limit reached");
    expect(state.tone).toBe("warning");
    expect(state.code).toBe("LLM_QUOTA_EXCEEDED");
  });

  it("separates malformed provider output from graph coverage", () => {
    const state = getInvestigationState({
      error: { code: "FINAL_RESPONSE_INVALID", message: "invalid JSON" },
      status: "failed",
    });

    expect(state.title).toBe("Provider response could not be verified");
    expect(state.message).not.toContain("graph coverage");
  });

  it("explains no-match reports separately from missing paths", () => {
    const noMatch = getInvestigationState({
      report: {
        findings: [],
        status: "NO_VERIFIED_EVIDENCE",
        summary: "No matching graph entities were found for this question.",
        uncertainty: [],
      },
      status: "succeeded",
    });
    const noPath = getInvestigationState({
      report: {
        findings: [],
        status: "NO_VERIFIED_EVIDENCE",
        summary: "The graph did not provide a verified relationship path for this question.",
        uncertainty: [],
      },
      status: "succeeded",
    });

    expect(noMatch.title).toBe("No matching code was found");
    expect(noPath.title).toBe("No verified path was found");
  });

  it("marks reports with findings as evidence-backed", () => {
    const state = getInvestigationState({
      report: {
        findings: [{}],
        status: "COMPLETED",
        summary: "A supported result.",
        uncertainty: [],
      },
      status: "succeeded",
    });

    expect(state.title).toBe("Evidence-backed result");
    expect(state.tone).toBe("success");
  });
});
