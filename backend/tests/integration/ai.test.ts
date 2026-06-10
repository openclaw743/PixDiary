/**
 * AI integration tests with recorded ("VCR") fixtures.
 *
 * These tests cover the AI client surfaces (`visionDescribePhoto`,
 * `generateDraft`) and the parser-tolerance edge cases without ever hitting
 * the real Azure OpenAI service. Each call swaps in a fake `AzureOpenAI`
 * whose `chat.completions.create()` returns a pre-recorded response shape
 * from `tests/fixtures/ai/`.
 *
 * The tests assert:
 *   - normal happy path → fields parsed correctly + tokens propagated
 *   - missing optional fields → null/empty without throwing
 *   - markdown-fenced JSON → still parses
 *   - draft generation → text + token usage propagated
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  generateDraft,
  visionDescribePhoto,
  type DraftInput,
} from '../../src/services/aiClient';
import { resetConfigCache } from '../../src/config';

const FIXTURES_DIR = path.resolve(__dirname, '../../../tests/fixtures/ai');

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, name), 'utf8'));
}

/**
 * Build a minimum fake AzureOpenAI client. Only `chat.completions.create()`
 * is reached by the production code under test.
 */
function makeFakeClient(response: unknown): unknown {
  const create = async (): Promise<unknown> => response;
  return {
    chat: {
      completions: { create },
    },
  };
}

function setAiEnv(): void {
  // Force AI_DISABLED off and provide config the schema requires.
  delete process.env.AI_DISABLED;
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgres://noop@127.0.0.1:1/noop';
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret';
  process.env.AZURE_OPENAI_ENDPOINT = 'https://example.invalid';
  process.env.AZURE_OPENAI_API_KEY = 'test-key';
  process.env.AZURE_OPENAI_DEPLOYMENT_DEFAULT = 'gpt-4o-mini';
  process.env.AZURE_OPENAI_DEPLOYMENT_BETTER = 'gpt-4o';
  process.env.LOG_LEVEL = 'silent';
  resetConfigCache();
}

describe('AI VCR: visionDescribePhoto', () => {
  it('parses a clean beach-sunset response into the typed VisionResult', async () => {
    setAiEnv();
    const fixture = loadFixture('vision-beach-sunset.json');
    const client = makeFakeClient(fixture) as never;
    const r = await visionDescribePhoto(
      { imageBase64: 'AAAA', mimeType: 'image/jpeg' },
      { client },
    );
    expect(r.scene).toMatch(/sandy beach/i);
    expect(r.subjects).toEqual(['beach', 'sunset', 'solitary walker']);
    expect(r.mood).toBe('contemplative');
    expect(r.weather).toBe('clear and warm');
    expect(r.activity).toBe('evening walk');
    expect(r.tokensIn).toBe(1240);
    expect(r.tokensOut).toBe(88);
  });

  it('parses a city-street response and extracts subjects', async () => {
    setAiEnv();
    const fixture = loadFixture('vision-city-street.json');
    const client = makeFakeClient(fixture) as never;
    const r = await visionDescribePhoto(
      { imageBase64: 'AAAA', mimeType: 'image/jpeg' },
      { client },
    );
    expect(r.subjects).toContain('cafe');
    expect(r.mood).toBe('relaxed');
    expect(r.tokensIn).toBe(1295);
    expect(r.tokensOut).toBe(92);
  });

  it('tolerates a response missing optional fields (mood/weather/activity)', async () => {
    setAiEnv();
    const fixture = loadFixture('vision-partial-response.json');
    const client = makeFakeClient(fixture) as never;
    const r = await visionDescribePhoto(
      { imageBase64: 'AAAA', mimeType: 'image/jpeg' },
      { client },
    );
    expect(r.scene).toMatch(/coffee/);
    expect(r.subjects).toEqual(['coffee cup']);
    expect(r.mood).toBeNull();
    expect(r.weather).toBeNull();
    expect(r.activity).toBeNull();
  });

  it('strips markdown ```json fences before parsing', async () => {
    setAiEnv();
    const fixture = loadFixture('vision-fenced-json.json');
    const client = makeFakeClient(fixture) as never;
    const r = await visionDescribePhoto(
      { imageBase64: 'AAAA', mimeType: 'image/jpeg' },
      { client },
    );
    expect(r.scene).toMatch(/ramen/i);
    expect(r.subjects).toEqual(['ramen bowl', 'egg', 'chashu']);
    expect(r.mood).toBe('hungry');
    expect(r.activity).toBe('eating out');
  });

  it('returns the deterministic placeholder when AI_DISABLED=true', async () => {
    process.env.AI_DISABLED = 'true';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgres://noop@127.0.0.1:1/noop';
    process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret';
    process.env.AZURE_OPENAI_ENDPOINT = 'https://example.invalid';
    process.env.LOG_LEVEL = 'silent';
    resetConfigCache();

    const r = await visionDescribePhoto({ imageBase64: 'AAAA', mimeType: 'image/jpeg' });
    expect(r.scene).toBe('(ai disabled)');
    expect(r.tokensIn).toBe(0);
    expect(r.tokensOut).toBe(0);

    delete process.env.AI_DISABLED;
    resetConfigCache();
  });
});

