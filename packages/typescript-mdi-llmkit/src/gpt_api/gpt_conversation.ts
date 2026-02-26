import { GPT_MODEL_SMART, gptSubmit, type OpenAIClientLike } from "./functions.js";

export interface ConversationMessage {
  role: string;
  content: string;
}

export interface GptConversationOptions {
  openaiClient?: OpenAIClientLike;
  model?: string;
}

export interface SubmitOptions {
  model?: string;
  jsonResponse?: boolean | Record<string, unknown> | string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class GptConversation extends Array<ConversationMessage> {
  static get [Symbol.species](): ArrayConstructor {
    return Array;
  }

  #openaiClient?: OpenAIClientLike;
  #model?: string;
  #lastReply: unknown = null;

  get openaiClient(): OpenAIClientLike | undefined {
    return this.#openaiClient;
  }

  set openaiClient(value: OpenAIClientLike | undefined) {
    this.#openaiClient = value;
  }

  get model(): string | undefined {
    return this.#model;
  }

  set model(value: string | undefined) {
    this.#model = value;
  }

  get lastReply(): unknown {
    return this.#lastReply;
  }

  set lastReply(value: unknown) {
    this.#lastReply = value;
  }

  constructor(messages: ConversationMessage[] = [], options: GptConversationOptions = {}) {
    super(...messages);
    this.#openaiClient = options.openaiClient;
    this.#model = options.model;
  }

  assignMessages(messages?: ConversationMessage[]): this {
    this.length = 0;
    if (messages?.length) {
      this.push(...messages);
    }
    return this;
  }

  clone(): GptConversation {
    return new GptConversation(JSON.parse(JSON.stringify([...this])), {
      openaiClient: this.openaiClient,
      model: this.model,
    });
  }

  async submit(
    message?: string | Record<string, unknown>,
    role: string | null = "user",
    options: SubmitOptions = {},
  ): Promise<unknown> {
    if (!this.openaiClient) {
      throw new Error("OpenAI client is not set. Please provide an OpenAI client.");
    }

    const model = options.model || this.model || GPT_MODEL_SMART;
    let jsonResponse = options.jsonResponse;

    if (message) {
      if (isRecord(message)) {
        if (!jsonResponse && "format" in message) {
          jsonResponse = message;
        }

        if (!role && typeof message.role === "string") {
          role = message.role;
        }

        if ("content" in message) {
          message = String(message.content ?? "");
        }
      }

      this.addMessage(role || "user", message);
    }

    const llmReply = await gptSubmit(this.toDictList(), this.openaiClient, {
      jsonResponse,
      model,
    });

    this.addAssistantMessage(llmReply);
    this.lastReply = llmReply;
    return llmReply;
  }

  addMessage(role: string, content: unknown): this {
    let normalizedContent: string;
    if (typeof content === "string") {
      normalizedContent = content;
    } else if (isRecord(content)) {
      normalizedContent = JSON.stringify(content, null, 2);
    } else {
      normalizedContent = String(content);
    }

    this.push({ role, content: normalizedContent });
    return this;
  }

  addUserMessage(content: unknown): this {
    return this.addMessage("user", content);
  }

  addAssistantMessage(content: unknown): this {
    return this.addMessage("assistant", content);
  }

  addSystemMessage(content: unknown): this {
    return this.addMessage("system", content);
  }

  addDeveloperMessage(content: unknown): this {
    return this.addMessage("developer", content);
  }

  async submitMessage(role: string, content: unknown): Promise<unknown> {
    this.addMessage(role, content);
    return this.submit();
  }

  async submitUserMessage(content: unknown): Promise<unknown> {
    this.addUserMessage(content);
    return this.submit();
  }

  async submitAssistantMessage(content: unknown): Promise<unknown> {
    this.addAssistantMessage(content);
    return this.submit();
  }

  async submitSystemMessage(content: unknown): Promise<unknown> {
    this.addSystemMessage(content);
    return this.submit();
  }

  async submitDeveloperMessage(content: unknown): Promise<unknown> {
    this.addDeveloperMessage(content);
    return this.submit();
  }

  getLastMessage(): ConversationMessage | null {
    return this.length ? this[this.length - 1] : null;
  }

  getMessagesByRole(role: string): ConversationMessage[] {
    return this.filter((message) => message.role === role);
  }

  getLastReplyStr(): string {
    return typeof this.lastReply === "string" ? this.lastReply : "";
  }

  getLastReplyDict(): Record<string, unknown> {
    if (!isRecord(this.lastReply)) {
      return {};
    }

    return JSON.parse(JSON.stringify(this.lastReply));
  }

  getLastReplyDictField(fieldName: string, defaultValue: unknown = null): unknown {
    if (!isRecord(this.lastReply)) {
      return null;
    }

    return this.lastReply[fieldName] ?? defaultValue;
  }

  toDictList(): ConversationMessage[] {
    return [...this];
  }
}
