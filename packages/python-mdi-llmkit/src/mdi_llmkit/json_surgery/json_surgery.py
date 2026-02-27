"""Iterative JSON modification workflow powered by OpenAI Responses API."""

import json
import time

from typing import Any, Callable, NotRequired, TypedDict

from mdi_llmkit.gpt_api.functions import OpenAIClientLike
from mdi_llmkit.gpt_api.gpt_conversation import GptConversation

from .placemarked_json import navigate_to_json_path, placemarked_json_stringify


JSON_SCHEMA_ANYOF_PRIMITIVE_OR_EMPTY: list[dict[str, Any]] = [
    {
        "type": "object",
        "properties": {"string_value": {"type": "string"}},
        "required": ["string_value"],
        "additionalProperties": False,
    },
    {
        "type": "object",
        "properties": {"numerical_value": {"type": "number"}},
        "required": ["numerical_value"],
        "additionalProperties": False,
    },
    {
        "type": "object",
        "properties": {"boolean_value": {"type": "boolean"}},
        "required": ["boolean_value"],
        "additionalProperties": False,
    },
    {
        "type": "object",
        "properties": {"null_value": {"type": "null"}},
        "required": ["null_value"],
        "additionalProperties": False,
    },
    {
        "type": "object",
        "properties": {
            "empty_object": {
                "type": "object",
                "properties": {},
                "required": [],
                "additionalProperties": False,
            }
        },
        "required": ["empty_object"],
        "additionalProperties": False,
    },
    {
        "type": "object",
        "properties": {
            "empty_array": {
                "type": "array",
                "items": {"type": "null"},
                "maxItems": 0,
            }
        },
        "required": ["empty_array"],
        "additionalProperties": False,
    },
]

JSON_SCHEMA_SET_VALUE: dict[str, Any] = {
    "anyOf": [
        *JSON_SCHEMA_ANYOF_PRIMITIVE_OR_EMPTY,
        {
            "type": "object",
            "properties": {
                "populated_array": {
                    "type": "array",
                    "items": {"anyOf": JSON_SCHEMA_ANYOF_PRIMITIVE_OR_EMPTY},
                }
            },
            "required": ["populated_array"],
            "additionalProperties": False,
        },
        {
            "type": "object",
            "properties": {
                "populated_object": {
                    "type": "object",
                    "properties": {
                        "key_value_pairs": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "key": {"type": "string"},
                                    "value": {
                                        "anyOf": JSON_SCHEMA_ANYOF_PRIMITIVE_OR_EMPTY
                                    },
                                },
                                "required": ["key", "value"],
                                "additionalProperties": False,
                            },
                        }
                    },
                    "required": ["key_value_pairs"],
                    "additionalProperties": False,
                }
            },
            "required": ["populated_object"],
            "additionalProperties": False,
        },
    ]
}

JSON_SCHEMA_JSON_PATH: dict[str, Any] = {
    "type": "array",
    "items": {
        "anyOf": [{"type": "string"}, {"type": "number"}],
    },
}


class ValidationResult(TypedDict):
    obj_corrected: NotRequired[Any]
    errors: NotRequired[list[str]]


class JSONSurgeryOptions(TypedDict):
    schema_description: NotRequired[str]
    skipped_keys: NotRequired[list[str]]
    on_validate_before_return: NotRequired[Callable[[Any], ValidationResult | None]]
    on_work_in_progress: NotRequired[Callable[[Any], Any | None]]
    give_up_after_seconds: NotRequired[int]
    give_up_after_iterations: NotRequired[int]


class JSONSurgeryError(Exception):
    """Error type reserved for failures from json_surgery."""

    def __init__(self, message: str, obj: Any):
        super().__init__(message)
        self.obj = json.loads(json.dumps(obj))


def _deep_copy_json(value: Any) -> Any:
    return json.loads(json.dumps(value))


def _unpack_value_from_set_value_schema(value: dict[str, Any]) -> Any:
    if "string_value" in value:
        return value["string_value"]
    if "numerical_value" in value:
        return value["numerical_value"]
    if "boolean_value" in value:
        return value["boolean_value"]
    if "null_value" in value:
        return None
    if "empty_object" in value:
        return {}
    if "empty_array" in value:
        return []
    if "populated_array" in value:
        return [
            _unpack_value_from_set_value_schema(item)
            for item in value["populated_array"]
        ]
    if "populated_object" in value:
        retval: dict[str, Any] = {}
        for pair in value["populated_object"]["key_value_pairs"]:
            retval[pair["key"]] = _unpack_value_from_set_value_schema(pair["value"])
        return retval

    raise ValueError(f"Invalid value object: {json.dumps(value)}")


