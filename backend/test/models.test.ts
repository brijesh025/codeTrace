import { describe, expect, it } from "vitest";

import { loadBackendConfig } from "../src/config.js";
import { createModelRegistry } from "../src/models.js";

describe("model registry", () => {
  it("lists only models for providers with configured server-side keys", () => {
    const config = loadBackendConfig({
      GROQ_API_KEY: "test-groq-key",
    });
    const registry = createModelRegistry(config);

    expect(registry.list().map((model) => model.id)).toEqual(["openai/gpt-oss-20b"]);
    expect(registry.defaultModel).toBe("openai/gpt-oss-20b");
    expect(registry.has("gemini-3.8-flash")).toBe(false);
  });

  it("exposes both provider catalogs when both keys are configured", () => {
    const config = loadBackendConfig({
      GEMINI_API_KEY: "test-gemini-key",
      GROQ_API_KEY: "test-groq-key",
    });
    const registry = createModelRegistry(config);

    expect(registry.list().map((model) => model.id)).toContain("gemini-3.8-flash");
    expect(registry.list().map((model) => model.id)).toContain("openai/gpt-oss-20b");
    expect(registry.defaultModel).toBe("openai/gpt-oss-20b");
  });
});
