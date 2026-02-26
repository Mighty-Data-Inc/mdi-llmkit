import { describe, expect, it } from 'vitest';
import {
  navigateToJSONPath,
  placemarkedJSONStringify,
} from '../../src/jsonSurgery/placemarkedJSON.js';

describe('placemarkedJSONStringify', () => {
  describe('root annotation and path placemarks', () => {
    it('adds root and nested placemark comments', () => {
      const value = {
        items: [{ title: 'Inception' }],
        metadata: { createdBy: 'Admin' },
      };

      const output = placemarkedJSONStringify(value);

      expect(output).toContain('// root');
      expect(output).toContain('// root["items"]');
      expect(output).toContain('// root["items"][0]');
      expect(output).toContain('// root["metadata"]');
    });

    it('annotates deeply nested object and array paths', () => {
      const value = {
        groups: [
          {
            members: [{ profile: { name: 'A' } }],
          },
        ],
      };

      const output = placemarkedJSONStringify(value);

      expect(output).toContain('// root["groups"]');
      expect(output).toContain('// root["groups"][0]');
      expect(output).toContain('// root["groups"][0]["members"]');
      expect(output).toContain('// root["groups"][0]["members"][0]');
      expect(output).toContain('// root["groups"][0]["members"][0]["profile"]');
    });
  });

  describe('value serialization by type', () => {
    it('serializes primitive values and null in JSON form', () => {
      const value = {
        text: 'hello',
        count: 42,
        isActive: true,
        empty: null,
      };

      const output = placemarkedJSONStringify(value);

      expect(output).toContain('"text": "hello"');
      expect(output).toContain('"count": 42');
      expect(output).toContain('"isActive": true');
      expect(output).toContain('"empty": null');
    });

    it('escapes special characters in strings using JSON escaping', () => {
      const value = {
        quoted: 'He said "hello"',
        multiline: 'line1\nline2',
      };

      const output = placemarkedJSONStringify(value);

      expect(output).toContain('"quoted": "He said \\"hello\\""');
      expect(output).toContain('"multiline": "line1\\nline2"');
    });
  });

  describe('array formatting and element annotations', () => {
    it('formats arrays with bracket lines and per-index comments', () => {
      const output = placemarkedJSONStringify(['alpha', 'beta']);

      expect(output).toContain('[\n');
      expect(output).toContain('// root[0]');
      expect(output).toContain('// root[1]');
      expect(output).toContain('"alpha",');
      expect(output).toContain('"beta"');
    });
  });

  describe('object formatting and skipped keys filtering', () => {
    it('omits keys listed in skippedKeys while keeping other object fields', () => {
      const value = {
        keep: { enabled: true },
        skip: { enabled: false },
      };

      const output = placemarkedJSONStringify(value, 2, ['skip']);

      expect(output).toContain('"keep":');
      expect(output).toContain('// root["keep"]');
      expect(output).not.toContain('"skip":');
      expect(output).not.toContain('// root["skip"]');
    });

    it('skips matching keys at multiple nesting levels', () => {
      const value = {
        skip: 'root-value',
        nested: {
          keep: true,
          skip: 'nested-value',
        },
        rows: [
          { id: 1, skip: 'row-a' },
          { id: 2, skip: 'row-b' },
        ],
      };

      const output = placemarkedJSONStringify(value, 2, ['skip']);

      expect(output).toContain('"nested":');
      expect(output).toContain('"rows":');
      expect(output).toContain('"id": 1');
      expect(output).toContain('"id": 2');
      expect(output).not.toContain('"skip":');
      expect(output).not.toContain('root-value');
      expect(output).not.toContain('nested-value');
      expect(output).not.toContain('row-a');
      expect(output).not.toContain('row-b');
    });
  });

  describe('property value line-combining for primitives', () => {
    it('keeps primitive object properties on a single line', () => {
      const output = placemarkedJSONStringify({ name: 'Kaiizen', index: 7 });

      expect(output).toContain('"name": "Kaiizen"');
      expect(output).toContain('"index": 7');
      expect(output).not.toContain('"name": \n');
      expect(output).not.toContain('"index": \n');
    });
  });

  describe('indent handling and final output trimming', () => {
    it('applies custom indentation and returns trimmed output', () => {
      const output = placemarkedJSONStringify({ nested: { value: 1 } }, 4);

      expect(output).toContain('\n    "nested":');
      expect(output).toContain('\n        "value": 1');
      expect(output.endsWith('\n')).toBe(false);
      expect(output).toBe(output.trim());
    });

    it('falls back to 2 spaces when indent is 0 or undefined', () => {
      const zeroIndentOutput = placemarkedJSONStringify({ nested: { value: 1 } }, 0);
      const undefinedIndentOutput = placemarkedJSONStringify({ nested: { value: 1 } });

      expect(zeroIndentOutput).toContain('\n  "nested":');
      expect(zeroIndentOutput).toContain('\n    "value": 1');
      expect(undefinedIndentOutput).toContain('\n  "nested":');
      expect(undefinedIndentOutput).toContain('\n    "value": 1');
    });

    it('produces stable multiline structure for mixed nested values', () => {
      const output = placemarkedJSONStringify({
        name: 'Example',
        config: {
          enabled: true,
          levels: [1, 2],
        },
      });

      expect(output).toBe(`// root
{
  "name": "Example",

  // root["config"]
  "config":
  {
    "enabled": true,

    // root["config"]["levels"]
    "levels":
    [
      // root["config"]["levels"][0]
      1,

      // root["config"]["levels"][1]
      2
    ]
  }
}`);
    });
  });
});

