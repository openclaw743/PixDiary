/**
 * Unit tests for aiClient pure helpers + AI_DISABLED short-circuit + fake-client path.
 *
 * No real Azure OpenAI calls are made.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AzureOpenAI } from 'openai';
import { resetConfigCache } from '../config';
import {
  deploymentForTier,
  generateDraft,
  modelNameForTier,
  resetAzureOpenAICache,
  visionDescribePhoto,
} from './aiClient';

function setEnv(overrides: Record<string, string | undefined> = {}): void {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgres://localhost:5432/pixdiary';
  process.env.JWT_SECRET = 'aiclient-secret-aiclient-secret-aiclient-secret';
  delete process.env.AI_DISABLED;
  delete process.env.AZURE_OPENAI_DEPLOYMENT_DEFAULT;
  delete process.env.AZURE_OPENAI_DEPLOYMENT_BETTER;
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetConfigCache();
  resetAzureOpenAICache();
}

describe('deploymentForTier / modelNameForTier', () => {
  beforeEach(() => setEnv());
  afterEach(() => setEnv());

  it('default tier returns the configured default deployment', () => {
    expect(deploymentForTier('default')).toBe('gpt-4o-mini');
    expect(modelNameForTier('default')).toBe('gpt-4o-mini');
  });

  it('better tier returns the configured better deployment', () => {
    expect(deploymentForTier('better')).toBe('gpt-4o');
    expect(modelNameForTier('better')).toBe('gpt-4o');
  });

  it('custom deployment alias falls back to the canonical model name', () => {
    setEnv({
      AZURE_OPENAI_DEPLOYMENT_DEFAULT: 'mini-prod',
      AZURE_OPENAI_DEPLOYMENT_BETTER: 'big-prod',
    });
    expect(deploymentForTier('default')).toBe('mini-prod');
    expect(modelNameForTier('default')).toBe('gpt-4o-mini');
    expect(modelNameForTier('better')).toBe('gpt-4o');
  });
});

describe('visionDescribePhoto', () => {
  beforeEach(() => setEnv());
  afterEach(() => setEnv());

  it('AI_DISABLED short-circuits with a placeholder result', async () => {
    setEnv({ AI_DISABLED: 'true' });
    const r = await visionDescribePhoto({ imageBase64: 'AAAA', mimeType: 'image/jpeg' });
    expect(r.scene).toBe('(ai disabled)');
    expect(r.tokensIn).toBe(0);
    expect(r.tokensOut).toBe(0);
  });

  it('parses well-formed JSON from a fake client', async () => {
    const fake = {
      chat: {
        completions: {
          create: async () => ({
            choices: [
              {
                message: {
                  content:
                    '{"scene":"a beach","subjects":["sand","wave"],"mood":"calm","weather":"sunny","activity":"walking"}',
                },
              },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 30 },
          }),
        },
      },
    } as unknown as AzureOpenAI;
    const r = await visionDescribePhoto(
      { imageBase64: 'AAAA', mimeType: 'image/jpeg' },
      { client: fake },
    );
    expect(r.scene).toBe('a beach');
    expect(r.subjects).toEqual(['sand', 'wave']);
    expect(r.mood).toBe('calm');
    expect(r.tokensIn).toBe(100);
    expect(r.tokensOut).toBe(30);
  });

  it('handles ```json fences and missing fields gracefully', async () => {
    const fake = {
      chat: {
        completions: {
          create: async () => ({
            choices: [
              {
                message: {
                  content: '```json\n{"scene":"  ","subjects":"not-an-array"}\n```',
                },
              },
            ],
            usage: { prompt_tokens: 50, completion_tokens: 10 },
          }),
        },
      },
    } as unknown as AzureOpenAI;
    const r = await visionDescribePhoto(
      { imageBase64: 'AAAA', mimeType: 'image/jpeg' },
      { client: fake },
    );
    expect(r.scene).toBe('');
    expect(r.subjects).toEqual([]);
    expect(r.mood).toBeNull();
  });

  it('returns empty fields when response is invalid JSON', async () => {
    const fake = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ message: { content: 'not json at all' } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
        },
      },
    } as unknown as AzureOpenAI;
    const r = await visionDescribePhoto(
      { imageBase64: 'AAAA', mimeType: 'image/jpeg' },
      { client: fake },
    );
    expect(r.scene).toBe('');
    expect(r.subjects).toEqual([]);
  });
});

describe('generateDraft', () => {
  beforeEach(() => setEnv());
  afterEach(() => setEnv());

  it('AI_DISABLED returns a deterministic placeholder', async () => {
    setEnv({ AI_DISABLED: 'true' });
    const r = await generateDraft({
      entryDate: '2025-05-08',
      placeNames: [],
      photoDescriptions: [],
      voicePrompt: '',
      tier: 'default',
    });
    expect(r.text).toContain('ai disabled');
    expect(r.modelUsed).toBe('gpt-4o-mini');
  });

  it('builds a draft body and reports token usage with a fake client', async () => {
    let captured: unknown;
    const fake = {
      chat: {
        completions: {
          create: async (req: unknown) => {
            captured = req;
            return {
              choices: [{ message: { content: 'A bright spring day in Copenhagen.' } }],
              usage: { prompt_tokens: 1200, completion_tokens: 150 },
            };
          },
        },
      },
    } as unknown as AzureOpenAI;
    const r = await generateDraft(
      {
        entryDate: '2025-05-08',
        placeNames: ['Copenhagen'],
        photoDescriptions: [
          {
            scene: 'a canal',
            subjects: ['boat', 'bridge'],
            mood: 'calm',
            weather: 'sunny',
            activity: 'walking',
            raw: {},
            tokensIn: 50,
            tokensOut: 10,
          },
        ],
        voicePrompt: 'Match my voice: short sentences.',
        tier: 'better',
      },
      { client: fake },
    );
    expect(r.text).toContain('Copenhagen');
    expect(r.modelUsed).toBe('gpt-4o');
    expect(r.tokensIn).toBe(1200);
    expect(r.tokensOut).toBe(150);
    expect(captured).toBeTruthy();
  });

  it('handles empty draft without throwing and returns empty text', async () => {
    const fake = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ message: { content: '   ' } }],
            usage: undefined,
          }),
        },
      },
    } as unknown as AzureOpenAI;
    const r = await generateDraft(
      {
        entryDate: '2025-05-08',
        placeNames: [],
        photoDescriptions: [],
        voicePrompt: '',
        tier: 'default',
      },
      { client: fake },
    );
    expect(r.text).toBe('');
    expect(r.tokensIn).toBe(0);
    expect(r.tokensOut).toBe(0);
  });
});
