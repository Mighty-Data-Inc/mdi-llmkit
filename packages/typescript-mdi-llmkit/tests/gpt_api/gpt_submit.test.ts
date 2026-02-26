import { describe, expect, it } from "vitest";

import {
  GPT_MODEL_SMART,
  gptSubmit,
  type OpenAIClientLike,
} from "../../src/gpt_api/functions.js";

class FakeResponse {
  output_text: any;
  error: any;
  incomplete_details: any;

  constructor(outputText: any = "", error: any = null, incompleteDetails: any = null) {
    this.output_text = outputText;
    this.error = error;
    this.incomplete_details = incompleteDetails;
  }
}

class FakeResponsesAPI {
  sideEffects: any[];
  createCalls: Array<Record<string, unknown>>;

  constructor(sideEffects: any[] = []) {
    this.sideEffects = [...sideEffects];
    this.createCalls = [];
  }

  create(kwargs: Record<string, unknown>) {
    this.createCalls.push(kwargs);

    if (!this.sideEffects.length) {
      return new FakeResponse();
    }

    const next = this.sideEffects.shift();
    if (next instanceof Error) {
      throw next;
    }
    return next;
  }
}

class FakeOpenAIClient implements OpenAIClientLike {
  responses: FakeResponsesAPI;

  constructor(sideEffects: any[] = []) {
    this.responses = new FakeResponsesAPI(sideEffects);
  }
}

class OpenAIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenAIError";
  }
}

describe("gptSubmit", () => {
  it("uses default model and omits text config when json mode is disabled", async () => {
    const client = new FakeOpenAIClient([new FakeResponse("ok")]);

    const result = await gptSubmit([{ role: "user", content: "Hello" }], client);

    expect(result).toBe("ok");
    expect(client.responses.createCalls).toHaveLength(1);
    const request = client.responses.createCalls[0];
    expect(request.model).toBe(GPT_MODEL_SMART);
    expect("text" in request).toBe(false);
  });

  it("prepends datetime system message and keeps user messages after it", async () => {
    const client = new FakeOpenAIClient([new FakeResponse("ok")]);
    const messages = [{ role: "user", content: "Hello" }];

    await gptSubmit(messages, client);

    const submitted = client.responses.createCalls[0].input as Array<Record<string, string>>;
    expect(submitted[0].role).toBe("system");
    expect(submitted[0].content.startsWith("!DATETIME:")).toBe(true);
    expect(submitted.slice(1)).toEqual(messages);
  });

  it("replaces stale datetime messages and keeps other system messages", async () => {
    const client = new FakeOpenAIClient([new FakeResponse("ok")]);
    const messages = [
      { role: "system", content: "!DATETIME: old timestamp" },
      { role: "system", content: "keep me" },
      { role: "user", content: "hello" },
    ];

    await gptSubmit(messages, client);

    const submitted = client.responses.createCalls[0].input as Array<Record<string, string>>;
    const datetimeMessages = submitted.filter(
      (m) => m.role === "system" && typeof m.content === "string" && m.content.startsWith("!DATETIME:"),
    );
    expect(datetimeMessages).toHaveLength(1);
    expect(submitted.slice(1)).toEqual(messages.slice(1));
  });

  it("supports json_response=true with json_object text format", async () => {
    const client = new FakeOpenAIClient([new FakeResponse('{"value":1}')]);

    const result = await gptSubmit([{ role: "user", content: "json" }], client, {
      jsonResponse: true,
    });

    expect(result).toEqual({ value: 1 });
    const request = client.responses.createCalls[0];
    expect(request.text).toEqual({ format: { type: "json_object" } });
  });

  it("deep copies json schema dict and appends no-unicode note without mutating input", async () => {
    const schema = {
      format: {
        type: "json_schema",
        name: "answer",
        description: "Return answer",
        schema: {
          type: "object",
          properties: { answer: { type: "string" } },
          required: ["answer"],
        },
      },
    };

    const client = new FakeOpenAIClient([new FakeResponse('{"answer":"ok"}')]);

    const result = await gptSubmit([{ role: "user", content: "json" }], client, {
      jsonResponse: schema,
    });

    expect(result).toEqual({ answer: "ok" });
    expect(schema.format.description).toBe("Return answer");

    const submitted = client.responses.createCalls[0].text as Record<string, any>;
    expect(submitted.format.description).toContain("ABSOLUTELY NO UNICODE ALLOWED");
  });

  it("parses first json object when response contains trailing json", async () => {
    const client = new FakeOpenAIClient([new FakeResponse('{"first":1}{"second":2}')]);

    const result = await gptSubmit([{ role: "user", content: "json" }], client, {
      jsonResponse: true,
    });

    expect(result).toEqual({ first: 1 });
  });

  it("retries openai errors and succeeds", async () => {
    const warnings: string[] = [];
    const client = new FakeOpenAIClient([new OpenAIError("temporary"), new FakeResponse("ok")]);

    const result = await gptSubmit([{ role: "user", content: "hello" }], client, {
      retryLimit: 2,
      retryBackoffTimeSeconds: 0,
      warningCallback: (message) => warnings.push(message),
    });

    expect(result).toBe("ok");
    expect(client.responses.createCalls).toHaveLength(2);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("OpenAI API error");
    expect(warnings[0]).toContain("Retrying (attempt 1 of 2)");
  });

  it("retries json decode errors and succeeds", async () => {
    const warnings: string[] = [];
    const client = new FakeOpenAIClient([new FakeResponse("not json"), new FakeResponse('{"ok":true}')]);

    const result = await gptSubmit([{ role: "user", content: "hello" }], client, {
      jsonResponse: true,
      retryLimit: 2,
      warningCallback: (message) => warnings.push(message),
    });

    expect(result).toEqual({ ok: true });
    expect(client.responses.createCalls).toHaveLength(2);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("JSON decode error");
  });

  it("throws for malformed response output_text without retry", async () => {
    const client = new FakeOpenAIClient([new FakeResponse(null)]);

    await expect(
      gptSubmit([{ role: "user", content: "hello" }], client, {
        retryLimit: 5,
      }),
    ).rejects.toBeInstanceOf(TypeError);

    expect(client.responses.createCalls).toHaveLength(1);
  });

  it("throws immediately if jsonResponse string is invalid json", async () => {
    const client = new FakeOpenAIClient([new FakeResponse('{"unused":true}')]);

    await expect(
      gptSubmit([{ role: "user", content: "hello" }], client, {
        jsonResponse: "{not valid json",
      }),
    ).rejects.toBeInstanceOf(SyntaxError);

    expect(client.responses.createCalls).toHaveLength(0);
  });

  it("throws unknown error when retryLimit is zero", async () => {
    const client = new FakeOpenAIClient([new FakeResponse("ok")]);

    await expect(
      gptSubmit([{ role: "user", content: "hello" }], client, {
        retryLimit: 0,
      }),
    ).rejects.toThrow("Unknown error occurred in gptSubmit");
  });
});