def json_surgery(
    openai_client: OpenAIClientLike,
    obj: Any,
    modification_instructions: str,
    options: JSONSurgeryOptions | None = None,
) -> Any:
    """Modify a JSON-like object iteratively via LLM-guided operations."""
    options = options or {}

    if obj is None:
        # NOTE: In practice, it should be a dict or a list.
        # Not sure if it's valid to pass in a string, for example.
        raise ValueError("The object to modify cannot be None.")

    obj = _deep_copy_json(obj)

    time_started = time.time()

    print(
        f"Entering json_surgery, client api_key=****{(getattr(openai_client, 'api_key', None) or 'NO_KEY_FIELD_AVAILABLE')[:-5]}"
    )

    convo_base = GptConversation(openai_client=openai_client)
    convo_base.add_developer_message(
        """
You are an expert software developer AI assistant.
The user will show you a JSON object and provide modification instructions.
The modification instructions might not be entirely straightforward, so the
process of implementing these changes may require careful thought and planning.
Through a series of individual insertions, deletions, or updates, you will modify the JSON object
to satisfy the user's instructions.
You will not be doing this alone. I will be holding your hand through the entire process,
providing feedback and guidance after each modification. You will also be getting verification
from the system itself, to ensure that your modifications are valid and correct.
"""
    )
    convo_base.add_user_message(
        f"""
Here is the JSON object to modify, in its original state prior to any modifications.
It has been formatted with placemarks (comments) to indicate the positions of elements for
better readability and easier navigation.

---

{placemarked_json_stringify(obj, 2, options.get('skipped_keys'))}"
"""
    )

    schema_description = options.get("schema_description")
    if schema_description:
        convo_base.add_user_message(
            f"""
Here is the schema definition for the JSON object, so that you know the expected structure
and data types of its properties. Make sure that your final results conform to this schema.
DO NOT introduce any properties or values that violate this schema!

---

{schema_description}
"""
        )

    convo_base.add_user_message(
        f"""
Here are the modification instructions.

---

{modification_instructions}
"""
    )

    convo_base.add_developer_message(
        """
Before we begin, please provide a detailed plan outlining the specific steps you will take to
implement the requested modifications to the JSON object. This plan should break down the
modification instructions into a clear sequence of actions that you will perform, where each
action corresponds to a specific change in the JSON structure -- either the adding, removing,
or updating of specific individual properties or values.

Your response should start with "Modification Plan:" followed by the detailed plan.
"""
    )
    convo_base.submit()

    convo_base.add_system_message(
        """
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
"""
    )
    convo_base.add_system_message(
        """
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
        `delete parent[key]` for objects, or `parent.splice(index, 1)` for arrays.
    - "assign": Set the property or element to a new value. If the parent is an array, then the
        "assign" action will replace the existing element at the specified index. If the parent
        is an object, then the "assign" action will set the value of the specified key, replacing
        any existing value for that key if it already exists, or creating a new key-value pair if
        the key does not already exist. This is functionally equivalent to:
            `parent[key] = data` for objects, or
            `parent[index] = data` for arrays.
    - "append": Applicable only when the parent object is an array. Append a new element to the
        end of the array. The "key_or_index" field is ignored. This is functionally equivalent to:
            `parent.push(data)`.
    - "insert": Applicable only when the parent object is an array. Insert a new element at the
        specified index in the array. This is functionally equivalent to:
            `parent.splice(index, 0, data)`.
    - "rename": Applicable only when the parent object is an object. Rename a property from the
        old key name (specified in "key_or_index") to a new key name. The "new_key_name" field
        (see below) *must* be provided. The "data" field is ignored for this action; you should
        just set it to null. This is functionally equivalent to:
            `parent[new_key_name] = parent[key_or_index]; delete parent[key_or_index]`.

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
"""
    )
    convo_base.add_developer_message("Alrighty then! Let's get to work!")

    operations_done_so_far: list[str] = []
    operation_last = "(nothing, we just started)"
    operation_next = "(nothing, we just started)"
    operation_last_was_successful = True
    num_iterations = 0

    while True:
        convo = convo_base.clone()

        num_iterations += 1
        if num_iterations > 1:
            on_wip = options.get("on_work_in_progress")
            if on_wip:
                obj_wip_result = on_wip(_deep_copy_json(obj))
                if obj_wip_result is not None:
                    obj = _deep_copy_json(obj_wip_result)

            seconds_elapsed = int(time.time() - time_started)
            give_up_after_seconds = options.get("give_up_after_seconds")
            if give_up_after_seconds and seconds_elapsed > give_up_after_seconds:
                raise JSONSurgeryError(
                    "Giving up after maximum time reached. "
                    f"Seconds elapsed: {seconds_elapsed} "
                    f"Maximum allowed: {give_up_after_seconds}",
                    obj,
                )

            give_up_after_iterations = options.get("give_up_after_iterations")
            if give_up_after_iterations and num_iterations > give_up_after_iterations:
                raise JSONSurgeryError(
                    f"Giving up after {give_up_after_iterations} iterations. "
                    "Maximum iterations reached.",
                    obj,
                )

            convo.add_user_message(
                f"""
CURRENT STATUS:
We've been processing for {seconds_elapsed} seconds.
We've performed {len(operations_done_so_far)} operations across {num_iterations - 1} iterations.
"""
            )
            if len(operations_done_so_far) > 0:
                msg_opssofar = ""
                for i, op in enumerate(operations_done_so_far):
                    msg_opssofar += f"{i + 1}. {op}\n"
                convo.add_user_message(
                    "Here are the operations that we've performed so far:\n"
                    f"{msg_opssofar}"
                )
            convo.add_user_message(
                f"""
Here is the JSON object in its current state, with our modifications up to this point applied.

---

{placemarked_json_stringify(obj, 2, options.get('skipped_keys'))}"
            """
            )

            convo.add_user_message(
                f"""
Just to help re-establish context from previous iterations, here is the last operation we
performed on this JSON object:
${operation_last}

Here's what we were planning to do next:
${operation_next}
"""
            )

            if not operation_last_was_successful:
                convo.add_developer_message(
                    """
CRITICAL NOTE: The last operation we had performed on this JSON object failed.
Do not repeat this exact operation -- operations are deterministic, so if it failed before
then it will fail again. Find a different approach to achieve the desired modification.
Choose a different operation or strategy.
"""
                )

        convo.add_developer_message(
            """
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
"""
        )
        convo.submit()

        convo.submit(
            json_response={
                "format": {
                    "type": "json_schema",
                    "name": "json_object_modifications",
                    "description": """
A JSON formalization of the next set of modifications to apply to the JSON object,
as we have just determined and described. If there are multiple modifications to apply,
you can include all of them in this JSON object. If there are no modifications to apply
because the modification instructions have already been fully satisfied, then set the
"modifications" field to an empty list.
""",
                    "schema": {
                        "type": "object",
                        "properties": {
                            "modifications": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "json_path_of_parent": JSON_SCHEMA_JSON_PATH,
                                        "key_or_index": {
                                            "anyOf": [
                                                {"type": "string"},
                                                {"type": "number"},
                                            ],
                                        },
                                        "action": {
                                            "type": "string",
                                            "enum": [
                                                "assign",
                                                "delete",
                                                "append",
                                                "insert",
                                                "rename",
                                            ],
                                        },
                                        "new_key_name": {"type": "string"},
                                        "data": {
                                            "anyOf": [
                                                {
                                                    "type": "null",
                                                    "description": 'Data field should be null for "delete" and "rename" actions.',
                                                },
                                                {
                                                    "type": "object",
                                                    "properties": {
                                                        "inline_value": {
                                                            **JSON_SCHEMA_SET_VALUE,
                                                            "description": """
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
""",
                                                        },
                                                    },
                                                    "required": ["inline_value"],
                                                    "additionalProperties": False,
                                                },
                                                {
                                                    "type": "object",
                                                    "properties": {
                                                        "json_path_of_copy_source": JSON_SCHEMA_JSON_PATH,
                                                    },
                                                    "required": [
                                                        "json_path_of_copy_source"
                                                    ],
                                                    "additionalProperties": False,
                                                },
                                            ],
                                        },
                                    },
                                    "required": [
                                        "json_path_of_parent",
                                        "key_or_index",
                                        "action",
                                        "new_key_name",
                                        "data",
                                    ],
                                    "additionalProperties": False,
                                },
                            },
                        },
                        "required": ["modifications"],
                        "additionalProperties": False,
                    },
                    "strict": True,
                },
            },
        )

        modifications = convo.get_last_reply_dict_field("modifications")
        if not modifications:
            validation_errors: list[str] = []
            on_validate = options.get("on_validate_before_return")
            if on_validate:
                validation_result = on_validate(_deep_copy_json(obj))
                if validation_result:
                    if "obj_corrected" in validation_result:
                        obj = validation_result["obj_corrected"]
                    if validation_result.get("errors"):
                        validation_errors = validation_result.get("errors", [])

            if not validation_errors:
                return obj

            operation_last_was_successful = False
            action_desc = """
ERROR: Validation failure on attempted exit.
We thought we had finished processing, but the object didn't pass an automated
validation check. This is often the result of undocumented requirements,
and isn't necessarily because you did anything wrong. Nonetheless, these remaining
issues must be addressed before we can consider the object valid.)

The validator returned the following errors:                
"""
            for validation_error in validation_errors:
                action_desc += f"- {validation_error}\n"

            operations_done_so_far.append(action_desc)
            operation_last = action_desc
            operation_next = (
                "Fix these validation errors, and try to exit again when they're done."
            )
            continue

        obj_modified = _deep_copy_json(obj)
        for modification in modifications:
            try:
                json_path_of_parent = modification.get("json_path_of_parent")
                key_or_index = modification.get("key_or_index")
                action = modification.get("action")
                new_key_name = modification.get("new_key_name")
                data = modification.get("data")

                value = None
                if data:
                    if isinstance(data, dict) and "inline_value" in data:
                        value = _unpack_value_from_set_value_schema(
                            data["inline_value"]
                        )
                    elif isinstance(data, dict) and "json_path_of_copy_source" in data:
                        source_path = data["json_path_of_copy_source"]
                        source_nav_result = navigate_to_json_path(
                            obj_modified, source_path
                        )
                        value = _deep_copy_json(source_nav_result["path_target"])

                if json_path_of_parent is None:
                    raise ValueError('Missing required field "json_path_of_parent".')
                if not action:
                    raise ValueError('Missing required field "action".')
                if action == "rename" and not new_key_name:
                    raise ValueError(
                        'Missing required field "new_key_name" for rename.'
                    )

                json_path_nav_result = navigate_to_json_path(
                    obj_modified, json_path_of_parent
                )
                target_parent = json_path_nav_result["path_target"]

                if target_parent is None or not isinstance(target_parent, (dict, list)):
                    raise ValueError(
                        "json_path_of_parent must point to an object or array. "
                        f"Instead got: {json.dumps(target_parent)}"
                    )

                if action == "assign":
                    target_parent[key_or_index] = value
                elif action == "delete":
                    if isinstance(target_parent, list):
                        del target_parent[int(key_or_index)]
                    else:
                        target_parent.pop(key_or_index, None)
                elif action == "append":
                    if not isinstance(target_parent, list):
                        raise ValueError("append action can only be applied to arrays")
                    target_parent.append(value)
                elif action == "insert":
                    if not isinstance(target_parent, list):
                        raise ValueError("insert action can only be applied to arrays")
                    target_parent.insert(int(key_or_index), value)
                elif action == "rename":
                    if isinstance(target_parent, list):
                        raise ValueError("rename action can only be applied to objects")
                    target_parent[new_key_name] = target_parent.get(key_or_index)
                    target_parent.pop(key_or_index, None)
                else:
                    raise ValueError(f"Unknown action: {action}")

                convo.add_system_message(
                    f"""
Applied modification successfully.
json_path_of_parent: {json.dumps(json_path_of_parent)}
key_or_index: {json.dumps(key_or_index)}
action: {json.dumps(action)}
new_key_name: {json.dumps(new_key_name)}
data: {json.dumps(data, indent=2)}
"""
                )
            except Exception as error:
                convo.add_system_message(
                    f"An error occurred while applying proposed modification:\n{error}"
                )

        convo.add_system_message(
            f"""
Here is the JSON object after applying proposed modifications.

---


{placemarked_json_stringify(obj_modified, 2, options.get('skipped_keys'))}
"""
        )

        convo.add_developer_message(
            """
Examining the modified JSON object in its new state after the proposed modifications
have been applied, let's discuss and analyze whether or not these modifications are
correct, i.e. whether or not they properly move the object towards satisfying the
modification instructions.

Specifically, check the following:

- Does the modified JSON object now correctly contain the modifications you had intended?

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
"""
        )
        convo.submit()

        convo.submit(
            json_response={
                "format": {
                    "type": "json_schema",
                    "name": "modification_verification",
                    "description": "Formalized verification of proposed changes.",
                    "schema": {
                        "type": "object",
                        "properties": {
                            "description_of_changes_intended": {"type": "string"},
                            "description_of_changes_applied": {"type": "string"},
                            "should_we_keep_these_changes": {"type": "boolean"},
                            "reason_to_revert": {"type": "string"},
                            "next_step": {"type": "string"},
                        },
                        "required": [
                            "description_of_changes_intended",
                            "description_of_changes_applied",
                            "should_we_keep_these_changes",
                            "reason_to_revert",
                            "next_step",
                        ],
                        "additionalProperties": False,
                    },
                    "strict": True,
                }
            },
        )

        action_desc = (
            f"DONE: {convo.get_last_reply_dict_field('description_of_changes_applied')}"
        )
        operation_last_was_successful = True

        if convo.get_last_reply_dict_field("should_we_keep_these_changes"):
            obj = obj_modified
        else:
            action_desc = (
                f"FAILED: {convo.get_last_reply_dict_field('description_of_changes_intended')} "
                f"Reason for failure: {convo.get_last_reply_dict_field('reason_to_revert')}"
            )
            operation_last_was_successful = False

        operations_done_so_far.append(action_desc)
        operation_last = action_desc
        operation_next = convo.get_last_reply_dict_field("next_step")


jsonSurgery = json_surgery
