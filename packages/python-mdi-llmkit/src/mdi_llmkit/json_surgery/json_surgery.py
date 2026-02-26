"""Iterative JSON modification workflow powered by OpenAI Responses API."""

import json
import time

from typing import Any, Awaitable, Callable, NotRequired, TypedDict

from mdi_llmkit.gpt_api.functions import OpenAIClientLike

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
    on_validate_before_return: NotRequired[
        Callable[[Any], ValidationResult | None]
        | Callable[[Any], Awaitable[ValidationResult | None]]
    ]
    on_work_in_progress: NotRequired[
        Callable[[Any], Any | None] | Callable[[Any], Awaitable[Any | None]]
    ]
    give_up_after_seconds: NotRequired[int]
    give_up_after_iterations: NotRequired[int]


class JSONSurgeryError(Exception):
    """Error type reserved for failures from json_surgery."""

    def __init__(self, message: str, obj: Any):
        super().__init__(message)
        self.obj = json.loads(json.dumps(obj))


def _deep_copy(value: Any) -> Any:
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


def parse_json_from_ai_response(json_text: str) -> Any:
    """Parse the first balanced JSON object from AI output text."""
    depth = 0
    start = -1

    for idx, ch in enumerate(json_text):
        if ch == "{":
            if depth == 0:
                start = idx
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start != -1:
                return json.loads(json_text[start : idx + 1])

    return None


def call_llm_for_json(
    openai_client: OpenAIClientLike,
    body: dict[str, Any],
    num_retries: int | None = None,
) -> Any:
    """Call OpenAI Responses and parse a JSON object from output text."""
    if not num_retries:
        num_retries = 5

    ex: Exception | None = None
    for _ in range(num_retries):
        try:
            llm_response = openai_client.responses.create(
                **body,
                timeout=30000,
            )
            llm_reply = llm_response.output_text
            return parse_json_from_ai_response(llm_reply)
        except Exception as error:
            ex = error
            if isinstance(error, json.JSONDecodeError) and (
                "Unterminated string in JSON" in str(error)
            ):
                continue
            raise

    if ex:
        raise ex
    raise ValueError("Unknown failure in call_llm_for_json")


def _is_async_callable(fn: Callable[..., Any]) -> bool:
    code = getattr(fn, "__code__", None)
    return bool(code and (code.co_flags & 0x80))


def _run_callback(callback: Callable[[Any], Any], payload: Any) -> Any:
    if _is_async_callable(callback):
        import asyncio

        return asyncio.run(callback(payload))
    return callback(payload)


