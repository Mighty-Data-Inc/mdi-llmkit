import { OpenAI } from 'openai';
import { describe, expect, it } from 'vitest';
import { aiModifyObject, AIModifyObjectError } from '../../src/jsonSurgery/aiModifyObject.js';



const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  throw new Error(
    'OPENAI_API_KEY is required for aiModifyObject live API tests. Configure your test environment to provide it.'
  );
}

const createClient = (): OpenAI =>
  new OpenAI({
    apiKey: OPENAI_API_KEY,
  });

describe.concurrent('aiModifyObject (live API)', () => {
  describe('atomic operations', () => {
    it(
      'applies a simple scalar update without mutating original input',
      async () => {
        const original = {
          id: 'task-1',
          status: 'pending',
          notes: ['created'],
        };

        const result = await aiModifyObject(
          createClient(),
          original,
          'Set the status field to "approved". Do not change any other fields.',
          {
            schemaDescription: `
{
  "type": "object",
  "properties": {
    "id": { "type": "string" },
    "status": { "type": "string" },
    "notes": {
      "type": "array",
      "items": { "type": "string" }
    }
  },
  "required": ["id", "status", "notes"],
  "additionalProperties": false
}
  `,
          }
        );

        expect(result.status).toBe('approved');
        expect(result.id).toBe(original.id);
        expect(result.notes).toEqual(original.notes);

        // Expect the original to be unmodified.
        expect(original).not.toBe(result);
        expect(original.status).toBe('pending');
      },
      180000
    );

    it(
      'renames a nested property while preserving value',
      async () => {
        const original = {
          address: {
            zip: '98101',
            city: 'Seattle',
          },
        };

        const result = await aiModifyObject(
          createClient(),
          original,
          'Inside address, rename the key "zip" to "postalCode" and keep the same value. Do not change anything else.'
        );

        expect(result.address.postalCode).toBe('98101');
        expect(result.address.city).toBe('Seattle');
        expect('zip' in result.address).toBe(false);

        // Expect the original to be unmodified.
        expect(original).not.toBe(result);
        expect(original.address.zip).toBe('98101');
      },
      180000
    );

    it(
      'handles array insert/append style updates',
      async () => {
        const original = {
          tags: ['alpha', 'beta'],
        };

        const result = await aiModifyObject(
          createClient(),
          original,
          'In the tags array, insert "urgent" at the beginning and append "done" at the end. Keep existing tags.'
        );

        expect(Array.isArray(result.tags)).toBe(true);
        expect(result.tags[0]).toBe('urgent');
        expect(result.tags[result.tags.length - 1]).toBe('done');
        expect(result.tags).toContain('alpha');
        expect(result.tags).toContain('beta');

        // Expect the original to be unmodified.
        expect(original).not.toBe(result);
        expect(original.tags).toEqual(['alpha', 'beta']);
      },
      180000
    );

    it(
      'builds nested object structure from plain-English instructions',
      async () => {
        const original = {
          profile: {},
        };

        const result = await aiModifyObject(
          createClient(),
          original,
          'Create profile.contact with email "person@example.com" and phone "555-0100".'
        );

        expect(result.profile).toBeTruthy();
        expect(result.profile.contact).toBeTruthy();
        expect(result.profile.contact.email).toBe('person@example.com');
        expect(result.profile.contact.phone).toBe('555-0100');

        // Expect the original to be unmodified.
        expect(original).not.toBe(result);
        expect(original.profile).toEqual({});
      },
      180000
    );

    it(
      'honors skippedKeys while still modifying visible fields',
      async () => {
        const original = {
          name: 'Widget',
          secretToken: 'SECRET-123',
          audit: {
            createdBy: 'u1',
          },
        };

        const result = await aiModifyObject(
          createClient(),
          original,
          'Change name to "Widget Pro" and set audit.createdBy to "u2".',
          { skippedKeys: ['secretToken'] }
        );

        expect(result.name).toBe('Widget Pro');
        expect(result.audit.createdBy).toBe('u2');
        expect(result.secretToken).toBe('SECRET-123');

        // Expect the original to be unmodified.
        expect(original).not.toBe(result);
        expect(original.name).toBe('Widget');
        expect(original.audit.createdBy).toBe('u1');
        expect(original.secretToken).toBe('SECRET-123');
      },
      180000
    );

    it(
      'follows schema-constrained type updates for primitives',
      async () => {
        const original = {
          age: 40,
          active: true,
        };

        const result = await aiModifyObject(
          createClient(),
          original,
          'Set age to 41 and active to false.',
          {
            schemaDescription: `
{
  "type": "object",
  "properties": {
    "age": { "type": "number" },
    "active": { "type": "boolean" }
  },
  "required": ["age", "active"],
  "additionalProperties": false
}
  `,
          }
        );

        expect(result.age).toBe(41);
        expect(typeof result.age).toBe('number');
        expect(result.active).toBe(false);
        expect(typeof result.active).toBe('boolean');

        // Expect the original to be unmodified.
        expect(original).not.toBe(result);
        expect(original.age).toBe(40);
        expect(original.active).toBe(true);
      },
      180000
    );

    it(
      'removes requested properties without disturbing unrelated fields',
      async () => {
        const original = {
          id: 'rec-1',
          name: 'Sample',
          obsoleteField: 'remove-me',
          metadata: {
            owner: 'team-a',
          },
        };

        const result = await aiModifyObject(
          createClient(),
          original,
          'Delete obsoleteField. Keep id, name, and metadata unchanged.'
        );

        expect('obsoleteField' in result).toBe(false);
        expect(result.id).toBe(original.id);
        expect(result.name).toBe(original.name);
        expect(result.metadata).toEqual(original.metadata);

        // Expect the original to be unmodified.
        expect(original).not.toBe(result);
        expect(original.obsoleteField).toBe('remove-me');
      },
      180000
    );

    it(
      'keeps object effectively unchanged for explicit no-op instructions',
      async () => {
        const original = {
          status: 'complete',
          tags: ['alpha', 'beta'],
          details: {
            priority: 2,
            archived: false,
          },
        };

        const result = await aiModifyObject(
          createClient(),
          original,
          'Do not make any modifications. Confirm the object already satisfies the request as-is.'
        );

        expect(result).toEqual(original);

        // Expect the original to be unmodified.
        expect(original).not.toBe(result);
        expect(original.status).toBe('complete');
        expect(original.tags).toEqual(['alpha', 'beta']);
        expect(original.details).toEqual({ priority: 2, archived: false });
      },
      180000
    );

    it(
      'handles combined rename and value update in one request',
      async () => {
        const original = {
          profile: {
            first_name: 'Sam',
            last_name: 'Lee',
          },
        };

        const result = await aiModifyObject(
          createClient(),
          original,
          'In profile, rename first_name to firstName and update last_name to "Li".'
        );

        expect(result.profile.firstName).toBe('Sam');
        expect(result.profile.last_name).toBe('Li');
        expect('first_name' in result.profile).toBe(false);

        // Expect the original to be unmodified.
        expect(original).not.toBe(result);
        expect(original.profile).toEqual({
          first_name: 'Sam',
          last_name: 'Lee',
        });
      },
      180000
    );

    it(
      'supports order-sensitive array edits for checklist-style prompts',
      async () => {
        const original = {
          steps: ['draft', 'review', 'publish'],
        };

        const result = await aiModifyObject(
          createClient(),
          original,
          'In steps, insert "plan" at the beginning and remove "review". Keep the remaining order intact.'
        );

        expect(Array.isArray(result.steps)).toBe(true);
        expect(result.steps[0]).toBe('plan');
        expect(result.steps).not.toContain('review');
        expect(result.steps).toContain('draft');
        expect(result.steps).toContain('publish');
        expect(result.steps.indexOf('draft')).toBeLessThan(result.steps.indexOf('publish'));

        // Expect the original to be unmodified.
        expect(original).not.toBe(result);
        expect(original.steps).toEqual(['draft', 'review', 'publish']);
      },
      180000
    );
  });

  describe('onValidateBeforeReturn', () => {
    it(
      'should validate if errors array is missing',
      async () => {
        const original = {
          name: 'Test Product',
          price: 100,
        };

        // Validator returns an empty object.
        // No correction, no errors.
        const onValidateBeforeReturn = async (obj: any) => ({});

        const result = await aiModifyObject(
          createClient(),
          original,
          'Increase the price by 10%',
          { onValidateBeforeReturn }
        );

        expect(result.price).toBe(110);

        // Expect the original to be unmodified.
        expect(original).not.toBe(result);
        expect(original.price).toBe(100);
        expect(original.name).toBe('Test Product');
      },
      180000
    );

    it(
      'should validate if errors array is empty',
      async () => {
        const original = {
          name: 'Test Product',
          price: 100,
        };

        // Validator returns an empty object.
        // No correction, no errors.
        const onValidateBeforeReturn = async (obj: any) => ({ errors: [] as string[] });

        const result = await aiModifyObject(
          createClient(),
          original,
          'Increase the price by 10%',
          { onValidateBeforeReturn }
        );

        expect(result.price).toBe(110);

        // Expect the original to be unmodified.
        expect(original).not.toBe(result);
        expect(original.price).toBe(100);
        expect(original.name).toBe('Test Product');
      },
      180000
    );

    it(
      'should apply changes enumerated in validation errors',
      async () => {
        const original = {
          name: 'Test Product',
          price: 100,
        };

        // Validator returns an empty object.
        // No correction, no errors.
        const onValidateBeforeReturn = async (obj: any) => {
          const errors: string[] = [];
          if (!obj.id) {
            errors.push('Object needs an `id` field. Set its value to `001`.');
          }
          if (!obj.date) {
            errors.push('Object needs a `date` field. Set its value to `2024-01-01`.');
          }
          return { errors };
        };

        const result = await aiModifyObject(
          createClient(),
          original,
          'Increase the price by 10%',
          { onValidateBeforeReturn }
        );

        expect(result.price).toBe(110);
        expect(result.id).toBe('001');
        expect(result.date).toBe('2024-01-01');

        // Expect the original to be unmodified.
        expect(original).not.toBe(result);
        expect(original.price).toBe(100);
        expect(original.name).toBe('Test Product');
      },
      180000
    );

    it(
      'should use corrected object',
      async () => {
        const original = {
          name: 'Test Product',
          price: 100,
        };

        // Validator returns an empty object.
        // No correction, no errors.
        const onValidateBeforeReturn = async (obj: any) => {
          obj.id = '001';
          obj.date = '2024-01-01';
          return { objCorrected: obj };
        };

        const result = await aiModifyObject(
          createClient(),
          original,
          'Increase the price by 10%',
          { onValidateBeforeReturn }
        );

        expect(result.price).toBe(110);
        expect(result.id).toBe('001');
        expect(result.date).toBe('2024-01-01');

        // Expect the original to be unmodified.
        expect(original).not.toBe(result);
        expect(original.price).toBe(100);
        expect(original.name).toBe('Test Product');
      },
      180000
    );

    it(
      'should use corrected object and also apply enumerated changes',
      async () => {
        const original = {
          name: 'Test Product',
          price: 100,
        };

        // Validator returns an empty object.
        // No correction, no errors.
        const onValidateBeforeReturn = async (obj: any) => {
          const errors: string[] = [];
          obj.id = '001';
          if (!obj.date) {
            errors.push('Object needs a `date` field. Set its value to `2024-01-01`.');
          }
          return { objCorrected: obj, errors };
        };

        const result = await aiModifyObject(
          createClient(),
          original,
          'Increase the price by 10%',
          { onValidateBeforeReturn }
        );

        expect(result.price).toBe(110);
        expect(result.id).toBe('001');
        expect(result.date).toBe('2024-01-01');

        // Expect the original to be unmodified.
        expect(original).not.toBe(result);
        expect(original.price).toBe(100);
        expect(original.name).toBe('Test Product');
      },
      180000
    );

    it(
      'should be okay if onValidateBeforeReturn returns undefined',
      async () => {
        const original = {
          name: 'Test Product',
          price: 100,
        };

        // Validator returns an empty object.
        // No correction, no errors.
        const onValidateBeforeReturn = async (obj: any) => undefined;

        const result = await aiModifyObject(
          createClient(),
          original,
          'Increase the price by 10%',
          { onValidateBeforeReturn }
        );

        expect(result.price).toBe(110);

        // Expect the original to be unmodified.
        expect(original).not.toBe(result);
        expect(original.price).toBe(100);
      },
      180000
    );
  });

  describe('onWorkInProgress', () => {
    it(
      'should call onWorkInProgress after each iteration',
      async () => {
        const original = {
          name: 'Test Product',
          price: 100,
        };

        let workInProgressCallCount = 0;
        const onWorkInProgress = async (obj: any) => {
          workInProgressCallCount++;
        };

        const result = await aiModifyObject(
          createClient(),
          original,
          'Increase the price by 10%',
          { onWorkInProgress }
        );

        expect(result.price).toBe(110);
        expect(workInProgressCallCount).toEqual(1);
      },
      180000
    );

    it(
      'should replace object when onWorkInProgress returns a new object',
      async () => {
        const original = {
          name: 'Test Product',
          price: 100,
        };

        let workInProgressCallCount = 0;
        const onWorkInProgress = async (obj: any) => {
          workInProgressCallCount++;
          return {
            ...obj,
            id: '001',
            date: '2024-01-01'
          };
        };

        const result = await aiModifyObject(
          createClient(),
          original,
          'Increase the price by 10%',
          { onWorkInProgress }
        );

        expect(result.price).toBe(110);
        expect(result.id).toBe('001');
        expect(result.date).toBe('2024-01-01');
        expect(workInProgressCallCount).toEqual(1);
      },
      180000
    );

    it(
      'should propagate an error from onWorkInProgress',
      async () => {
        const original = {
          name: 'Test Product',
          price: 100,
        };

        const uniqueErrorString = 'Super unique error string very recognize much distinct wow';
        const onWorkInProgress = async (obj: any) => {
          throw new Error(uniqueErrorString);
        };

        await expect(
          aiModifyObject(
            createClient(),
            original,
            'Increase the price by 10%',
            { onWorkInProgress }
          )
        ).rejects.toThrow(uniqueErrorString);
      },
      180000
    );
  });

  describe('bulk operations', () => {
    it(
      'should copy a nested object in a dict in a single iteration',
      async () => {
        const original = {
          'ernie': {
            'species': 'muppet',
            'gender': 'male',
            'address': {
              'street_name': 'Sesame St',
              'house_number': '123',
              'unit': { "floor": 1, 'number': '1D' },
              'city': 'Sesame City'
            }
          }
        };

        let numTimesWorkInProgressCalled = 0;

        const onWorkInProgress = async (obj: any) => {
          numTimesWorkInProgressCalled++;
        };

        // NOTE: In order to make sure the AI understands that it's supposed to use the
        // bulk "copy" operation, we need to explicitly tell it to do so.
        const result = await aiModifyObject(
          createClient(),
          original,
          'Create a new character, `bert`, by copying the entire `ernie` object ' +
          'using the bulk "copy" action. Keep all data the same.',
          { onWorkInProgress }
        );

        // Expect the original to have 1 character, and the result to have 2.
        expect(Object.keys(original)).toHaveLength(1);
        expect(Object.keys(result)).toHaveLength(2);

        // Expect the result to have both `ernie` and `bert` with the same data.
        expect(result.ernie).toEqual(original.ernie);
        expect(result.bert).toEqual(original.ernie);

        // Expect the work in progress callback to have only been called once.
        // Without the bulk operator, it would have been called at least 3 times minimum.
        expect(numTimesWorkInProgressCalled).toEqual(1);
      },
      180000
    );

    it(
      'should append a copy of a nested object in a list in 2 or fewer iterations',
      async () => {
        const original = {
          'sesame_street_characters': [
            {
              'name': 'Ernie',
              'species': 'muppet',
              'gender': 'male',
              'address': {
                'street_name': 'Sesame St',
                'house_number': '123',
                'unit': { "floor": 1, 'number': '1D' },
                'city': 'Sesame City'
              }
            },
            {
              'name': 'Oscar',
              'species': 'muppet',
              'gender': 'male',
              'address': {
                'street_name': 'Sesame St',
                'house_number': 'none',
                'unit': { "floor": 0, 'number': 'none' },
                'city': 'Sesame City'
              }
            }
          ]
        };

        let numTimesWorkInProgressCalled = 0;

        const onWorkInProgress = async (obj: any) => {
          numTimesWorkInProgressCalled++;
        };

        // NOTE: In order to make sure the AI understands that it's supposed to use the
        // bulk "copy" operation, we need to explicitly use the word "copy" in the instructions.
        const result = await aiModifyObject(
          createClient(),
          original,
          'Create a new character, "Bert", by copying the entire "Ernie" object ' +
          'using the bulk "copy" action. Keep all data the same (except the name, of course). ' +
          'Append Bert to the end of the sesame_street_characters array.',
          { onWorkInProgress }
        );

        // Expect the result to have both `Ernie` and `Bert` with the same data.
        expect(original.sesame_street_characters).toHaveLength(2);
        expect(result.sesame_street_characters).toHaveLength(3);
        expect(result.sesame_street_characters[0]).toEqual(original.sesame_street_characters[0]);

        const expectBert = JSON.parse(JSON.stringify(original.sesame_street_characters[0]));
        expectBert.name = 'Bert';
        expect(result.sesame_street_characters[2]).toEqual(expectBert);

        // Expect the work in progress callback to have been called 2 times or fewer.
        // It's possible that the AI will be smart enough to do this in a single iteration,
        // but we want to allow for the possibility that it'll use its first iteration
        // to create the copy and its second one to name it Bert. The important thing is that
        // if it *doesn't* use the copy operation, then the smallest number of steps it'll be
        // able to use is 3, so this test will detect that.
        expect(numTimesWorkInProgressCalled).toBeLessThanOrEqual(2);
      },
      180000
    );

    it(
      'should insert a copy of a nested object in a list in 2 or fewer iterations',
      async () => {
        const original = {
          'sesame_street_characters': [
            {
              'name': 'Ernie',
              'species': 'muppet',
              'gender': 'male',
              'address': {
                'street_name': 'Sesame St',
                'house_number': '123',
                'unit': { "floor": 1, 'number': '1D' },
                'city': 'Sesame City'
              }
            },
            {
              'name': 'Oscar',
              'species': 'muppet',
              'gender': 'male',
              'address': {
                'street_name': 'Sesame St',
                'house_number': 'none',
                'unit': { "floor": 0, 'number': 'none' },
                'city': 'Sesame City'
              }
            }
          ]
        };

        let numTimesWorkInProgressCalled = 0;

        const onWorkInProgress = async (obj: any) => {
          numTimesWorkInProgressCalled++;
        };

        // NOTE: In order to make sure the AI understands that it's supposed to use the
        // bulk "copy" operation, we need to explicitly use the word "copy" in the instructions.
        const result = await aiModifyObject(
          createClient(),
          original,
          'Create a new character, "Bert", by copying the entire "Ernie" object ' +
          'using the bulk "copy" action. Keep all data the same (except the name, of course). ' +
          'Insert Bert after Ernie in the sesame_street_characters array.',
          { onWorkInProgress }
        );

        // Expect the result to have both `Ernie` and `Bert` with the same data.
        expect(original.sesame_street_characters).toHaveLength(2);
        expect(result.sesame_street_characters).toHaveLength(3);
        expect(result.sesame_street_characters[0]).toEqual(original.sesame_street_characters[0]);

        const expectBert = JSON.parse(JSON.stringify(original.sesame_street_characters[0]));
        expectBert.name = 'Bert';
        expect(result.sesame_street_characters[1]).toEqual(expectBert);

        // Expect the work in progress callback to have been called 2 times or fewer.
        // It's possible that the AI will be smart enough to do this in a single iteration,
        // but we want to allow for the possibility that it'll use its first iteration
        // to create the copy and its second one to name it Bert. The important thing is that
        // if it *doesn't* use the copy operation, then the smallest number of steps it'll be
        // able to use is 3, so this test will detect that.
        expect(numTimesWorkInProgressCalled).toBeLessThanOrEqual(2);
      },
      180000
    );

    it(
      'should move a nested object in a dict in 2 or fewer iterations',
      async () => {
        const original = {
          'sesame_street_characters': {
            'ernie': {
              'species': 'muppet',
              'gender': 'male',
              'address': {
                'street_name': 'Sesame St',
                'house_number': '123',
                'unit': { "floor": 1, 'number': '1D' },
                'city': 'Sesame City'
              }
            },
          },
          'adventure_time_characters': {
            'finn': {
              'species': 'human',
              'gender': 'male',
              'address': {
                'street_name': 'Tree Fort Ln',
                'house_number': '1',
                'unit': { "floor": 1, 'number': '1A' },
                'city': 'Ooo'
              }
            },
            'bert': {
              'species': 'muppet',
              'gender': 'male',
              'address': {
                'street_name': 'Sesame St',
                'house_number': '123',
                'unit': { "floor": 1, 'number': '1D' },
                'city': 'Sesame City'
              }
            },
          }
        };

        let numTimesWorkInProgressCalled = 0;

        const onWorkInProgress = async (obj: any) => {
          numTimesWorkInProgressCalled++;
        };

        // NOTE: The AI should be smart enough to realize that it needs to use the
        // bulk operation in order to complete this task, but let's explicitly tell
        // it to do so just to be sure.
        const result = await aiModifyObject(
          createClient(),
          original,
          'The character "bert" is misfiled under adventure_time_characters. ' +
          'He should be under sesame_street_characters. Move him there, preferably ' +
          'using a bulk copy/move operation if possible.',
          { onWorkInProgress }
        );

        // Expect the original to be untouched.
        expect(Object.keys(original.sesame_street_characters)).toHaveLength(1);
        expect(Object.keys(original.adventure_time_characters)).toHaveLength(2);

        // Expect the correct number of characters in each group.
        expect(Object.keys(result.sesame_street_characters)).toHaveLength(2);
        expect(Object.keys(result.adventure_time_characters)).toHaveLength(1);

        // Expect Bert to have the same data as he originally did.
        expect(result.sesame_street_characters['bert']).toEqual(
          original.adventure_time_characters['bert']
        );

        // Expect the move to have completed in 2 or fewer iterations.
        // One to copy the object to the new group, one to delete the original.
        // We're not really testing the implementation, because the point is that
        // atomic piecewise movement would take 4 or 5 steps.
        expect(numTimesWorkInProgressCalled).toBeLessThanOrEqual(2);
      },
      180000
    );

    it(
      'should move a nested object from one list to another in few iterations',
      async () => {
        const original = {
          'sesame_street_characters': [
            {
              'name': 'Ernie',
              'species': 'muppet',
              'gender': 'male',
              'address': {
                'street_name': 'Sesame St',
                'house_number': '123',
                'unit': { "floor": 1, 'number': '1D' },
                'city': 'Sesame City'
              },
            },
            {
              'name': 'Oscar',
              'species': 'muppet',
              'gender': 'male',
              'address': {
                'street_name': 'Sesame St',
                'house_number': 'none',
                'unit': { "floor": 0, 'number': 'none' },
                'city': 'Sesame City'
              }
            }
          ],
          'adventure_time_characters': [
            {
              'name': 'Finn',
              'species': 'human',
              'gender': 'male',
              'address': {
                'street_name': 'Tree Fort Ln',
                'house_number': '1',
                'unit': { "floor": 1, 'number': '1A' },
                'city': 'Ooo'
              }
            },
            {
              'name': 'Bert',
              'species': 'muppet',
              'gender': 'male',
              'address': {
                'street_name': 'Sesame St',
                'house_number': '123',
                'unit': { "floor": 1, 'number': '1D' },
                'city': 'Sesame City'
              }
            },
          ]
        };

        let numTimesWorkInProgressCalled = 0;

        const onWorkInProgress = async (obj: any) => {
          numTimesWorkInProgressCalled++;
        };

        // NOTE: The AI should be smart enough to realize that it needs to use the
        // bulk operation in order to complete this task, but let's explicitly tell
        // it to do so just to be sure.
        const result = await aiModifyObject(
          createClient(),
          original,
          'The character "Bert" is misfiled under adventure_time_characters. ' +
          'He should be under sesame_street_characters. Move him there, right ' +
          'after Ernie, preferably using a bulk copy/move operation if possible.',
          { onWorkInProgress }
        );

        // Expect the original to be untouched.
        expect(original.sesame_street_characters).toHaveLength(2);
        expect(original.adventure_time_characters).toHaveLength(2);

        // Expect the correct number of characters in each group.
        expect(result.sesame_street_characters).toHaveLength(3);
        expect(result.adventure_time_characters).toHaveLength(1);

        // Expect Bert to have the same data as he originally did.
        expect(result.sesame_street_characters[1]).toEqual(
          original.adventure_time_characters[1]
        );

        // Expect the move to have completed in 2 or fewer iterations.
        // One to copy the object to the new group, one to delete the original.
        // We're not really testing the implementation, because the point is that
        // atomic piecewise movement would take 4 or 5 steps.
        expect(numTimesWorkInProgressCalled).toBeLessThanOrEqual(2);
      },
      180000
    );
  });

  describe('giveUp limits', () => {
    it(
      'should give up after iteration limit',
      async () => {
        // We create a hostile validation function that keeps telling it to provide
        // one previously undocumented field after another. "Oh, just one more thing."
        // Eventually, it should give up after a number of iterations.
        const onValidateBeforeReturn = async (obj: any) => {
          const undocumentedFields = ['id', 'date', 'description', 'category', 'status', 'type'];
          for (const field of undocumentedFields) {
            if (!obj[field]) {
              return { errors: [`Object needs a \`${field}\` field.`] };
            }
          }
          return { errors: [] };
        };

        const original: any = {
          name: 'Test Product',
          price: 100,
        };

        try {
          await aiModifyObject(
            createClient(),
            original,
            'Increase the price by 10%',
            {
              onValidateBeforeReturn,
              giveUpAfterIterations: 2,
            }
          );
        } catch (error) {
          expect((error as Error).message.toLowerCase()).toContain('iteration');

          const result = (error as AIModifyObjectError).obj;

          // Expect the result to have at least made it through one iteration.
          expect(result.price).toEqual(110);

          // Make sure that it didn't modify the original object.
          expect(original).not.toEqual(result);
          expect(original.price).toEqual(100);

          return;
        }

        throw new Error('Expected aiModifyObject to throw after reaching iteration limit.');
      },
      180000
    );

    it(
      'should give up after time limit',
      async () => {
        // We create a hostile validation function that keeps telling it to provide
        // one previously undocumented field after another. "Oh, just one more thing."
        // We'll also make the validation callback wait a few seconds.
        // In order to avoid instrumenting a mock, we'll use real time delays.
        // This is generally ill-advised for tests that get run in a CICD pipeline, but
        // we're already issuing real API calls to the OpenAI service in these tests,
        // so this isn't any *more* egregious than that.
        const onValidateBeforeReturn = async (obj: any) => {
          // Sleep for 3 seconds to simulate a delay.
          const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
          await sleep(3000);

          const undocumentedFields = ['id', 'date', 'description'];
          for (const field of undocumentedFields) {
            if (!obj[field]) {
              return { errors: [`Object needs a \`${field}\` field.`] };
            }
          }
          return { errors: [] };
        };

        const original: any = {
          name: 'Test Product',
          price: 100,
        };

        try {
          await aiModifyObject(
            createClient(),
            original,
            'Increase the price by 10%',
            {
              onValidateBeforeReturn,
              giveUpAfterSeconds: 2,
            }
          );
        } catch (error) {
          // We expect the result to hit the time limit before ever completing all validations.
          // Note that we set the time limit to 2 seconds, but each validation
          // callback sleeps for 3 seconds, and we've made it impossible to complete validation
          // in just one pass. As such, it should time out before ever completing all validations.
          // (It's also possible, in fact likely, that it never even reaches the
          // validation step, because it times out just from the time spent on API calls.)
          expect((error as Error).message.toLowerCase()).toContain('seconds');

          const result = (error as AIModifyObjectError).obj;

          // Expect the result to have at least made it through one iteration.
          expect(result.price).toEqual(110);

          // Make sure that it didn't modify the original object.
          expect(original).not.toEqual(result);
          expect(original.price).toEqual(100);

          return;
        }

        throw new Error('Expected aiModifyObject to throw after reaching time limit.');
      },
      180000
    );
  });
});
