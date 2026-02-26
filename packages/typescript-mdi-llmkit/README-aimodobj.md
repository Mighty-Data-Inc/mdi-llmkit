# @kaiizen/aimodobj

`@kaiizen/aimodobj` provides **`aiModifyObject`**, a utility for applying natural-language edit instructions to JSON objects through iterative, structured LLM calls.

## Core capability: `aiModifyObject`

`aiModifyObject` takes:

- an OpenAI client
- an input JSON object
- plain-English modification instructions
- an optional `options` object

and returns a **modified copy** of the object (without mutating the original input).

`options` supports:

- `schemaDescription`
- `skippedKeys`
- `onValidateBeforeReturn`
- `onWorkInProgress`
- `giveUpAfterSeconds`
- `giveUpAfterIterations`

`onValidateBeforeReturn` is asynchronous and can apply final validation feedback before returning the object.
When provided, this callback receives the current object and should return a `Promise` that resolves to:

- `objCorrected`: an optionally corrected object
- `errors`: an optional list of lingering validation errors

If `objCorrected` is returned, that corrected object is used. If `errors` is empty (or omitted), the object is treated as valid.

`onWorkInProgress` is optional and asynchronous. It is called once per iteration with the current object state.
It may return:

- `undefined` to leave the current object unchanged
- a replacement object to continue processing from that new state

This callback is useful for progress logging, metrics, or custom intervention during processing.

`giveUpAfterSeconds` and `giveUpAfterIterations` are optional guardrails. If exceeded,
`aiModifyObject` throws an `AIModifyObjectError`.
In that error, `obj` contains the object being modified in whatever state it was left in when the exception was thrown.

Internally it:

1. Plans modifications with the model.
2. Converts the plan into structured operations (`assign`, `delete`, `append`, `insert`, `rename`).
3. Applies operations incrementally.
4. Verifies each step with the model before accepting/rejecting changes.

## Primary usage

```ts
import { OpenAI } from 'openai';
import { aiModifyObject } from './src/aiModifyObject';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const input = {
  status: 'pending',
  tags: ['alpha'],
  profile: {},
};

const result = await aiModifyObject(
  client,
  input,
  'Set status to "approved", append "done" to tags, and add profile.owner = "ops".',
  {
    skippedKeys: ['internalToken'],
    giveUpAfterIterations: 10,
    onValidateBeforeReturn: async obj => {
      if (!obj.status) {
        return { errors: ['Object must include a status field.'] };
      }
      return { errors: [] };
    },
    onWorkInProgress: async obj => {
      console.log('progress update', { keys: Object.keys(obj) });
      return undefined;
    },
  }
);

console.log(result);
```

## Live integration tests (recommended)

This package includes live tests for prompt/behavior validation in `src/tests/aiModifyObject.test.ts`.

- gated by `OPENAI_API_KEY`
- uses semantic assertions (final object outcomes) instead of brittle internal-step assertions
- designed to validate real prompt reliability, not mocked behavior

## Supporting utilities

The package also contains helper utilities used to support the main `aiModifyObject` workflow:

- `placemarkedJSONStringify`: formats JSON with location placemarks to improve model navigation.
- `navigateToJSONPath`: resolves JSON paths and returns `{ pathParent, pathKeyOrIndex, pathTarget }`.

These are implementation-support tools; they are not the primary value proposition of the package.

## Scripts

From `packages/publishable/aimodobj`:

- `npm test`
- `npm run test:watch`
- `npm run test:coverage`
- `npm run check:types`

## Practical notes

- `aiModifyObject` performs multiple model calls per request, so latency/cost can be non-trivial.
- Clear, specific instructions produce more reliable outcomes.
- Providing `schemaDescription` and `skippedKeys` improves safety and token efficiency.
- Use `giveUpAfterSeconds` / `giveUpAfterIterations` to bound long-running edit loops.
