from typing import Any, Dict, List, Optional, Union


def JSONSchemaFormat(schema: Any, *, name: str, description: str):
    """A convenience function that allows us to easily create JSON schema formats."""
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

        if isinstance(subschema_value, (int, float)):
            if subschema_numrange[0] is not None:
                recretval["minValue"] = subschema_numrange[0]
            if subschema_numrange[1] is not None:
                recretval["maxValue"] = subschema_numrange[1]

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
