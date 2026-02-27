export const GPT_MODEL_CHEAP = "gpt-4.1-nano";
export const GPT_MODEL_SMART = "gpt-4.1";

const GPT_RETRY_LIMIT_DEFAULT = 5;
const GPT_RETRY_BACKOFF_TIME_SECONDS_DEFAULT = 30;

export interface OpenAIClientLike {
  responses: {
    create: (args: {
      model: string;
      input: unknown[];
      text?: Record<string, unknown>;
    }) => Promise<any> | any;
  };
}

export interface SystemMessage {
  role: "system";
  content: string;
}

export interface GptSubmitOptions {
  model?: string;
  jsonResponse?: boolean | Record<string, unknown> | string;
  systemAnnouncementMessage?: string;
  retryLimit?: number;
  retryBackoffTimeSeconds?: number;
  warningCallback?: (message: string) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * OpenAI's API, even when called with a JSON schema, will often return text that is not
 * valid JSON. It's often because the model will add extra text after the end of its valid
 * JSON response. E.g. instead of `{"foo":"bar"}`, it will sometimes return
 * `{"foo":"bar"}{"baz":"quux"}`.
 *
 * We intentionally do not implement a custom JSON parser here. Instead:
 * 1) Try to parse the full text first (fast path, most responses).
 * 2) If that fails, scan prefixes from start to end and let JSON.parse decide validity.
 *
 * This keeps JSON semantics delegated to the platform parser while still recovering from
 * trailing junk in model output.
 *
 * @param input The text to parse.
 * @returns The first valid JSON value found at the start of the input text.
 * @throws {SyntaxError} If no valid JSON prefix exists.
 */
function parseFirstJsonValue(input: string): any {
  const text = input.trimStart();
  if (!text) {
    throw new SyntaxError("Unexpected end of JSON input");
  }

  try {
    return JSON.parse(text);
  } catch {
    for (let end = 1; end <= text.length; end += 1) {
      try {
        return JSON.parse(text.slice(0, end));
      } catch {
        // Keep scanning until we find a valid JSON prefix.
      }
    }
  }

  throw new SyntaxError("Unexpected token in JSON input");
}

function isRetryableOpenAIError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const name = error.name || "";
  return name.includes("OpenAI") || name.includes("APIError");
}

export function currentDatetimeSystemMessage(): SystemMessage {
  const now = new Date();
  const pad = (value: number): string => value.toString().padStart(2, "0");
  const timestamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  return {
    role: "system",
    content: `!DATETIME: The current date and time is ${timestamp}`,
  };
}

export async function gptSubmit(
  messages: unknown[],
  openaiClient: OpenAIClientLike,
  options: GptSubmitOptions = {},
): Promise<string | Record<string, unknown> | unknown[] | number | boolean | null> {
  const model = options.model || GPT_MODEL_SMART;
  const retryLimit = options.retryLimit ?? GPT_RETRY_LIMIT_DEFAULT;
  const retryBackoffTimeSeconds =
    options.retryBackoffTimeSeconds ?? GPT_RETRY_BACKOFF_TIME_SECONDS_DEFAULT;

  let failedError: unknown = null;

  let openaiTextParam: Record<string, unknown> | undefined;
  if (options.jsonResponse) {
    if (typeof options.jsonResponse === "boolean") {
      openaiTextParam = { format: { type: "json_object" } };
    } else if (typeof options.jsonResponse === "string") {
      openaiTextParam = JSON.parse(options.jsonResponse) as Record<string, unknown>;
    } else if (isRecord(options.jsonResponse)) {
      openaiTextParam = JSON.parse(JSON.stringify(options.jsonResponse)) as Record<
        string,
        unknown
      >;

      const format = openaiTextParam.format;
      if (isRecord(format) && typeof format.description === "string") {
        format.description = 
          `${format.description}\n\nABSOLUTELY NO UNICODE ALLOWED. ` +
          `Only use typeable keyboard characters. Do not try to circumvent this rule ` +
          `with escape sequences, backslashes, or other tricks. Use double dashes (--), ` +
          `straight quotes (") and single quotes (') instead of em-dashes, en-dashes, ` +
          `and curly versions.`.trim();
      }
    }
  }

  const filteredMessages = messages.filter((message) => {
    if (!isRecord(message)) {
      return true;
    }
    const role = message.role;
    const content = message.content;
    return !(
      role === "system" &&
      typeof content === "string" &&
      content.startsWith("!DATETIME:")
    );
  });

  let preparedMessages: unknown[] = [currentDatetimeSystemMessage(), ...filteredMessages];

  if (options.systemAnnouncementMessage && options.systemAnnouncementMessage.trim()) {
    preparedMessages = [
      { role: "system", content: options.systemAnnouncementMessage.trim() },
      ...preparedMessages,
    ];
  }

  for (let index = 0; index < retryLimit; index += 1) {
    let llmReply = "";

    try {
      const payload: {
        model: string;
        input: unknown[];
        text?: Record<string, unknown>;
      } = {
        model,
        input: preparedMessages,
      };
      if (openaiTextParam) {
        payload.text = openaiTextParam;
      }

      const llmResponse = await openaiClient.responses.create(payload);

      if (llmResponse.error && options.warningCallback) {
        options.warningCallback(`ERROR: OpenAI API returned an error: ${llmResponse.error}`);
      }
      if (llmResponse.incomplete_details && options.warningCallback) {
        options.warningCallback(
          `ERROR: OpenAI API returned incomplete details: ${llmResponse.incomplete_details}`,
        );
      }

      llmReply = llmResponse.output_text.trim();

      if (!options.jsonResponse) {
        return `${llmReply}`;
      }

      return parseFirstJsonValue(llmReply);
    } catch (error) {
      if (error instanceof SyntaxError) {
        failedError = error;
        if (options.warningCallback) {
          options.warningCallback(
            `JSON decode error:\n\n${error}.\n\nRaw text of LLM Reply:\n${llmReply}\n\nRetrying (attempt ${index + 1} of ${retryLimit}) immediately...`,
          );
        }
        continue;
      }

      if (isRetryableOpenAIError(error)) {
        failedError = error;
        if (options.warningCallback) {
          options.warningCallback(
            `OpenAI API error:\n\n${error}.\n\nRetrying (attempt ${index + 1} of ${retryLimit}) in ${retryBackoffTimeSeconds} seconds...`,
          );
        }
        await sleep(retryBackoffTimeSeconds * 1000);
        continue;
      }

      throw error;
    }
  }

  if (failedError) {
    throw failedError;
  }

  throw new Error("Unknown error occurred in gptSubmit");
}
