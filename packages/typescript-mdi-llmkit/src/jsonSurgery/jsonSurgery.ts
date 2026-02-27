/**
 * `jsonSurgery` performs iterative, AI-guided edits to a JSON-compatible object.
 *
 * The module exposes:
 * - {@link jsonSurgery}: the main entry point that applies requested modifications.
 * - {@link JSONSurgeryOptions}: callbacks and limits for validation, progress, and retries.
 * - {@link JSONSurgeryError}: enriched error type that includes the last object state.
 *
 * High-level flow:
 * 1. Deep-copy the input object (the original is never mutated).
 * 2. Send the current object state plus user instructions to the model.
 * 3. Receive one or more structured operations targeting JSON paths.
 * 4. Apply operations and continue iteratively until validation succeeds.
 *
 * Supported operation types include assign, append, insert, delete, and rename.
 * Values are transferred through constrained JSON schemas so the model can express
 * primitives, objects, and arrays safely in a structured format.
 *
 * Callers can provide:
 * - `schemaDescription` to describe expected object shape/constraints,
 * - `skippedKeys` to hide sensitive or noisy fields from model context,
 * - `onValidateBeforeReturn` to enforce app-specific validation,
 * - `onWorkInProgress` for per-iteration monitoring/intervention,
 * - `giveUpAfterSeconds` / `giveUpAfterIterations` as soft stop conditions.
 */
import { OpenAI } from 'openai';
import {
  navigateToJSONPath,
  placemarkedJSONStringify,
} from './placemarkedJSON.js';
import { GptConversation } from '../gptApi/gptConversation.js';

const JSON_SCHEMA_ANYOF_PRIMITIVE_OR_EMPTY = [
  {
    type: 'object',
    properties: {
      string_value: { type: 'string' },
    },
    required: ['string_value'],
    additionalProperties: false,
  },
  {
    type: 'object',
    properties: {
      numerical_value: { type: 'number' },
    },
    required: ['numerical_value'],
    additionalProperties: false,
  },
  {
    type: 'object',
    properties: {
      boolean_value: { type: 'boolean' },
    },
    required: ['boolean_value'],
    additionalProperties: false,
  },
  {
    type: 'object',
    properties: {
      null_value: { type: 'null' },
    },
    required: ['null_value'],
    additionalProperties: false,
  },
  {
    type: 'object',
    properties: {
      empty_object: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    required: ['empty_object'],
    additionalProperties: false,
  },
  {
    type: 'object',
    properties: {
      empty_array: {
        type: 'array',
        items: { type: 'null' },
        maxItems: 0,
      },
    },
    required: ['empty_array'],
    additionalProperties: false,
  },
];

const JSON_SCHEMA_SET_VALUE = {
  anyOf: [
    ...JSON_SCHEMA_ANYOF_PRIMITIVE_OR_EMPTY,
    {
      type: 'object',
      properties: {
        populated_array: {
          type: 'array',
          items: { anyOf: JSON_SCHEMA_ANYOF_PRIMITIVE_OR_EMPTY },
        },
      },
      required: ['populated_array'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        populated_object: {
          type: 'object',
          properties: {
            key_value_pairs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  key: { type: 'string' },
                  value: { anyOf: JSON_SCHEMA_ANYOF_PRIMITIVE_OR_EMPTY },
                },
                required: ['key', 'value'],
                additionalProperties: false,
              },
            },
          },
          required: ['key_value_pairs'],
          additionalProperties: false,
        },
      },
      required: ['populated_object'],
      additionalProperties: false,
    },
  ],
};

const JSON_SCHEMA_JSON_PATH = {
  type: 'array',
  items: {
    anyOf: [{ type: 'string' }, { type: 'number' }],
  },
};

