/**
 * Converts an object to a JSON string, adding placemarks (comments) to indicate
 * the positions of objects and indexes for better readability.
 *
 * Example:
 * // root
 * {
 *   "name": "Movie Catalog",
 *   "description": "A catalog of movies",
 *   // root["items"]
 *   "items": [
 *     // root["items"][0]
 *     {
 *       "title": "Inception",
 *       "year": 2010,
 *       // root["items"][0]["keywords"]
 *       "keywords": [
 *         // root["items"][0]["keywords"][0]
 *         "sci-fi",
 *         // root["items"][0]["keywords"][1]
 *         "thriller"
 *       ]
 *     },
 *     // root["items"][1]
 *     {
 *       "title": "The Matrix",
 *       "year": 1999,
 *       // root["items"][1]["keywords"]
 *       "keywords": [
 *         // root["items"][1]["keywords"][0]
 *         "sci-fi",
 *         // root["items"][1]["keywords"][1]
 *         "action"
 *       ]
 *     }
 *   ],
 *   // root["catalog_metadata"]
 *   catalog_metadata: {
 *     "created_by": "Admin",
 *     "created_at": "2024-01-01"
 *   }
 * }
 *
 * @param obj The object to stringify
 * @param indent Number of spaces to use for indentation
 * @param skippedKeys Array of key names to skip/ignore in the output
 * @returns The placemarked JSON string
 */
export const placemarkedJSONStringify = (
  obj: any,
  indent?: number,
  skippedKeys?: string[]
): string => {
  indent = indent || 2;
  skippedKeys = skippedKeys || [];

  const indentStr = ' '.repeat(indent);
  const lines: string[] = [];

  function stringify(value: any, path: string, currentIndent: string): void {
    if (value === undefined || value === null) {
      lines.push(currentIndent + 'null');
    } else if (typeof value === 'boolean') {
      lines.push(currentIndent + value.toString());
    } else if (typeof value === 'number') {
      lines.push(currentIndent + value.toString());
    } else if (typeof value === 'string') {
      lines.push(currentIndent + JSON.stringify(value));
    } else if (Array.isArray(value)) {
      lines.push(`${currentIndent}[`);
      value.forEach((item, index) => {
        const itemPath = `${path}[${index}]`;
        // Add annotation for every array element
        lines.push(`${currentIndent}${indentStr}// ${itemPath}`);
        stringify(item, itemPath, currentIndent + indentStr);
        if (index < value.length - 1) {
          lines[lines.length - 1] += ',';
        }
        lines.push(``);
      });
      // Remove the final extra newline after the last array element if it exists
      if (lines[lines.length - 1] === '') {
        lines.pop();
      }
      lines.push(`${currentIndent}]`);
    } else if (typeof value === 'object') {
      lines.push(`${currentIndent}{`);
      const keys = Object.keys(value).filter(key => !(skippedKeys || []).includes(key));
      keys.forEach((key, index) => {
        const keyPath = `${path}["${key}"]`;
        const val = value[key];
        const isNonPrimitive = val !== null && typeof val === 'object';

        // Add annotation for non-primitive properties (objects and arrays)
        if (isNonPrimitive) {
          lines.push(``);
          lines.push(`${currentIndent}${indentStr}// ${keyPath}`);
        }

        lines.push(
          `${currentIndent}${indentStr}${JSON.stringify(key)}${isNonPrimitive ? ':' : ': '
          }`
        );
        stringify(val, keyPath, currentIndent + indentStr);
        if (index < keys.length - 1) {
          lines[lines.length - 1] += ',';
        }
      });
      lines.push(`${currentIndent}}`);
    } else {
      lines.push(`${JSON.stringify(value)}`);
    }
  }

  // Add root annotation
  lines.push('// root');
  stringify(obj, 'root', '');

  // Combine lines, handling the inline values properly
  let result = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.endsWith(': ') && i + 1 < lines.length) {
      // This is a property key, combine with the next line if it's a simple value
      const nextLine = lines[i + 1];
      if (!nextLine.includes('{') && !nextLine.includes('[')) {
        result += line + nextLine.trim() + '\n';
        i++; // Skip the next line since we've already added it
        continue;
      }
    }
    result += line + '\n';
  }

  return result.trim();
};

/**
 * Navigates to a specific location in a JSON object based on the provided JSON path.
 * @param obj The JSON object to navigate
 * @param jsonPath An array representing the path to navigate (property names and array indexes)
 * @returns An object containing the parent of the target location, the key/index of the target,
 *          and the target object itself
 */
export const navigateToJSONPath = (obj: any, jsonPath: (string | number)[]): any => {
  // Navigate to the target location in the object
  let pathParent: any = null;
  let pathKeyOrIndex: string | number | null = null;
  let pathTarget: any = obj;
  for (let i = 0; i < jsonPath.length; i++) {
    pathKeyOrIndex = jsonPath[i] as string | number;

    pathParent = pathTarget;
    if (!pathParent) {
      throw new Error(
        `Error: Could not navigate to path ${JSON.stringify(jsonPath)};` +
        ` parent of path element ${JSON.stringify(pathKeyOrIndex)} is null or undefined.`
      );
    }
    pathTarget = pathParent[pathKeyOrIndex];
  }
  return { pathParent, pathKeyOrIndex, pathTarget };
};
