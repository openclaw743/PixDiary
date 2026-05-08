import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 7),
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  RATE_LIMIT_AUTH_PER_MIN: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_GENERAL_PER_MIN: z.coerce.number().int().positive().default(600),
  RATE_LIMIT_UPLOADS_PER_10MIN: z.coerce.number().int().positive().default(50),
  RATE_LIMIT_DRAFTS_PER_HOUR: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_REGEN_PER_DAY: z.coerce.number().int().positive().default(5),

  // Azure Blob storage. In dev/CI we use Azurite via connection string.
  // In prod, use ACCOUNT_NAME + managed identity (DefaultAzureCredential).
  AZURE_STORAGE_CONNECTION_STRING: z.string().optional(),
  AZURE_STORAGE_ACCOUNT_NAME: z.string().optional(),
  AZURE_STORAGE_CONTAINER: z.string().min(1).default('photos'),
  AZURE_STORAGE_SAS_UPLOAD_TTL_SECONDS: z.coerce.number().int().positive().max(900).default(600),
  AZURE_STORAGE_SAS_READ_TTL_SECONDS: z.coerce.number().int().positive().max(900).default(900),

  // Azure AI Foundry (OpenAI compatible) — managed identity preferred.
  AZURE_OPENAI_ENDPOINT: z.string().optional(),
  AZURE_OPENAI_API_KEY: z.string().optional(),
  AZURE_OPENAI_API_VERSION: z.string().default('2024-10-21'),
  AZURE_OPENAI_DEPLOYMENT_DEFAULT: z.string().default('gpt-4o-mini'),
  AZURE_OPENAI_DEPLOYMENT_BETTER: z.string().default('gpt-4o'),

  // Azure Maps — API key via Key Vault in prod.
  AZURE_MAPS_KEY: z.string().optional(),

  // Master switch — disables outbound AI/Maps calls (used in unit tests).
  AI_DISABLED: z.coerce.boolean().default(false),
});

export type Config = z.infer<typeof ConfigSchema> & {
  corsOrigins: string[];
};

let cached: Config | undefined;

/** Load + validate the runtime config from process.env. Throws on missing/invalid. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const corsOrigins = parsed.data.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return { ...parsed.data, corsOrigins };
}

export function getConfig(): Config {
  if (!cached) cached = loadConfig();
  return cached;
}

/** Test helper: drop the cache so the next getConfig() re-reads process.env. */
export function resetConfigCache(): void {
  cached = undefined;
}
