import { describe, expect, it } from "vitest";

import {
  JSON_BOOLEAN,
  JSON_INTEGER,
  JSON_NUMBER,
  JSON_STRING,
  JSONSchemaFormat,
} from "../src/gpt_api/json_schema_format.js";

describe("JSONSchemaFormat", () => {
  it("expands object schema with primitive fields", () => {
    const result = JSONSchemaFormat(
      {
        title: "Human-readable title",
        age: JSON_INTEGER,
        score: JSON_NUMBER,
        enabled: JSON_BOOLEAN,
      },
      {
        name: "response",
        description: "Structured response payload",
      },
    );

    expect(result).toEqual({
      format: {
        type: "json_schema",
        strict: true,
        name: "response",
        description: "Structured response payload",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["title", "age", "score", "enabled"],
          properties: {
            title: { type: "string", description: "Human-readable title" },
            age: { type: "integer" },
            score: { type: "number" },
            enabled: { type: "boolean" },
          },
        },
      },
    });
  });

  it("wraps non-object root schema with provided name", () => {
    const result = JSONSchemaFormat(JSON_STRING, { name: "answer" });

    expect(result).toEqual({
      format: {
        type: "json_schema",
        strict: true,
        name: "answer",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["answer"],
          properties: {
            answer: { type: "string" },
          },
        },
      },
    });
  });

  it("supports enum shorthand from string list", () => {
    const result = JSONSchemaFormat(
      {
        mode: ["fast", "safe", "balanced"],
      },
      { name: "answer_enum" },
    );

    expect(result).toEqual({
      format: {
        type: "json_schema",
        strict: true,
        name: "answer_enum",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["mode"],
          properties: {
            mode: {
              type: "string",
              enum: ["fast", "safe", "balanced"],
            },
          },
        },
      },
    });
  });

  it("supports metadata tuple style for array bounds and item description", () => {
    const result = JSONSchemaFormat(
      {
        tags: ["Tag collection", [1, 5], ["Single tag"]],
      },
      { name: "test_schema" },
    );

    expect(result).toEqual({
      format: {
        type: "json_schema",
        strict: true,
        name: "test_schema",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["tags"],
          properties: {
            tags: {
              type: "array",
              description: "Tag collection",
              minItems: 1,
              maxItems: 5,
              items: { type: "string", description: "Single tag" },
            },
          },
        },
      },
    });
  });

  it("infers integer and enum via tuple metadata", () => {
    const result = JSONSchemaFormat(
      {
        age: ["Age in years", [0, 120], []],
        color: ["Preferred color", ["red", "green", "blue"], []],
      },
      { name: "test_schema" },
    );

    expect(result).toEqual({
      format: {
        type: "json_schema",
        strict: true,
        name: "test_schema",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["age", "color"],
          properties: {
            age: {
              type: "integer",
              description: "Age in years",
              minimum: 0,
              maximum: 120,
            },
            color: {
              type: "string",
              description: "Preferred color",
              enum: ["red", "green", "blue"],
            },
          },
        },
      },
    });
  });

  it("supports nested recursive schemas", () => {
    const result = JSONSchemaFormat(
      {
        groups: [
          {
            name: "Group name",
            members: [
              {
                id: JSON_INTEGER,
                roles: ["admin", "viewer"],
                tags: ["Tag label"],
                profile: {
                  active: JSON_BOOLEAN,
                  scores: [JSON_NUMBER],
                },
              },
            ],
          },
        ],
      },
      { name: "nested_schema" },
    );

    expect(result).toEqual({
      format: {
        type: "json_schema",
        strict: true,
        name: "nested_schema",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["groups"],
          properties: {
            groups: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["name", "members"],
                properties: {
                  name: {
                    type: "string",
                    description: "Group name",
                  },
                  members: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: ["id", "roles", "tags", "profile"],
                      properties: {
                        id: { type: "integer" },
                        roles: { type: "string", enum: ["admin", "viewer"] },
                        tags: {
                          type: "array",
                          items: { type: "string", description: "Tag label" },
                        },
                        profile: {
                          type: "object",
                          additionalProperties: false,
                          required: ["active", "scores"],
                          properties: {
                            active: { type: "boolean" },
                            scores: {
                              type: "array",
                              items: { type: "number" },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it("throws for unsupported schema values", () => {
    expect(() => JSONSchemaFormat({ bad: Symbol("x") })).toThrow(
      "Unrecognized type for schema value",
    );
  });
});
