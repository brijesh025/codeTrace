import { describe, expect, it } from "vitest";

import { createGeminiClient, type LlmClientError } from "../src/llm.js";

describe("Gemini client", () => {
  it("sends the API key server-side and parses text/function-call parts", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const client = createGeminiClient({
      apiKey: "test-gemini-key",
      fetchImpl: async (input, init) => {
        requestUrl = String(input);
        requestInit = init;
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    { text: "I will inspect the graph." },
                    { functionCall: { args: { query: "run" }, name: "find_entities" } },
                  ],
                  role: "model",
                },
              },
            ],
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        );
      },
      model: "gemini-2.5-flash",
    });

    const result = await client.generate({
      contents: [{ parts: [{ text: "Investigate this" }], role: "user" }],
    });

    expect(requestUrl).toContain("models/gemini-2.5-flash:generateContent");
    expect(requestUrl).not.toContain("test-gemini-key");
    expect(new Headers(requestInit?.headers).get("x-goog-api-key")).toBe("test-gemini-key");
    expect(result.text).toBe("I will inspect the graph.");
    expect(result.functionCalls).toEqual([{ args: { query: "run" }, name: "find_entities" }]);
  });

  it("returns typed configuration and provider failures", async () => {
    await expect(createGeminiClient().generate({ contents: [] })).rejects.toMatchObject({
      code: "LLM_CONFIGURATION",
    });

    const client = createGeminiClient({
      apiKey: "test-gemini-key",
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 }),
    });
    await expect(client.generate({ contents: [] })).rejects.toEqual(
      expect.objectContaining<LlmClientError>({
        code: "LLM_REQUEST_FAILED",
        message: "rate limited",
        status: 429,
      }),
    );
  });
});
