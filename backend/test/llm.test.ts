import { describe, expect, it } from "vitest";

import {
  createGeminiClient,
  createOpenAiCompatibleClient,
  type LlmClientError,
} from "../src/llm.js";

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

  it("supports the OpenAI-compatible tool-calling contract", async () => {
    let requestInit: RequestInit | undefined;
    const client = createOpenAiCompatibleClient({
      apiKey: "test-groq-key",
      fetchImpl: async (_input, init) => {
        requestInit = init;
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  tool_calls: [
                    {
                      function: {
                        arguments: JSON.stringify({ query: "run" }),
                        name: "find_entities",
                      },
                      id: "call-1",
                      type: "function",
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        );
      },
      model: "openai/gpt-oss-20b",
    });

    const result = await client.generate({
      contents: [{ parts: [{ text: "Investigate this" }], role: "user" }],
      systemInstruction: { parts: [{ text: "You are CodeTrace." }] },
      toolConfig: { functionCallingConfig: { mode: "AUTO" } },
      tools: [
        {
          functionDeclarations: [
            {
              description: "Find entities.",
              name: "find_entities",
              parameters: { type: "object" },
            },
          ],
        },
      ],
    });

    const body = JSON.parse(String(requestInit?.body)) as {
      messages: Array<Record<string, unknown>>;
      model: string;
    };
    expect(new Headers(requestInit?.headers).get("authorization")).toBe("Bearer test-groq-key");
    expect(body.model).toBe("openai/gpt-oss-20b");
    expect(body.messages[0]).toEqual({ content: "You are CodeTrace.", role: "system" });
    expect(result.functionCalls).toEqual([
      { args: { query: "run" }, id: "call-1", name: "find_entities" },
    ]);
  });

  it("omits tool choice when requesting a final response without tools", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const client = createOpenAiCompatibleClient({
      apiKey: "test-provider-key",
      fetchImpl: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: '{"summary":"done","findings":[],"checklist":[],"uncertainty":[]}',
                },
              },
            ],
          }),
          { status: 200 },
        );
      },
    });

    await client.generate({
      contents: [{ parts: [{ text: "Return the final JSON." }], role: "user" }],
      toolConfig: { functionCallingConfig: { mode: "NONE" } },
    });

    expect(requestBody).not.toHaveProperty("tools");
    expect(requestBody).not.toHaveProperty("tool_choice");
  });

  it("enables JSON mode for the final response when configured", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const client = createOpenAiCompatibleClient({
      apiKey: "test-provider-key",
      jsonMode: true,
      fetchImpl: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
          { status: 200 },
        );
      },
    });

    await client.generate({
      contents: [{ parts: [{ text: "Return JSON." }], role: "user" }],
      toolConfig: { functionCallingConfig: { mode: "NONE" } },
    });

    expect(requestBody).toMatchObject({ response_format: { type: "json_object" } });
  });

  it("serializes assistant tool-call content as an empty string", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const client = createOpenAiCompatibleClient({
      apiKey: "test-provider-key",
      fetchImpl: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
          { status: 200 },
        );
      },
    });

    await client.generate({
      contents: [
        {
          parts: [{ functionCall: { args: { query: "run" }, id: "call-1", name: "find_entities" } }],
          role: "model",
        },
      ],
    });

    const messages = requestBody?.messages as Array<Record<string, unknown>>;
    expect(messages[0]?.content).toBe("");
  });
});