def json_surgery(
    openai_client: OpenAIClientLike,
    obj: Any,
    modification_instructions: str,
    options: JSONSurgeryOptions | None = None,
) -> Any:
    """Modify a JSON-like object iteratively via LLM-guided operations."""
    options = options or {}
    obj = _deep_copy(obj)

    time_started = time.time()
    num_iterations = 0

    messages: list[dict[str, Any]] = [
        {
            "role": "developer",
            "content": (
                "You are an expert software developer AI assistant.\n"
                "The user will show you a JSON object and provide modification instructions.\n"
                "Through a series of insertions, deletions, or updates, modify the JSON object\n"
                "to satisfy the instructions."
            ),
        }
    ]

    messages.append(
        {
            "role": "user",
            "content": (
                "Here is the JSON object to modify in its original state.\n\n---\n\n"
                f"{placemarked_json_stringify(obj, 2, options.get('skipped_keys'))}"
            ),
        }
    )

    schema_description = options.get("schema_description")
    if schema_description:
        messages.append(
            {
                "role": "user",
                "content": (
                    "Here is the schema definition for the JSON object. "
                    "Final output must conform to it.\n\n---\n\n"
                    f"{schema_description}"
                ),
            }
        )

    messages.append(
        {
            "role": "user",
            "content": (
                "Here are the modification instructions.\n\n---\n\n"
                f"{modification_instructions}"
            ),
        }
    )

    messages.append(
        {
            "role": "developer",
            "content": (
                "Before we begin, provide a detailed modification plan. "
                'Start your response with "Modification Plan:".'
            ),
        }
    )

    llm_response = openai_client.responses.create(
        model="gpt-4.1",
        input=messages,
    )
    llm_reply = llm_response.output_text
    messages.append({"role": "assistant", "content": llm_reply})

    messages_base = _deep_copy(messages)
    operations_done_so_far: list[str] = []
    operation_last = "(nothing, we just started)"
    operation_next = "(nothing, we just started)"
    operation_last_was_successful = True
    is_first_iteration = True

    while True:
        messages = _deep_copy(messages_base)

        if not is_first_iteration:
            on_wip = options.get("on_work_in_progress")
            if on_wip:
                obj_wip_result = _run_callback(on_wip, _deep_copy(obj))
                if obj_wip_result is not None:
                    obj = _deep_copy(obj_wip_result)

            seconds_elapsed = int(time.time() - time_started)
            give_up_after_seconds = options.get("give_up_after_seconds")
            if give_up_after_seconds and seconds_elapsed > give_up_after_seconds:
                raise JSONSurgeryError(
                    "Giving up after maximum time reached. "
                    f"Seconds elapsed: {seconds_elapsed} "
                    f"Maximum allowed: {give_up_after_seconds}",
                    obj,
                )

            num_iterations += 1
            give_up_after_iterations = options.get("give_up_after_iterations")
            if give_up_after_iterations and num_iterations > give_up_after_iterations:
                raise JSONSurgeryError(
                    "Giving up after maximum iterations reached. "
                    f"Iteration count: {num_iterations} "
                    f"Maximum allowed: {give_up_after_iterations}",
                    obj,
                )

            messages.append(
                {
                    "role": "user",
                    "content": (
                        "STATUS: "
                        f"{seconds_elapsed} seconds elapsed; "
                        f"{len(operations_done_so_far)} operations across "
                        f"{num_iterations - 1} iterations.\n\n"
                        "Operations done:\n"
                        f"{chr(10).join([f'{i + 1}. {op}' for i, op in enumerate(operations_done_so_far)]) or '(nothing; we just started)'}"
                    ),
                }
            )
            messages.append(
                {
                    "role": "user",
                    "content": (
                        "Current state of JSON object.\n\n---\n\n"
                        f"{placemarked_json_stringify(obj, 2, options.get('skipped_keys'))}"
                    ),
                }
            )
            messages.append(
                {
                    "role": "user",
                    "content": (
                        f"Last operation:\n{operation_last}\n\n"
                        f"Planned next:\n{operation_next}"
                    ),
                }
            )

            if not operation_last_was_successful:
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            "CRITICAL: Last operation failed. Do not repeat it exactly. "
                            "Choose a different operation or strategy."
                        ),
                    }
                )

        is_first_iteration = False

        messages.append(
            {
                "role": "developer",
                "content": (
                    "Determine and describe the next modifications in plain English. "
                    "If all instructions are satisfied, say we are done."
                ),
            }
        )

        llm_response = openai_client.responses.create(
            model="gpt-4.1",
            input=messages,
        )
        llm_reply = llm_response.output_text
        messages.append({"role": "assistant", "content": llm_reply})

        llm_reply_obj = call_llm_for_json(
            openai_client,
            {
                "model": "gpt-4.1",
                "input": messages,
                "text": {
                    "format": {
                        "type": "json_schema",
                        "name": "json_object_modifications",
                        "description": "JSON formalization of next modifications.",
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
                                                ]
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
                                                        "description": "Use null for delete and rename.",
                                                    },
                                                    {
                                                        "type": "object",
                                                        "properties": {
                                                            "inline_value": JSON_SCHEMA_SET_VALUE,
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
                                                ]
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
                                }
                            },
                            "required": ["modifications"],
                            "additionalProperties": False,
                        },
                        "strict": True,
                    }
                },
            },
        )

        if not llm_reply_obj:
            continue

        modifications = llm_reply_obj.get("modifications")
        if not modifications:
            validation_errors: list[str] = []
            on_validate = options.get("on_validate_before_return")
            if on_validate:
                validation_result = _run_callback(on_validate, _deep_copy(obj))
                if validation_result:
                    if "obj_corrected" in validation_result:
                        obj = validation_result["obj_corrected"]
                    if validation_result.get("errors"):
                        validation_errors = validation_result["errors"]

            if not validation_errors:
                return obj

            operation_last_was_successful = False
            action_desc = (
                "ERROR: Validation failure on attempted exit. "
                f"Errors: {' | '.join(validation_errors)}"
            )
            operations_done_so_far.append(action_desc)
            operation_last = action_desc
            operation_next = "Fix validation errors and try to exit again."
            continue

        obj_modified = _deep_copy(obj)
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
                        value = _deep_copy(source_nav_result["path_target"])

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

                messages.append(
                    {
                        "role": "system",
                        "content": (
                            "Applied modification successfully:\n"
                            f"json_path_of_parent: {json.dumps(json_path_of_parent)}\n"
                            f"key_or_index: {json.dumps(key_or_index)}\n"
                            f"action: {json.dumps(action)}\n"
                            f"new_key_name: {json.dumps(new_key_name)}\n"
                            f"value: {json.dumps(value, indent=2)}"
                        ),
                    }
                )
            except Exception as error:
                messages.append(
                    {
                        "role": "system",
                        "content": (
                            "Error while applying proposed modification:\n" f"{error}"
                        ),
                    }
                )

        messages.append(
            {
                "role": "user",
                "content": (
                    "Here is the JSON object after applying proposed modifications.\n\n---\n\n"
                    f"{placemarked_json_stringify(obj_modified, 2, options.get('skipped_keys'))}"
                ),
            }
        )
        messages.append(
            {
                "role": "developer",
                "content": (
                    "Analyze whether applied changes are correct for this step, and whether "
                    "they should be kept."
                ),
            }
        )

        llm_response = openai_client.responses.create(
            model="gpt-4.1",
            input=messages,
        )
        llm_reply = llm_response.output_text
        messages.append({"role": "assistant", "content": llm_reply})

        llm_reply_obj = call_llm_for_json(
            openai_client,
            {
                "model": "gpt-4.1",
                "input": messages,
                "text": {
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
            },
        )
        messages.append({"role": "assistant", "content": json.dumps(llm_reply_obj)})

        action_desc = f"DONE: {llm_reply_obj['description_of_changes_applied']}"
        operation_last_was_successful = True

        if llm_reply_obj.get("should_we_keep_these_changes"):
            obj = obj_modified
        else:
            action_desc = (
                f"FAILED: {llm_reply_obj['description_of_changes_intended']} "
                f"Reason for failure: {llm_reply_obj['reason_to_revert']}"
            )
            operation_last_was_successful = False

        operations_done_so_far.append(action_desc)
        operation_last = action_desc
        operation_next = llm_reply_obj["next_step"]


jsonSurgery = json_surgery
