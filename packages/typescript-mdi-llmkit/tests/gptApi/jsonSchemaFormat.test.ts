import { describe, expect, it } from 'vitest';

import {
  JSON_BOOLEAN,
  JSON_INTEGER,
  JSON_NUMBER,
  JSON_STRING,
  JSONSchemaFormat,
} from '../../src/gptApi/jsonSchemaFormat.js';

describe('JSONSchemaFormat', () => {
  it('expands object schema with primitive fields', () => {
    const result = JSONSchemaFormat(
      'response',
      {
        title: 'Human-readable title',
        age: JSON_INTEGER,
        score: JSON_NUMBER,
        enabled: JSON_BOOLEAN,
      },
      'Structured response payload'
    );

    expect(result).toEqual({
      format: {
        type: 'json_schema',
        strict: true,
        name: 'response',
        description: 'Structured response payload',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'age', 'score', 'enabled'],
          properties: {
            title: { type: 'string', description: 'Human-readable title' },
            age: { type: 'integer' },
            score: { type: 'number' },
            enabled: { type: 'boolean' },
          },
        },
      },
    });
  });

  it('wraps non-object root schema with provided name', () => {
    const result = JSONSchemaFormat('answer', JSON_STRING);

    expect(result).toEqual({
      format: {
        type: 'json_schema',
        strict: true,
        name: 'answer',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['answer'],
          properties: {
            answer: { type: 'string' },
          },
        },
      },
    });
  });

  it('supports enum shorthand from string list', () => {
    const result = JSONSchemaFormat('answer_enum', {
      mode: ['fast', 'safe', 'balanced'],
    });

    expect(result).toEqual({
      format: {
        type: 'json_schema',
        strict: true,
        name: 'answer_enum',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['mode'],
          properties: {
            mode: {
              type: 'string',
              enum: ['fast', 'safe', 'balanced'],
            },
          },
        },
      },
    });
  });

  it('supports metadata tuple style for array bounds and item description', () => {
    const result = JSONSchemaFormat('test_schema', {
      tags: ['Tag collection', [1, 5], ['Single tag']],
    });

    expect(result).toEqual({
      format: {
        type: 'json_schema',
        strict: true,
        name: 'test_schema',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['tags'],
          properties: {
            tags: {
              type: 'array',
              description: 'Tag collection',
              minItems: 1,
              maxItems: 5,
              items: { type: 'string', description: 'Single tag' },
            },
          },
        },
      },
    });
  });

  it('infers integer and enum via tuple metadata', () => {
    const result = JSONSchemaFormat('test_schema', {
      age: ['Age in years', [0, 120], []],
      color: ['Preferred color', ['red', 'green', 'blue'], []],
    });

    expect(result).toEqual({
      format: {
        type: 'json_schema',
        strict: true,
        name: 'test_schema',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['age', 'color'],
          properties: {
            age: {
              type: 'integer',
              description: 'Age in years',
              minimum: 0,
              maximum: 120,
            },
            color: {
              type: 'string',
              description: 'Preferred color',
              enum: ['red', 'green', 'blue'],
            },
          },
        },
      },
    });
  });

  it('supports number type with range metadata when explicitly marked', () => {
    const result = JSONSchemaFormat('test_schema', {
      confidence: ['Confidence score', [0.0, 1.0], JSON_NUMBER],
    });

    expect(result).toEqual({
      format: {
        type: 'json_schema',
        strict: true,
        name: 'test_schema',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['confidence'],
          properties: {
            confidence: {
              type: 'number',
              description: 'Confidence score',
              minimum: 0.0,
              maximum: 1.0,
            },
          },
        },
      },
    });
  });

  it('supports one-sided numeric bounds', () => {
    const result = JSONSchemaFormat('test_schema', {
      min_only: ['Minimum only', [0, null], []],
      max_only: ['Maximum only', [null, 10], []],
    });

    expect(result).toEqual({
      format: {
        type: 'json_schema',
        strict: true,
        name: 'test_schema',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['min_only', 'max_only'],
          properties: {
            min_only: {
              type: 'integer',
              description: 'Minimum only',
              minimum: 0,
            },
            max_only: {
              type: 'integer',
              description: 'Maximum only',
              maximum: 10,
            },
          },
        },
      },
    });
  });

  it('supports nested recursive schemas', () => {
    const result = JSONSchemaFormat('nested_schema', {
      groups: [
        {
          name: 'Group name',
          members: [
            {
              id: JSON_INTEGER,
              roles: ['admin', 'viewer'],
              tags: ['Tag label'],
              profile: {
                active: JSON_BOOLEAN,
                scores: [JSON_NUMBER],
              },
            },
          ],
        },
      ],
    });

    expect(result).toEqual({
      format: {
        type: 'json_schema',
        strict: true,
        name: 'nested_schema',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['groups'],
          properties: {
            groups: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['name', 'members'],
                properties: {
                  name: {
                    type: 'string',
                    description: 'Group name',
                  },
                  members: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['id', 'roles', 'tags', 'profile'],
                      properties: {
                        id: { type: 'integer' },
                        roles: { type: 'string', enum: ['admin', 'viewer'] },
                        tags: {
                          type: 'array',
                          items: { type: 'string', description: 'Tag label' },
                        },
                        profile: {
                          type: 'object',
                          additionalProperties: false,
                          required: ['active', 'scores'],
                          properties: {
                            active: { type: 'boolean' },
                            scores: {
                              type: 'array',
                              items: { type: 'number' },
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

  it('supports nested recursive schemas with inner tuple metadata', () => {
    const result = JSONSchemaFormat('nested_schema_with_metadata', {
      groups: [
        {
          name: 'Group name',
          members: [
            'Members list',
            [1, null],
            [
              {
                id: JSON_INTEGER,
                score: ['Member score', [0.0, 1.0], JSON_NUMBER],
                aliases: ['Alias list', [0, 3], ['Alias text']],
                history: [
                  {
                    year: ['Year', [1900, 2100], JSON_INTEGER],
                    tags: ['History tags', [0, 5], ['Tag text']],
                  },
                ],
              },
            ],
          ],
        },
      ],
    });

    expect(result).toEqual({
      format: {
        type: 'json_schema',
        strict: true,
        name: 'nested_schema_with_metadata',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['groups'],
          properties: {
            groups: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['name', 'members'],
                properties: {
                  name: {
                    type: 'string',
                    description: 'Group name',
                  },
                  members: {
                    type: 'array',
                    description: 'Members list',
                    minItems: 1,
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['id', 'score', 'aliases', 'history'],
                      properties: {
                        id: { type: 'integer' },
                        score: {
                          type: 'number',
                          description: 'Member score',
                          minimum: 0.0,
                          maximum: 1.0,
                        },
                        aliases: {
                          type: 'array',
                          description: 'Alias list',
                          minItems: 0,
                          maxItems: 3,
                          items: {
                            type: 'string',
                            description: 'Alias text',
                          },
                        },
                        history: {
                          type: 'array',
                          items: {
                            type: 'object',
                            additionalProperties: false,
                            required: ['year', 'tags'],
                            properties: {
                              year: {
                                type: 'integer',
                                description: 'Year',
                                minimum: 1900,
                                maximum: 2100,
                              },
                              tags: {
                                type: 'array',
                                description: 'History tags',
                                minItems: 0,
                                maxItems: 5,
                                items: {
                                  type: 'string',
                                  description: 'Tag text',
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
        },
      },
    });
  });

  it('throws for unsupported schema values', () => {
    expect(() => JSONSchemaFormat('test_schema', { bad: Symbol('x') })).toThrow(
      'Unrecognized type for schema value'
    );
  });
});