const unpackValueFromSetValueSchema = (value: any): any => {
  // Now we gotta unpack the value field.
  if ('string_value' in value) {
    return value.string_value;
  } else if ('numerical_value' in value) {
    return value.numerical_value;
  } else if ('boolean_value' in value) {
    return value.boolean_value;
  } else if ('null_value' in value) {
    return null;
  } else if ('empty_object' in value) {
    return {};
  } else if ('empty_array' in value) {
    return [];
  } else if ('populated_array' in value) {
    // Recursively unpack the elements of the array as well,
    // since they will also be wrapped in the same schema.
    return value.populated_array.map(unpackValueFromSetValueSchema);
  } else if ('populated_object' in value) {
    const obj: any = {};
    value.populated_object.key_value_pairs.forEach((pair: any) => {
      obj[pair.key] = unpackValueFromSetValueSchema(pair.value);
    });
    return obj;
  } else {
    throw new Error(`Invalid value object: ${JSON.stringify(value)}`);
  }
};

/**
 * Optional configuration for {@link jsonSurgery}.
 * @property schemaDescription Optional schema description for the JSON object. This can be written
 * in JSON Schema format, or as a textual explanation. It's passed as a string to the AI and has
 * no direct enforcement semantics.
 * @property skippedKeys Optional array of key names to skip/ignore in the AI-visible JSON. This
 * is useful for omitting large or sensitive fields (IDs, timestamps, binary data, etc.) that are
 * often irrelevant to the requested modifications.
 * @property onValidateBeforeReturn Optional callback that validates and/or corrects the object before
 * final return. It receives the current object and resolves to:
 * - objCorrected: a corrected object to continue with
 * - errors: lingering validation errors that still need to be addressed
 * @property onWorkInProgress Optional callback that's called after each iteration with the
 * current state of the object. Useful for logging or monitoring progress. Can optionally return
 * a promise that resolves into a modified version of the object, in case the caller wants to
 * intervene or adjust the object mid-process. onWorkInProgress is a good place to implement
 * custom logging, metrics, or even dynamic adjustments to the object during processing. It's also
 * a place from whence you can throw an exception if needed to abort processing.
 * @property giveUpAfterSeconds Optional soft-limit for total processing time, in seconds.
 * @property giveUpAfterIterations Optional soft-limit for iteration count.
 *
 * If `objCorrected` is returned, that corrected object is used.
 * If `errors` is missing or empty, the object is treated as valid.
 */
export type JSONSurgeryOptions = {
  schemaDescription?: string;
  skippedKeys?: string[];
  onValidateBeforeReturn?: (
    obj: any
  ) => Promise<{ objCorrected?: any; errors?: string[] } | undefined>;
  onWorkInProgress?: (obj: any) => Promise<any | undefined>;
  giveUpAfterSeconds?: number;
  giveUpAfterIterations?: number;
};

/**
 * Error type reserved for failures from {@link jsonSurgery}.
 * `obj` contains the object being modified, captured in whatever state it was
 * left in at the moment the exception was thrown.
 */
export class JSONSurgeryError extends Error {
  obj: any;
  constructor(message: string, obj: any, options?: ErrorOptions) {
    super(message, options);
    this.name = 'JSONSurgeryError';
    this.obj = JSON.parse(JSON.stringify(obj));
  }
}

/**
 * Modifies a JSON object based on modification instructions using OpenAI's API.
 * Does NOT modify the original object in place; instead, works with a copy and returns
 * the modified copy.
 * @param openai_client The OpenAI client to use for modifications
 * @param obj The JSON object to modify
 * @param modificationInstructions Instructions describing the modifications to apply
 * @param options Optional configuration object. See {@link JSONSurgeryOptions}.
 * @returns A copy of the original object, modified according to the instructions.
 */
