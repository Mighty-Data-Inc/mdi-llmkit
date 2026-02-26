"""Utilities for placemark-annotated JSON formatting and JSON-path navigation."""

import json

from typing import Any, Sequence


def placemarked_json_stringify(
    obj: Any,
    indent: int | None = None,
    skipped_keys: Sequence[str] | None = None,
) -> str:
    """Convert an object to JSON text with path placemark comments.

    The output mirrors the TypeScript implementation used by mdi-llmkit's
    `jsonSurgery` package, including comments such as `// root["items"][0]`.
    """
    indent = indent or 2
    skipped_keys = list(skipped_keys or [])

    indent_str = " " * indent
    lines: list[str] = []

    def _stringify(value: Any, path: str, current_indent: str) -> None:
        if value is None:
            lines.append(current_indent + "null")
        elif isinstance(value, bool):
            lines.append(current_indent + ("true" if value else "false"))
        elif isinstance(value, (int, float)):
            lines.append(current_indent + str(value))
        elif isinstance(value, str):
            lines.append(current_indent + json.dumps(value))
        elif isinstance(value, list):
            lines.append(f"{current_indent}[")
            for index, item in enumerate(value):
                item_path = f"{path}[{index}]"
                lines.append(f"{current_indent}{indent_str}// {item_path}")
                _stringify(item, item_path, current_indent + indent_str)
                if index < len(value) - 1:
                    lines[-1] += ","
                lines.append("")

            if lines and lines[-1] == "":
                lines.pop()
            lines.append(f"{current_indent}]")
        elif isinstance(value, dict):
            lines.append(f"{current_indent}{{")
            keys = [k for k in value.keys() if k not in skipped_keys]
            for index, key in enumerate(keys):
                key_path = f'{path}["{key}"]'
                val = value[key]
                is_non_primitive = val is not None and isinstance(val, (dict, list))

                if is_non_primitive:
                    lines.append("")
                    lines.append(f"{current_indent}{indent_str}// {key_path}")

                lines.append(
                    f"{current_indent}{indent_str}{json.dumps(key)}"
                    f"{':' if is_non_primitive else ': '}"
                )
                _stringify(val, key_path, current_indent + indent_str)
                if index < len(keys) - 1:
                    lines[-1] += ","
            lines.append(f"{current_indent}}}")
        else:
            lines.append(json.dumps(value))

    lines.append("// root")
    _stringify(obj, "root", "")

    result = ""
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.endswith(": ") and i + 1 < len(lines):
            next_line = lines[i + 1]
            if "{" not in next_line and "[" not in next_line:
                result += line + next_line.strip() + "\n"
                i += 2
                continue

        result += line + "\n"
        i += 1

    return result.strip()


def navigate_to_json_path(obj: Any, json_path: Sequence[str | int]) -> dict[str, Any]:
    """Navigate to a location in a JSON-like object using a list path."""
    path_parent: Any = None
    path_key_or_index: str | int | None = None
    path_target: Any = obj

    for path_key_or_index in json_path:
        path_parent = path_target
        if not path_parent:
            raise ValueError(
                f"Error: Could not navigate to path {json.dumps(list(json_path))};"
                f" parent of path element {json.dumps(path_key_or_index)} is null or undefined."
            )
        path_target = path_parent[path_key_or_index]

    return {
        "path_parent": path_parent,
        "path_key_or_index": path_key_or_index,
        "path_target": path_target,
    }


placemarkedJSONStringify = placemarked_json_stringify
navigateToJSONPath = navigate_to_json_path
