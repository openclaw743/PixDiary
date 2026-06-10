# AI VCR-style fixtures

These JSON files are full Azure OpenAI chat completion responses recorded once
and replayed in tests so the suite never hits the real Azure OpenAI service
on CI.

Each file mirrors the shape that `openai`'s SDK returns from
`client.chat.completions.create()`. The `_meta` block is local context for
humans; the rest is the verbatim response shape.

## Naming

- `vision-<scene-name>.json` — gpt-4o-mini vision responses
- `draft-<place>.json` — gpt-4o-mini diary draft responses
- `vision-partial-*.json`, `vision-fenced-*.json` — parser edge-case shapes

## How to record a new fixture

Set `AZURE_OPENAI_API_KEY` locally, call the helper once with `record: true`,
and write the JSON to this folder. The orchestrator tests will then replay it.

```ts
// pseudo
const response = await client.chat.completions.create({...});
fs.writeFileSync('tests/fixtures/ai/vision-new.json', JSON.stringify(response, null, 2));
```

## Why a folder at repo root

Issue #13 acceptance criterion: "Test data factories in `tests/factories/`",
"recorded fixtures" under `tests/fixtures/ai/`. Keeping these at the
*repository* root (not under `backend/`) lets E2E tests reuse them too.