describe('navigateToJSONPath', () => {
  describe('path traversal through object keys and array indexes', () => {
    it('resolves paths that mix object keys and array indexes', () => {
      const obj = {
        sections: [{ title: 'Intro' }, { title: 'Details' }],
      };

      const result = navigateToJSONPath(obj, ['sections', 1, 'title']);

      expect(result.pathTarget).toBe('Details');
      expect(result.pathKeyOrIndex).toBe('title');
    });
  });

  describe('returned pathParent, pathKeyOrIndex, and pathTarget tuple', () => {
    it('returns parent reference, last key/index, and target value', () => {
      const obj = {
        sections: [{ title: 'Intro' }, { title: 'Details' }],
      };

      const result = navigateToJSONPath(obj, ['sections', 1]);

      expect(result.pathParent).toBe(obj.sections);
      expect(result.pathKeyOrIndex).toBe(1);
      expect(result.pathTarget).toBe(obj.sections[1]);
    });

    it('returns root tuple values for an empty jsonPath', () => {
      const obj = { a: 1 };

      const result = navigateToJSONPath(obj, []);

      expect(result.pathParent).toBeNull();
      expect(result.pathKeyOrIndex).toBeNull();
      expect(result.pathTarget).toBe(obj);
    });
  });

  describe('error when an intermediate parent is null or undefined', () => {
    it('returns an existing null leaf target when the parent exists', () => {
      const obj = {
        metadata: {
          optional: null,
        },
      };

      const result = navigateToJSONPath(obj, ['metadata', 'optional']);

      expect(result.pathParent).toBe(obj.metadata);
      expect(result.pathKeyOrIndex).toBe('optional');
      expect(result.pathTarget).toBeNull();
    });

    it('throws with a helpful message when traversal goes past undefined', () => {
      const obj = {
        metadata: {},
      };

      const action = () => navigateToJSONPath(obj, ['metadata', 'missing', 'leaf']);

      expect(action).toThrowError(/Could not navigate to path/);
      expect(action).toThrowError(/"metadata","missing","leaf"/);
      expect(action).toThrowError(/"leaf" is null or undefined/);
    });
  });
});
