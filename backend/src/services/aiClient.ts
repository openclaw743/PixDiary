/**
 * Azure OpenAI client wrapper.
 *
 * Two deployment choices:
 *   - DEFAULT  (gpt-4o-mini)  — vision and standard draft.
 *   - BETTER   (gpt-4o)        — only when user requests `regenerate?quality=better`.
 *
 * Auth:
 *   Prefer DefaultAzureCredential (managed identity). API-key fallback for
 *   local/CI when AZURE_OPENAI_API_KEY is set.
 *
 * The `AI_DISABLED` flag short-circuits all calls — used by tests that don't
 * want to mock outbound HTTP.
 */
import { AzureOpenAI } from 'openai';
import {
  ChatCompletion,
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import { getConfig } from '../config';
import { getLogger } from '../log';

export type ModelTier = 'default' | 'better';

let cached: AzureOpenAI | null = null;
let cachedTier: ModelTier | null = null;

function buildClient(): AzureOpenAI {
  const cfg = getConfig();
  if (!cfg.AZURE_OPENAI_ENDPOINT) {
    throw new Error('AZURE_OPENAI_ENDPOINT is not configured');
  }
  if (cfg.AZURE_OPENAI_API_KEY) {
    return new AzureOpenAI({
      endpoint: cfg.AZURE_OPENAI_ENDPOINT,
      apiKey: cfg.AZURE_OPENAI_API_KEY,
      apiVersion: cfg.AZURE_OPENAI_API_VERSION,
    });
  }
  /* c8 ignore start */
  const tokenProvider = getBearerTokenProvider(
    new DefaultAzureCredential(),
    'https://cognitiveservices.azure.com/.default',
  );
  return new AzureOpenAI({
    endpoint: cfg.AZURE_OPENAI_ENDPOINT,
    azureADTokenProvider: tokenProvider,
    apiVersion: cfg.AZURE_OPENAI_API_VERSION,
  });
  /* c8 ignore stop */
}

export function getAzureOpenAI(): AzureOpenAI {
  if (!cached) cached = buildClient();
  return cached;
}

export function deploymentForTier(tier: ModelTier): string {
  const cfg = getConfig();
  return tier === 'better' ? cfg.AZURE_OPENAI_DEPLOYMENT_BETTER : cfg.AZURE_OPENAI_DEPLOYMENT_DEFAULT;
}

export function modelNameForTier(tier: ModelTier): string {
  // Used as the cost-ledger key. Map the deployment alias to the canonical
  // pricing model. Architect doc pins these names, so we accept the deployment
  // name as the model name when it equals the canonical, else fall back.
  const dep = deploymentForTier(tier);
  if (dep === 'gpt-4o' || dep === 'gpt-4o-mini') return dep;
  // Custom deployment alias — fall back to the canonical name for pricing.
  return tier === 'better' ? 'gpt-4o' : 'gpt-4o-mini';
}

/** Reset the cached client (test helper / config reload). */
export function resetAzureOpenAICache(): void {
  cached = null;
  cachedTier = null;
}

/* c8 ignore start */
// Tier cache is unused but kept for future tier-pinned clients.
void cachedTier;
/* c8 ignore stop */

/* ---------- High-level helpers ---------- */

export interface VisionInput {
  /** Base64-encoded image bytes. */
  imageBase64: string;
  mimeType: string;
}

export interface VisionResult {
  scene: string;
  subjects: string[];
  mood: string | null;
  weather: string | null;
  activity: string | null;
  /** Raw model JSON for audit. */
  raw: Record<string, unknown>;
  tokensIn: number;
  tokensOut: number;
}

export interface DraftInput {
  entryDate: string;
  placeNames: string[];
  photoDescriptions: VisionResult[];
  voicePrompt: string;
  tier: ModelTier;
}

export interface DraftResult {
  text: string;
  modelUsed: string;
  tokensIn: number;
  tokensOut: number;
}

export interface CallerOpts {
  /** Inject a fake AzureOpenAI for tests. */
  client?: AzureOpenAI;
}

const VISION_SYSTEM_PROMPT =
  'You describe photos for a personal diary. Be factual; do not speculate about identities. Output ONLY JSON in this exact shape: {"scene": string, "subjects": string[], "mood": string|null, "weather": string|null, "activity": string|null}. 2-3 sentences worth of detail in scene.';

const DRAFT_SYSTEM_PROMPT_BASE =
  'You write a first-person diary entry in past tense, ~150-250 words, for the given date and location. Be specific and grounded — only use facts supported by the photo descriptions and place names provided. Do not invent feelings the photos do not support. Output PLAIN TEXT only (no markdown headings).';

function parseJsonObject(text: string): Record<string, unknown> {
  // Models sometimes wrap with ```json fences. Strip them.
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  try {
    const obj = JSON.parse(cleaned);
    return typeof obj === 'object' && obj !== null ? (obj as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === 'string' ? x.trim() : null))
    .filter((s): s is string => !!s && s.length > 0);
}

/**
 * Run a vision call on a single image. Returns parsed scene + token usage.
 */
export async function visionDescribePhoto(
  input: VisionInput,
  opts?: CallerOpts,
): Promise<VisionResult> {
  const cfg = getConfig();
  if (cfg.AI_DISABLED) {
    return {
      scene: '(ai disabled)',
      subjects: [],
      mood: null,
      weather: null,
      activity: null,
      raw: {},
      tokensIn: 0,
      tokensOut: 0,
    };
  }
  const client = opts?.client ?? getAzureOpenAI();
  const deployment = deploymentForTier('default');
  const dataUrl = `data:${input.mimeType};base64,${input.imageBase64}`;
  const userParts: ChatCompletionContentPart[] = [
    { type: 'text', text: 'Describe this photo. JSON only.' },
    { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } },
  ];
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: VISION_SYSTEM_PROMPT },
    { role: 'user', content: userParts },
  ];
  const completion: ChatCompletion = await client.chat.completions.create({
    model: deployment,
    messages,
    max_tokens: 250,
    temperature: 0.2,
    response_format: { type: 'json_object' },
  });
  const text = completion.choices[0]?.message?.content ?? '{}';
  const obj = parseJsonObject(text);
  return {
    scene: strOrNull(obj.scene) ?? '',
    subjects: strArray(obj.subjects),
    mood: strOrNull(obj.mood),
    weather: strOrNull(obj.weather),
    activity: strOrNull(obj.activity),
    raw: obj,
    tokensIn: completion.usage?.prompt_tokens ?? 0,
    tokensOut: completion.usage?.completion_tokens ?? 0,
  };
}

