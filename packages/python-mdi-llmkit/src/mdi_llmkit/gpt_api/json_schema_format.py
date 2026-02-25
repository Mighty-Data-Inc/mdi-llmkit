"""Helpers for building OpenAI Structured Outputs schemas from a compact DSL.

This module exists to keep application code terse when defining JSON Schema for
`text.format = {"type": "json_schema", ...}` in the OpenAI API.

Instead of manually writing large nested schema dictionaries, callers provide a
Python-first shorthand (types, dict/list exemplars, and tuple metadata), and
`JSONSchemaFormat` expands it into a strict JSON Schema payload.

Design goals:
- Keep schema authoring ergonomic for common use cases.
- Emit object schemas with `required` and `additionalProperties: false` by default.
- Match the practical subset used by OpenAI Structured Outputs for this project.

This is intentionally a convenience layer, not a complete JSON Schema compiler.

For the full OpenAI Structured Outputs schema capabilities, refer to the official documentation:
https://developers.openai.com/api/docs/guides/structured-outputs/
"""

from typing import Any, Dict, List, Optional, Union


def JSONSchemaFormat(
    schema: Any,
    *,
    name: Optional[str] = None,
    description: Optional[str] = None,
) -> Dict[str, Any]:
    """Build an OpenAI Structured Outputs `json_schema` format payload.

    The function accepts a compact schema DSL and returns a dictionary suitable
    for OpenAI calls that use structured output formatting:

    {
        "format": {
            "type": "json_schema",
            "strict": True,
            "name": <optional>,
            "description": <optional>,
            "schema": <expanded JSON schema object>
        }
    }

    Supported shorthand patterns in `schema`
    ----------------------------------------
    - Primitive types/values:
        - `str`, `int`, `float`, `bool` (or corresponding literal values)
    - Object shorthand:
        - `dict` maps to `{"type": "object", "properties": ...}`
        - All keys become required.
        - `additionalProperties` is always set to `False`.
    - Array shorthand:
        - `list` maps to `{"type": "array", "items": ...}`
        - First list element is used as the item exemplar.
    - String enum shorthand:
        - A list with >=2 strings (e.g., `["a", "b"]`) becomes
            `{"type": "string", "enum": [...]}`.
    - Tuple metadata shorthand (order-insensitive):
        - Description: any non-empty `str`
        - Enum: `list[str]` with length >= 2
        - Range: `(min, max)` where either side may be `int`, `float`, or `None`
        - Schema value: the remaining item (type, dict, list, etc.)

    Numeric range behavior
    ----------------------
    When the resolved node type is numeric (`integer` or `number`), tuple ranges
    are emitted as JSON Schema-compatible `minimum` and `maximum`.

    Root behavior
    -------------
    Structured Outputs expects an object at the root. If `schema` resolves to a
    non-object, this function wraps it in an object property named by `name`
    (or `"schema"` if no name is provided).

    Notes and limitations
    ---------------------
    - This helper targets common project needs and does not implement the full
        JSON Schema language.
    - Tuple parsing treats falsy values as placeholders for the schema value,
        which is convenient but can be ambiguous for some edge cases.
    - The function raises `ValueError` when it cannot infer a supported type.

    Args:
            schema: Compact schema DSL value to expand.
            name: Optional schema name in the OpenAI format envelope.
            description: Optional schema-level description in the envelope.

    Returns:
            A dictionary containing OpenAI `format` configuration with expanded
            JSON Schema under `format["schema"]`.
    """
    retval = {
        "format": {
            "type": "json_schema",
            "strict": True,
        },
    }
    if name:
        retval["format"]["name"] = name
    if description:
        retval["format"]["description"] = description

    TYPEMAP = {
        str: "string",
        int: "integer",
        float: "number",
        bool: "boolean",
    }

    def _convert_schema_recursive(subschema: Any) -> dict:
        # If the subschema is a Tuple, then it will consist of either two or three elements.
        # One of these elements will be a string. The other element will be a list of strings.
        # The third element will be the subschema's value. These elements can occur in any order.
        # Oh, it can also be a pair of numerical values, which represent min and max ranges.
        subschema_description = ""
        subschema_enum = []
        subschema_numrange = (None, None)
        subschema_value = subschema
        if isinstance(subschema, tuple):
            for item in subschema:
                if not item:
                    # If the item is falsy, then it's a data type placeholder.
                    subschema_value = item
                    continue

                # If it's a string and it wasn't falsy, then assume it's a description.
                if isinstance(item, str):
                    subschema_description = item
                    continue

                # If it's a list of length >= 2 and all list members are strings, then assume it's an enum.
                if (
                    isinstance(item, list)
                    and len(item) >= 2
                    and all(isinstance(i, str) for i in item)
                ):
                    subschema_enum = item
                    continue

                # If it's a tuple of length 2 and at least one element is a float or int,
                # then assume it's a numeric range.
                if (
                    isinstance(item, tuple)
                    and len(item) == 2
                    and (
                        isinstance(item[0], (float, int))
                        or isinstance(item[1], (float, int))
                    )
                ):
                    subschema_numrange = item
                    continue

                # At this point, we have to assume that the item is the schema value.
                subschema_value = item

        if isinstance(subschema_value, tuple):
            # We might be able to infer its type by its enum or range.
            if len(subschema_enum) > 0:
                # It's implicitly a string.
                subschema_value = str

            nr0 = subschema_numrange[0]
            nr1 = subschema_numrange[1]
            if nr0 is not None or nr1 is not None:
                if isinstance(nr0, float) or isinstance(nr1, float):
                    subschema_value = float
                else:
                    subschema_value = int

        recretval = {}

        if isinstance(subschema_value, dict):
            recretval["type"] = "object"
            if subschema_description:
                recretval["description"] = subschema_description
            recretval["additionalProperties"] = False
            recretval["required"] = [p for p in subschema_value.keys()]
            recretval["properties"] = {}
            for k, v in subschema_value.items():
                if isinstance(v, str):
                    recretval["properties"][k] = {"type": "string", "description": v}
                else:
                    recretval["properties"][k] = _convert_schema_recursive(v)

        elif isinstance(subschema_value, list):
            # If it's a list of length >= 2 and all list members are strings, then assume it's an enum.
            if len(subschema_value) >= 2 and all(
                isinstance(i, str) for i in subschema_value
            ):
                recretval["type"] = "string"
                subschema_enum = subschema_value
            else:
                recretval["type"] = "array"
                if subschema_description:
                    recretval["description"] = subschema_description
                if subschema_numrange[0] is not None:
                    recretval["minItems"] = subschema_numrange[0]
                if subschema_numrange[1] is not None:
                    recretval["maxItems"] = subschema_numrange[1]
                arrayexemplar = subschema_value[0]
                if isinstance(arrayexemplar, str):
                    recretval["items"] = {
                        "type": "string",
                        "description": arrayexemplar,
                    }
                else:
                    recretval["items"] = _convert_schema_recursive(arrayexemplar)

        else:
            subschema_type = TYPEMAP.get(subschema_value)
            if not subschema_type:
                subschema_type = TYPEMAP.get(type(subschema_value))
            if not subschema_type:
                raise ValueError(
                    f"Unrecognized type for schema value: {subschema_value}"
                )
            recretval["type"] = subschema_type
            if subschema_description:
                recretval["description"] = subschema_description

        if subschema_enum:
            recretval["enum"] = subschema_enum

        if recretval.get("type") in ("integer", "number"):
            if subschema_numrange[0] is not None:
                recretval["minimum"] = subschema_numrange[0]
            if subschema_numrange[1] is not None:
                recretval["maximum"] = subschema_numrange[1]

        return recretval

    convresult = _convert_schema_recursive(schema)
    if convresult["type"] != "object":
        if not name:
            name = "schema"
        convresult = {
            "type": "object",
            "required": [name],
            "additionalProperties": False,
            "properties": {name: convresult},
        }

    retval["format"]["schema"] = convresult
    return retval