describe('AI VCR: generateDraft', () => {
  function visionFor(scene: string, subjects: string[]): import('../../src/services/aiClient').VisionResult {
    return {
      scene,
      subjects,
      mood: null,
      weather: null,
      activity: null,
      raw: {},
      tokensIn: 0,
      tokensOut: 0,
    };
  }

  it('produces a draft from two photo descriptions + a place name', async () => {
    setAiEnv();
    const fixture = loadFixture('draft-copenhagen.json');
    const client = makeFakeClient(fixture) as never;
    const input: DraftInput = {
      entryDate: '2025-05-08',
      placeNames: ['Copenhagen, Denmark'],
      photoDescriptions: [
        visionFor('Narrow cobblestone street', ['cafe', 'cobblestone street']),
        visionFor('Wide sandy beach at low tide', ['beach', 'sunset']),
      ],
      voicePrompt: '',
      tier: 'default',
    };
    const r = await generateDraft(input, { client });
    expect(r.text.length).toBeGreaterThan(200);
    expect(r.text.toLowerCase()).toMatch(/copenhagen|beach|coffee|cobblestone/);
    expect(r.modelUsed).toBe('gpt-4o-mini');
    expect(r.tokensIn).toBe(380);
    expect(r.tokensOut).toBe(196);
  });

  it('respects the tier override (better → gpt-4o)', async () => {
    setAiEnv();
    const fixture = loadFixture('draft-copenhagen.json');
    const client = makeFakeClient(fixture) as never;
    const input: DraftInput = {
      entryDate: '2025-05-08',
      placeNames: [],
      photoDescriptions: [visionFor('A test photo', ['subject'])],
      voicePrompt: '',
      tier: 'better',
    };
    const r = await generateDraft(input, { client });
    expect(r.modelUsed).toBe('gpt-4o');
  });
});

describe('AI VCR: empty / degraded model responses', () => {
  it('returns empty VisionResult when the model returns invalid JSON', async () => {
    setAiEnv();
    const broken = {
      choices: [{ message: { content: 'this is not json at all' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };
    const client = makeFakeClient(broken) as never;
    const r = await visionDescribePhoto(
      { imageBase64: 'AAAA', mimeType: 'image/jpeg' },
      { client },
    );
    expect(r.scene).toBe('');
    expect(r.subjects).toEqual([]);
    expect(r.mood).toBeNull();
    expect(r.tokensIn).toBe(10);
    expect(r.tokensOut).toBe(5);
  });

  it('returns an empty draft when the model returns no content', async () => {
    setAiEnv();
    const empty = {
      choices: [{ message: { content: '' } }],
      usage: { prompt_tokens: 100, completion_tokens: 0 },
    };
    const client = makeFakeClient(empty) as never;
    const r = await generateDraft(
      {
        entryDate: '2025-05-08',
        placeNames: [],
        photoDescriptions: [],
        voicePrompt: '',
        tier: 'default',
      },
      { client },
    );
    expect(r.text).toBe('');
    expect(r.tokensIn).toBe(100);
    expect(r.tokensOut).toBe(0);
  });
});
