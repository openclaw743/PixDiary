/**
 * Voice capture: pull a user's last N saved diary entries to use as few-shot
 * examples in the diary draft prompt.
 *
 * Architecture says "last 5 saved final entries" via `entry_revisions` ordered
 * by saved_at DESC. We pick the most recent revision per entry; a single user
 * may have many revisions of the same entry (after multiple saves).
 */
import type { Pool } from 'pg';
import { getPool } from '../db/pool';

export interface VoiceSample {
  /** Final markdown for that revision. */
  text: string;
  savedAt: Date;
}

interface ServiceDeps {
  pool?: Pool;
}

function poolOf(deps?: ServiceDeps): Pool {
  return deps?.pool ?? getPool();
}

/**
 * Pull the user's most recent saved entries (one revision per entry, freshest)
 * up to `limit`. Returns ordered newest-first.
 */
export async function getVoiceSamples(
  userId: string,
  limit = 5,
  deps?: ServiceDeps,
): Promise<VoiceSample[]> {
  const cap = Math.max(1, Math.min(20, Math.floor(limit)));
  const pool = poolOf(deps);
  const r = await pool.query<{ final_md: string; saved_at: Date }>(
    `WITH recent AS (
       SELECT er.final_md, er.saved_at,
              ROW_NUMBER() OVER (PARTITION BY er.entry_id ORDER BY er.saved_at DESC) AS rn
       FROM entry_revisions er
       JOIN entries e ON e.id = er.entry_id
       WHERE e.user_id = $1
         AND e.deleted_at IS NULL
     )
     SELECT final_md, saved_at FROM recent WHERE rn = 1
     ORDER BY saved_at DESC
     LIMIT $2`,
    [userId, cap],
  );
  return r.rows.map((row) => ({ text: row.final_md, savedAt: row.saved_at }));
}

/**
 * Format the samples as a few-shot block to inject into a system prompt.
 * Returns an empty string if there are no samples.
 */
export function formatVoicePrompt(samples: VoiceSample[]): string {
  if (samples.length === 0) return '';
  const blocks = samples.map((s, i) => `Sample ${i + 1}:\n${s.text.trim()}`);
  return [
    'Here are recent diary entries this user wrote in their own voice. Match this tone, vocabulary, and rhythm — concrete, first-person, past tense, no flowery language they would not use.',
    ...blocks,
  ].join('\n\n');
}