/**
 * Generate the diary draft text from per-photo descriptions + place names + voice prompt.
 */
export async function generateDraft(
  input: DraftInput,
  opts?: CallerOpts,
): Promise<DraftResult> {
  const cfg = getConfig();
  if (cfg.AI_DISABLED) {
    return {
      text: '(ai disabled — draft placeholder)',
      modelUsed: deploymentForTier(input.tier),
      tokensIn: 0,
      tokensOut: 0,
    };
  }
  const client = opts?.client ?? getAzureOpenAI();
  const deployment = deploymentForTier(input.tier);
  const photosBlock = input.photoDescriptions
    .map((p, i) => {
      const subjectsLine = p.subjects.length ? `Subjects: ${p.subjects.join(', ')}.` : '';
      const extras = [
        p.mood ? `Mood: ${p.mood}.` : '',
        p.weather ? `Weather: ${p.weather}.` : '',
        p.activity ? `Activity: ${p.activity}.` : '',
      ]
        .filter(Boolean)
        .join(' ');
      return `Photo ${i + 1}: ${p.scene} ${subjectsLine} ${extras}`.trim();
    })
    .join('\n');
  const placesLine = input.placeNames.length
    ? `Places: ${input.placeNames.join('; ')}.`
    : 'Places: unknown.';
  const userMsg = [
    `Date: ${input.entryDate}.`,
    placesLine,
    '',
    'Photo descriptions:',
    photosBlock,
  ].join('\n');
  const sys = [DRAFT_SYSTEM_PROMPT_BASE, input.voicePrompt].filter(Boolean).join('\n\n');
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: sys },
    { role: 'user', content: userMsg },
  ];
  const completion: ChatCompletion = await client.chat.completions.create({
    model: deployment,
    messages,
    max_tokens: 600,
    temperature: 0.6,
  });
  const text = completion.choices[0]?.message?.content?.trim() ?? '';
  if (!text) {
    const log = getLogger();
    log.warn('ai_empty_draft');
  }
  return {
    text,
    modelUsed: deployment,
    tokensIn: completion.usage?.prompt_tokens ?? 0,
    tokensOut: completion.usage?.completion_tokens ?? 0,
  };
}
