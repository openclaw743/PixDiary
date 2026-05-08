// Generates a Tailwind theme extension object from the design-system tokens.
// Source of truth: ../docs/design-system/tokens.json (relative to repo root).
// Used by tailwind.config.ts (synchronous import).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

function splitFontStack(stack) {
  return stack.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
}

export function buildTheme(tokens) {
  // Colors: keep nested groups (ink, accent, surface, border) and flatten leaves.
  const colors = {};
  for (const [group, value] of Object.entries(tokens.color)) {
    if (typeof value === 'string') {
      colors[group] = value;
    } else if (value && typeof value === 'object') {
      colors[group] = { ...value };
    }
  }

  const fontSize = {};
  for (const [k, v] of Object.entries(tokens.typography.scale)) {
    fontSize[k] = [v.fontSize, { lineHeight: v.lineHeight }];
  }

  const fontWeight = {};
  for (const [k, v] of Object.entries(tokens.typography.weights)) {
    fontWeight[k] = String(v);
  }

  const zIndex = {};
  for (const [k, v] of Object.entries(tokens.z)) {
    zIndex[k] = String(v);
  }

  return {
    colors,
    spacing: { ...tokens.space },
    borderRadius: { ...tokens.radius },
    boxShadow: { ...tokens.shadow },
    fontFamily: {
      heading: splitFontStack(tokens.typography.fontFamilyHeading),
      body: splitFontStack(tokens.typography.fontFamilyBody),
      sans: splitFontStack(tokens.typography.fontFamilyBody),
      serif: splitFontStack(tokens.typography.fontFamilyHeading),
      mono: splitFontStack(tokens.typography.fontFamilyMono),
    },
    fontSize,
    fontWeight,
    transitionDuration: { ...tokens.motion.duration },
    transitionTimingFunction: { ...tokens.motion.easing },
    screens: { ...tokens.breakpoints },
    zIndex,
  };
}

export function loadTokens() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const tokenPath = path.resolve(here, '../../docs/design-system/tokens.json');
  const raw = readFileSync(tokenPath, 'utf8');
  return JSON.parse(raw);
}

export function loadTheme() {
  return buildTheme(loadTokens());
}