export const jsonSurgery = async (
  openai_client: OpenAI,
  obj: any,
  modificationInstructions: string,
  options?: JSONSurgeryOptions
): Promise<any> => {
  options = options || {};

  if (obj === null || obj === undefined) {
    throw new TypeError('The provided object is null or undefined', obj);
  }

  // DO NOT modify the originalObject in place.
  obj = JSON.parse(JSON.stringify(obj));

  const timeStarted = Date.now();

  const convoBase = new GptConversation([], { openaiClient: openai_client });
  convoBase.addDeveloperMessage(`
You are an expert software developer AI assistant.
The user will show you a JSON object and provide modification instructions.
The modification instructions might not be entirely straightforward, so the
process of implementing these changes may require careful thought and planning.
Through a series of individual insertions, deletions, or updates, you will modify the JSON object
to satisfy the user's instructions.
You will not be doing this alone. I will be holding your hand through the entire process,
providing feedback and guidance after each modification. You will also be getting verification
from the system itself, to ensure that your modifications are valid and correct.
`);

  convoBase.addUserMessage(`

Here is the JSON object to modify, in its original state prior to any modifications.
It has been formatted with placemarks (comments) to indicate the positions of elements for
better readability and easier navigation.

---

${placemarkedJSONStringify(obj, 2, options.skippedKeys)}
`);

  if (options.schemaDescription) {
    convoBase.addUserMessage(`
Here is the schema definition for the JSON object, so that you know the expected structure
and data types of its properties. Make sure that your final results conform to this schema.
DO NOT introduce any properties or values that violate this schema!

---

${options.schemaDescription}
`);
  }

  convoBase.addUserMessage(`

Here are the modification instructions.

---

${modificationInstructions}
`);

  convoBase.addDeveloperMessage(`
Before we begin, please provide a detailed plan outlining the specific steps you will take to
implement the requested modifications to the JSON object. This plan should break down the
modification instructions into a clear sequence of actions that you will perform, where each
action corresponds to a specific change in the JSON structure -- either the adding, removing,
or updating of specific individual properties or values.

Your response should start with "Modification Plan:" followed by the detailed plan.
`);
  await convoBase.submit();

  convoBase.addSystemMessage(`
NAVIGATING THE JSON OBJECT AND JSON PATHS

You have probably already noticed that the JSON object is annotated with placemarks
(comments) to indicate the positions of objects and indexes for better readability.
The syntax of these placemarks is quite straightforward, as it follows JavaScript/TypeScript
notation for accessing properties and array elements.

E.g. root["items"][0]["keywords"][1] refers to the second element of the "keywords" array
of the first element of the "items" array in the root object.

When prompted for a location in the JSON object, you'll emit a JSON list that corresponds
to the path to that location, where each element in the list is either a property name (string)
or an array index (number).

Thus, the path to root["items"][0]["keywords"][1] would be represented as:
json_path = ["items", 0, "keywords", 1]
`);

  convoBase.addSystemMessage(`
INSTRUCTIONS FOR MODIFICATION OPERATIONS

You will be implementing the modification plan through a series of modification operations.
By incrementally applying these operations, we will arrive at the final modified JSON object that
satisfies the modification instructions.

We will be permitted to take multiple passes over the JSON object, and make multiple
modifications, so don't feel obligated to get everything right in the first few steps.
We will have plenty of opportunities to iteratively develop the final result. Your initial list
of operations to execute doesn't necessarily need to achieve the final result; if it merely
"walks" towards the final result, that's perfectly fine, as we'll be able to continue to "walk"
further towards the final result in subsequent iterations.

Structure of a Modification Operation:

- **json_path_of_parent**: A JSON path indicating the location in the JSON object where the
    modification should be applied. We call this the "parent" location because we specify
    the key or index within the parent later. For example, if you want to set the string
    property "foo" to the value "bar" on the root object (i.e. root["foo"]="bar"), then
    json_path_of_parent would be an empty list [], since the parent of "foo" is the root object.
    If you want to append a new string value into the "keywords" array of the first
    element of the "items" array (i.e. root["items"][0]["keywords"].push("new_keyword")), then
    json_path_of_parent would be ["items", 0, "keywords"], since the parent of the new element
    is the "keywords" array itself. The syntax of the json_path should follow the same notation
    as described in the "Navigating the JSON Object and JSON Paths" section above.

- **key_or_index**: The key (string) or array index (number) of the property or element to modify.
    If the parent location (json_path_of_parent) is an object, then this will be a string key.
    If the parent location is an array, then this will be a numeric index.
    SPECIAL: If you're using the "append" action (see below) to add a new element to the end of
    an array, then key_or_index is ignored; set it to -1 to indicate to yourself that it's
    irrelevant.

- **action**: The type of modification to perform. This can be one of the following values:
    - "delete": Delete the specified property or array element. (The "data" field is ignored,
        and should be set to null.) This "delete" action is functionally equivalent to
        \`delete parent[key]\` for objects, or \`parent.splice(index, 1)\` for arrays.
    - "assign": Set the property or element to a new value. If the parent is an array, then the
        "assign" action will replace the existing element at the specified index. If the parent
        is an object, then the "assign" action will set the value of the specified key, replacing
        any existing value for that key if it already exists, or creating a new key-value pair if
        the key does not already exist. This is functionally equivalent to:
            \`parent[key] = data\` for objects, or
            \`parent[index] = data\` for arrays.
    - "append": Applicable only when the parent object is an array. Append a new element to the
        end of the array. The "key_or_index" field is ignored. This is functionally equivalent to:
            \`parent.push(data)\`.
    - "insert": Applicable only when the parent object is an array. Insert a new element at the
        specified index in the array. This is functionally equivalent to:
            \`parent.splice(index, 0, data)\`.
    - "rename": Applicable only when the parent object is an object. Rename a property from the
        old key name (specified in "key_or_index") to a new key name. The "new_key_name" field
        (see below) *must* be provided. The "data" field is ignored for this action; you should
        just set it to null. This is functionally equivalent to:
            \`parent[new_key_name] = parent[key_or_index]; delete parent[key_or_index]\`.

- **new_key_name**: Applicable only for the "rename" action. This field specifies the new key name
    to rename a property to. For all other actions, this field is ignored and should just be set
    to an empty string.

- **data**: The new value to set for "assign", "append", or "insert" actions. This field comes in
    the following forms:

    - **null**: You should set the data field to null when the action does not require a value,
        such as "delete" or "rename". For all other actions, the data field cannot be null.

    - **inline_value**: You explicitly write out the value to set. The value you construct will be
        one of the following:
        - A primitive value (string, number, boolean, null)
        - An empty object ({}). This is useful for gradually building up complex objects through
            a series of subsequent modifications.
        - An empty array ([]). This is useful for gradually building up complex collections
            through a series of subsequent modifications.
        - An array whose elements are all either primitive values or empty objects/arrays. This is
            useful for adding multiple related elements at once. If the array contains empty
            objects/arrays, you can fill these in with actual values in subsequent modifications,
            if needed.
        - An object whose values are all either primitive values or empty objects/arrays. Again,
            just like with arrays, if the object contains empty objects/arrays, you can fill these
            in with actual values in subsequent modifications, if needed.
        Note that "value" cannot recursively describe deeply nested structures in one step; it can
        only describe at most a single layer of nesting. That's okay; you can build up complex
        nested structures through a series of modifications, gradually filling in more and more
        details with each modification. Just make sure to provide detailed notes about your plans
        and intentions with each modification, so that we can keep track of the overall plan and
        ensure that we're on the right track.

    - **json_path_of_copy_source**: If you need to construct a deeply nested object, and there
        happens to be a source object or array elsewhere in the JSON that already has a very
        similar (or identical) structure, you can specify the JSON path to that source object
        or array here. This can be a handy shortcut for creating complex structures without
        having to manually specify every detail. PRO TIP: This is also a great way to **move**
        existing structures around within the JSON, by copying from one path and then deleting
        the original -- this makes moving a structure from one place to another a two-step process
        instead of a long series of inline_value assignments.
`);

  convoBase.addDeveloperMessage(`Alrighty then. Let's get to work!`);

  const operationsDoneSoFar: string[] = [];
  let operationLast = '(nothing, we just started)';
  let operationNext = '(nothing, we just started)';
  let operationLastWasSuccessful = true;
  let numIterations = 0;

  while (true) {
    const convo = convoBase.clone();

    numIterations++;
    if (numIterations > 1) {
      // If we have a work-in-progress callback, call it with the current state.
      if (options?.onWorkInProgress) {
        const objWipResult = await options.onWorkInProgress(
          JSON.parse(JSON.stringify(obj))
        );
        if (objWipResult !== undefined) {
          obj = JSON.parse(JSON.stringify(objWipResult));
        }
      }

      const secondsElapsed = Math.floor((Date.now() - timeStarted) / 1000);
      if (
        options?.giveUpAfterSeconds &&
        secondsElapsed > options.giveUpAfterSeconds
      ) {
        throw new JSONSurgeryError(
          `Giving up after maximum time reached. ` +
            `Seconds elapsed: ${secondsElapsed} ` +
            `Maximum allowed: ${options.giveUpAfterSeconds}`,
          obj
        );
      }

      if (
        options?.giveUpAfterIterations &&
        numIterations > options.giveUpAfterIterations
      ) {
        throw new JSONSurgeryError(
          `Giving up after ${options.giveUpAfterIterations}. Maximum iterations reached. `,
          obj
        );
      }

      convo.addUserMessage(`
CURRENT STATUS:
We've been processing for ${secondsElapsed} seconds.
We've performed ${operationsDoneSoFar.length} operations across ${numIterations - 1} iterations.
`);
      if (operationsDoneSoFar.length > 0) {
        let msgOpsSoFar = ``;
        for (let i = 0; i < operationsDoneSoFar.length; i++) {
          msgOpsSoFar += `${i + 1}. ${operationsDoneSoFar[i]}\n`;
        }
        convo.addUserMessage(`
Here are the operations that we've performed so far:
${msgOpsSoFar}
`);
      }

      convo.addUserMessage({
        role: 'user',
        content: `
Here is the JSON object in its current state, with our modifications up to this point applied.

---

${placemarkedJSONStringify(obj, 2, options.skippedKeys)}
`,
      });

      convo.addUserMessage({
        role: 'user',
        content: `
Just to help re-establish context from previous iterations, here is the last operation we
performed on this JSON object:
${operationLast}

Here's what we were planning to do next:
${operationNext}
`,
      });

      if (!operationLastWasSuccessful) {
        convo.addDeveloperMessage({
          role: 'user',
          content: `
!CRITICAL: The last operation we attempted FAILED! DO NOT DO THE SAME OPERATION AGAIN!
Think of a *different* operation to perform. Think of a different *way* to perform
the modifications that we need to make. Break them up over different steps, or
re-think your approach, or SOMETHING. Just DO NOT keep trying to do the same thing
over and over again expecting a different result.
`,
        });
      }
    }

    convo.addDeveloperMessage(`
Refer to the "Instructions for Modification Operations" section above for the
structure of a modification operation.

Based on the overall modification plan and the current state of the JSON object,
determine and describe the next modifications to apply to the JSON object. Your
output for now should just be plain English. Later, when I ask you to, you'll
formalize it into a JSON object -- but for now, just talk your way through it.

If the modification instructions require multiple changes to the JSON object, you can describe
multiple modifications to apply in this step. You can also break down a complex modification into
a series of simpler modifications that can be applied incrementally, if that makes it easier to
implement the overall modification instructions correctly. Just make sure to be very clear and
detailed in describing your intended modifications, so that we can ensure that we're on the
right track and that the modifications you propose are correctly implementing the modification
instructions.

If the modification instructions have already been fully satisfied and no further modifications
are needed, then just say that we're done and don't propose any further modifications.
`);
    await convo.submit();

    await convo.submit(undefined, undefined, {
      jsonResponse: {
        format: {
          type: 'json_schema',
          name: 'json_object_modifications',
          description: `
A JSON formalization of the next set of modifications to apply to the JSON object,
as we have just determined and described. If there are multiple modifications to apply,
you can include all of them in this JSON object. If there are no modifications to apply
because the modification instructions have already been fully satisfied, then set the
"modifications" field to an empty list.
`,
          schema: {
            type: 'object',
            properties: {
              modifications: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    json_path_of_parent: JSON_SCHEMA_JSON_PATH,
                    key_or_index: {
                      anyOf: [{ type: 'string' }, { type: 'number' }],
                    },
                    action: {
                      type: 'string',
                      enum: ['assign', 'delete', 'append', 'insert', 'rename'],
                    },
                    new_key_name: { type: 'string' },
                    data: {
                      anyOf: [
                        {
                          type: 'null',
                          description:
                            'Data field should be null for "delete" and "rename" actions.',
                        },
                        {
                          type: 'object',
                          properties: {
                            inline_value: {
                              ...JSON_SCHEMA_SET_VALUE,
                              description: `
The new value to set for "assign", "append", or "insert" actions.
For "delete" and "rename" actions, this field is ignored and should be set to null.
This can be one of the following:
- A primitive value (string, number, boolean, null)
- An empty object ({}).
- An empty array ([]).
- An array whose elements are all either primitive values or empty objects/arrays.
- An object(*) whose values are all either primitive values or empty objects/arrays.
(*) NOTE: Due to some limitations in our JSON schema processor, we cannot have you
provide an object with arbitrary keys directly. Instead, please provide an array of
key-value pair objects. I know it *looks like* an array, but we'll interpret it as
an object.
`,
                            },
                          },
                          required: ['inline_value'],
                          additionalProperties: false,
                        },
                        {
                          type: 'object',
                          properties: {
                            json_path_of_copy_source: JSON_SCHEMA_JSON_PATH,
                          },
                          required: ['json_path_of_copy_source'],
                          additionalProperties: false,
                        },
                      ],
                    },
                  },
                  required: [
                    'json_path_of_parent',
                    'key_or_index',
                    'action',
                    'new_key_name',
                    'data',
                  ],
                  additionalProperties: false,
                },
              },
            },
            required: ['modifications'],
            additionalProperties: false,
          },
          strict: true,
        },
      },
    });

    const modifications = convo.getLastReplyDictField('modifications') as any[];
    if (!modifications || modifications.length === 0) {
      // No modifications proposed.
      // Presumably this means that all modification instructions have been fully satisfied.
      // We might be done!

      let validationErrors: string[] = [];
      if (options.onValidateBeforeReturn) {
        const validationResult = await options.onValidateBeforeReturn(
          JSON.parse(JSON.stringify(obj))
        );
        if (validationResult) {
          if (validationResult.objCorrected) {
            // The validation function corrected the object.
            // (Maybe it *also* found errors, but it corrected what it could.)
            obj = validationResult.objCorrected;
          }
          if (validationResult.errors && validationResult.errors.length > 0) {
            // The validation function found errors in the object.
            // (Maybe it *also* corrected what it could, but these errors remain.)
            validationErrors = validationResult.errors;
          }
        }
      }

      if (validationErrors.length === 0) {
        return obj;
      }
      // Kick it back for further processing.
      operationLastWasSuccessful = false;
      let actionDesc = `
ERROR: Validation failure on attempted exit.
We thought we had finished processing, but the object didn't pass an automated
validation check. This is often the result of undocumented requirements,
and isn't necessarily because you did anything wrong. Nonetheless, these remaining
issues must be addressed before we can consider the object valid.)

The validator returned the following errors:

- ${validationErrors.join('\n -')}
`;

      operationsDoneSoFar.push(actionDesc);
      operationLast = actionDesc;
      operationNext = `Fix these validation errors, and try to exit again when they're done.`;
      // NOTE: We might want to submit an LLM call here to get more detailed guidance
      // for operationNext, but in practice that hasn't been necessary. Let's not fix
      // something that isn't broken, and let's not burn tokens when a canned response
      // suffices.

      continue;
    }

    const objModified = JSON.parse(JSON.stringify(obj));
    for (const modification of modifications) {
      try {
        let { json_path_of_parent, key_or_index, action, new_key_name, data } =
          modification;

        let value: any = null;

        if (data) {
          if (data.inline_value) {
            // We're kinda abusing TypeScript's leniency with the "any" type here.
            value = unpackValueFromSetValueSchema(data.inline_value);
          } else if (data.json_path_of_copy_source) {
            // Handle the case where the value is a reference to another part of the JSON object.
            const sourcePath = data.json_path_of_copy_source;
            const sourceNavResult = navigateToJSONPath(objModified, sourcePath);
            value = JSON.parse(JSON.stringify(sourceNavResult.pathTarget));
          }
        }

        if (!json_path_of_parent) {
          throw new Error(
            `Missing required field "json_path_of_parent" in modification.`
          );
        }
        if (!action) {
          throw new Error(`Missing required field "action" in modification.`);
        }

        if (action === 'rename' && !new_key_name) {
          throw new Error(
            `Missing required field "new_key_name" for "rename" action in modification.`
          );
        }

        const jsonPathNavResult = navigateToJSONPath(
          objModified,
          json_path_of_parent
        );

        const targetParent = jsonPathNavResult.pathTarget;

        // targetParent must be either an object or an array. It cannot be
        // null, undefined, or a primitive value.
        if (
          !targetParent ||
          !(typeof targetParent === 'object' || Array.isArray(targetParent))
        ) {
          throw new Error(
            `Error: json_path_of_parent points to something that is neither an object ` +
              `nor an array. It must point to either an object or an array. Instead, ` +
              `${json_path_of_parent} points to the value: ${JSON.stringify(targetParent)}`
          );
        }

        // Make sure that targetParent is an array if the action is an array-specific action,
        // and is an object if the action is an object-specific action.

        if (action === 'assign') {
          targetParent[key_or_index] = value;
        } else if (action === 'delete') {
          if (Array.isArray(targetParent)) {
            targetParent.splice(key_or_index as number, 1);
          } else {
            delete targetParent[key_or_index];
          }
        } else if (action === 'append') {
          if (!Array.isArray(targetParent)) {
            throw new Error(
              `Error: "append" action can only be applied to arrays. However, ` +
                `the target location specified by json_path_of_parent points to a non-array value: ` +
                `${JSON.stringify(targetParent)}`
            );
          }
          targetParent.push(value);
        } else if (action === 'insert') {
          if (!Array.isArray(targetParent)) {
            throw new Error(
              `Error: "insert" action can only be applied to arrays. However, ` +
                `the target location specified by json_path_of_parent points to a non-array value: ` +
                `${JSON.stringify(targetParent)}`
            );
          }
          targetParent.splice(key_or_index as number, 0, value);
        } else if (action === 'rename') {
          if (Array.isArray(targetParent)) {
            throw new Error(
              `Error: "rename" action can only be applied to objects. However, ` +
                `the target location specified by json_path_of_parent points to an array value: ` +
                `${JSON.stringify(targetParent)}`
            );
          }
          targetParent[new_key_name] = targetParent[key_or_index];
          delete targetParent[key_or_index];
        } else {
          throw new Error(`Unknown action: ${action}`);
        }

        convo.addSystemMessage(`
The following modification was applied to the JSON object without any errors:

json_path_of_parent: ${JSON.stringify(json_path_of_parent)}
key_or_index: ${JSON.stringify(key_or_index)}
action: ${JSON.stringify(action)}
new_key_name: ${JSON.stringify(new_key_name)}
value: ${JSON.stringify(value, null, 2)}
`);
      } catch (error) {
        convo.addSystemMessage(`
An error occurred while attempting to apply the proposed modification:
${(error as Error).message}
`);
      }
    }

    // Verify the modified object with the LLM
    convo.addUserMessage(`
Here is the JSON object after applying the proposed modification.

---

${placemarkedJSONStringify(objModified, 2, options.skippedKeys)}
`);
    convo.addDeveloperMessage(`
Examining the modified JSON object after the proposed modifications have been applied,
let's discuss and analyze whether or not these modifications are correct, i.e. whether
or not they properly implement the intended changes.

Specifically, check the following:

- Does the modified JSON object now correctly contain the modifications?

- Does the modified JSON object contain any unintended changes? This typically results from
    one or more poorly structured modification objects, where json_path_of_parent point to
    the wrong location in the JSON object.

- Are the modifications *correct but incomplete*? In other words, were the modifications
    that were applied correct in the sense that they were consistent with the modification
    instructions, but they only represent one step in a multi-step process? If so, then this
    is not a problem at all. We will continue to apply more modifications in subsequent
    iterations.

At the end of your analysis, write a conclusion. Your conclusion should be one of the
following, or some variant thereof:

- The changes are correct and complete for this step in the modification process.
    We can keep them, and we can move on to the next step in the modification process.

- The changes are correct but incomplete for this step in the modification process.
    They are consistent with the modification instructions, but they only represent one step
    in a multi-step process. This is not a problem at all. We will keep these changes,
    and we will continue to apply more modifications in subsequent iterations,
    to make further progress towards satisfying the modification instructions.

- The changes are incorrect for this step in the modification process. They do not progress
    us towards satisfying the modification instructions, and they may even break things and
    take us further away from satisfying the modification instructions. We should reject these
    changes, revert back to the previous version of the JSON object, and try a different
    modification operation that is more likely to be correct.
`);
    await convo.submit();

    await convo.submit(undefined, undefined, {
      jsonResponse: {
        format: {
          type: 'json_schema',
          name: 'modification_verification',
          description: `
A JSON formalization of the analysis and verification of the modifications that were just applied
to the JSON object, as we have just discussed and analyzed.
`,
          schema: {
            type: 'object',
            properties: {
              description_of_changes_intended: { type: 'string' },
              description_of_changes_applied: { type: 'string' },
              should_we_keep_these_changes: { type: 'boolean' },
              reason_to_revert: {
                type: 'string',
                description:
                  `If should_we_keep_these_changes is false, provide a brief explanation ` +
                  `of why one or more modifications were incorrect. ` +
                  `If should_we_keep_these_changes is true, ` +
                  `this field should be an empty string.`,
              },
              next_step: {
                type: 'string',
                description:
                  `A brief discussion of the next step to take in the modification process, ` +
                  `to make further progress towards satisfying the modification instructions. ` +
                  `If the modifications that were just applied already fully satisfy the ` +
                  `modification instructions and no further modifications are needed, ` +
                  `then just say so.`,
              },
            },
            required: [
              'description_of_changes_intended',
              'description_of_changes_applied',
              'should_we_keep_these_changes',
              'reason_to_revert',
              'next_step',
            ],
            additionalProperties: false,
          },
          strict: true,
        },
      },
    });

    let actionDesc = `DONE: ${convo.getLastReplyDictField('description_of_changes_applied')}`;
    operationLastWasSuccessful = true;

    if (convo.getLastReplyDictField('should_we_keep_these_changes')) {
      // Accept the modification
      obj = objModified;
    } else {
      // Reject the modification
      actionDesc =
        `FAILED: ${convo.getLastReplyDictField('description_of_changes_intended')}` +
        ` Reason for failure: ${convo.getLastReplyDictField('reason_to_revert')}`;
      operationLastWasSuccessful = false;
    }
    operationsDoneSoFar.push(actionDesc);
    operationLast = actionDesc;
    operationNext = `${convo.getLastReplyDictField('next_step')}`;
  }
};
