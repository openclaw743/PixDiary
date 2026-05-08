#!/usr/bin/env node
// Optional helper: emits a sanity-check JSON of the derived Tailwind theme and
// a CSS variables file. Not part of the build pipeline by default — useful for
// debugging "did the tokens get picked up?" questions.

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadTokens, loadTheme } from './tokens-to-tailwind.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../src/styles/.generated');
mkdirSync(outDir, { recursive: true });

const tokens = loadTokens();
const theme = loadTheme();

writeFileSync(path.join(outDir, 'theme.json'), JSON.stringify(theme, null, 2));

// Flatten color tokens to CSS variables (e.g. --color-ink-900).
const lines = [':root {'];
for (const [group, value] of Object.entries(tokens.color)) {
  if (typeof value === 'string') {
    lines.push(`  --color-${group}: ${value};`);
  } else {
    for (const [k, v] of Object.entries(value)) {
      lines.push(`  --color-${group}-${k}: ${v};`);
    }
  }
}
for (const [k, v] of Object.entries(tokens.space)) lines.push(`  --space-${k}: ${v};`);
for (const [k, v] of Object.entries(tokens.radius)) lines.push(`  --radius-${k}: ${v};`);
for (const [k, v] of Object.entries(tokens.shadow)) lines.push(`  --shadow-${k}: ${v};`);
lines.push('}');
writeFileSync(path.join(outDir, 'tokens.css'), lines.join('\n') + '\n');

console.log(`wrote ${outDir}/theme.json and tokens.css`);
