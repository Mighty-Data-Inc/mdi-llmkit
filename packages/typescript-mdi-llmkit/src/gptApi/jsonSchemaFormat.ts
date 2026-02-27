export const JSON_INTEGER = Symbol('JSON_INTEGER');
export const JSON_NUMBER = Symbol('JSON_NUMBER');
export const JSON_STRING = String;
export const JSON_BOOLEAN = Boolean;

export interface JSONSchemaFormatResult extends Record<string, unknown> {
  format: {
    type: 'json_schema';
    strict: true;
    name?: string;
    description?: string;
    schema: Record<string, unknown>;
  };
}

const TYPEMAP = new Map<unknown, string>([
  [JSON_STRING, 'string'],
  [JSON_INTEGER, 'integer'],
  [JSON_NUMBER, 'number'],
  [JSON_BOOLEAN, 'boolean'],
  [String, 'string'],
  [Boolean, 'boolean'],
  [BigInt, 'integer'],
  [Number, 'number'],
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function isNumericRangeArray(
  value: unknown
): value is [number | null, number | null] {
  if (!Array.isArray(value) || value.length !== 2) {
    return false;
  }
  const [min, max] = value;
  const minValid = min === null || typeof min === 'number';
  const maxValid = max === null || typeof max === 'number';

  return (
    minValid && maxValid && (typeof min === 'number' || typeof max === 'number')
  );
}

function isTupleMetadataArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || value.length < 2) {
    return false;
  }
  if (isStringArray(value)) {
    return false;
  }

  return value.some(
    (item) => typeof item === 'string' || isNumericRangeArray(item)
  );
}

function inferPrimitiveType(schemaValue: unknown): string | null {
  const direct = TYPEMAP.get(schemaValue);
  if (direct) {
    return direct;
  }

  if (typeof schemaValue === 'string') {
    return 'string';
  }
  if (typeof schemaValue === 'boolean') {
    return 'boolean';
  }
  if (typeof schemaValue === 'bigint') {
    return 'integer';
  }
  if (typeof schemaValue === 'number') {
    return Number.isInteger(schemaValue) ? 'integer' : 'number';
  }

  return null;
}

function convertSchemaRecursive(subschema: unknown): Record<string, unknown> {
  let subschemaDescription = '';
  let subschemaEnum: string[] = [];
  let subschemaNumrange: [number | null, number | null] = [null, null];
  let subschemaValue: unknown = subschema;

  if (isTupleMetadataArray(subschema)) {
    for (const item of subschema) {
      if (!item) {
        subschemaValue = item;
        continue;
      }

      if (typeof item === 'string') {
        subschemaDescription = item;
        continue;
      }

      if (isStringArray(item) && item.length >= 2) {
        subschemaEnum = item;
        continue;
      }

      if (isNumericRangeArray(item)) {
        subschemaNumrange = item;
        continue;
      }

      subschemaValue = item;
    }
  }

  if (
    (Array.isArray(subschemaValue) && isTupleMetadataArray(subschemaValue)) ||
    (Array.isArray(subschemaValue) && subschemaValue.length === 0)
  ) {
    if (subschemaEnum.length > 0) {
      subschemaValue = JSON_STRING;
    }

    const [nr0, nr1] = subschemaNumrange;
    if (nr0 !== null || nr1 !== null) {
      if (
        (typeof nr0 === 'number' && !Number.isInteger(nr0)) ||
        (typeof nr1 === 'number' && !Number.isInteger(nr1))
      ) {
        subschemaValue = JSON_NUMBER;
      } else {
        subschemaValue = JSON_INTEGER;
      }
    }
  }

  const result: Record<string, unknown> = {};

  if (isRecord(subschemaValue)) {
    result.type = 'object';
    if (subschemaDescription) {
      result.description = subschemaDescription;
    }
    result.additionalProperties = false;

    const keys = Object.keys(subschemaValue);
    result.required = keys;

    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(subschemaValue)) {
      if (typeof value === 'string') {
        properties[key] = { type: 'string', description: value };
      } else {
        properties[key] = convertSchemaRecursive(value);
      }
    }

    result.properties = properties;
  } else if (Array.isArray(subschemaValue)) {
    if (subschemaValue.length >= 2 && isStringArray(subschemaValue)) {
      result.type = 'string';
      subschemaEnum = subschemaValue;
    } else {
      result.type = 'array';
      if (subschemaDescription) {
        result.description = subschemaDescription;
      }
      if (subschemaNumrange[0] !== null) {
        result.minItems = subschemaNumrange[0];
      }
      if (subschemaNumrange[1] !== null) {
        result.maxItems = subschemaNumrange[1];
      }

      const arrayExemplar = subschemaValue[0];
      if (typeof arrayExemplar === 'string') {
        result.items = { type: 'string', description: arrayExemplar };
      } else {
        result.items = convertSchemaRecursive(arrayExemplar);
      }
    }
  } else {
    const primitiveType = inferPrimitiveType(subschemaValue);
    if (!primitiveType) {
      throw new Error(
        `Unrecognized type for schema value: ${String(subschemaValue)}`
      );
    }
    result.type = primitiveType;
    if (subschemaDescription) {
      result.description = subschemaDescription;
    }
  }

  if (subschemaEnum.length) {
    result.enum = subschemaEnum;
  }

  if (result.type === 'integer' || result.type === 'number') {
    if (subschemaNumrange[0] !== null) {
      result.minimum = subschemaNumrange[0];
    }
    if (subschemaNumrange[1] !== null) {
      result.maximum = subschemaNumrange[1];
    }
  }

  return result;
}

export function JSONSchemaFormat(
  name: string,
  schema: unknown,
  description?: string
): JSONSchemaFormatResult {
  const result: JSONSchemaFormatResult = {
    format: {
      type: 'json_schema',
      strict: true,
      name,
      schema: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  };

  if (description) {
    result.format.description = description;
  }

  let converted = convertSchemaRecursive(schema);
  if (converted.type !== 'object') {
    converted = {
      type: 'object',
      required: [name],
      additionalProperties: false,
      properties: {
        [name]: converted,
      },
    };
  }

  result.format.schema = converted;
  return result;
}
