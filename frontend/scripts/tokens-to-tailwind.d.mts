// Type stub for the JS token-to-tailwind helper, so TypeScript can consume it
// from tailwind.config.ts (which Tailwind compiles via jiti at runtime).

export interface ThemeExtension {
  colors: Record<string, string | Record<string, string>>;
  spacing: Record<string, string>;
  borderRadius: Record<string, string>;
  boxShadow: Record<string, string>;
  fontFamily: Record<string, string[]>;
  fontSize: Record<string, [string, { lineHeight: string }]>;
  fontWeight: Record<string, string>;
  transitionDuration: Record<string, string>;
  transitionTimingFunction: Record<string, string>;
  screens: Record<string, string>;
  zIndex: Record<string, string>;
}

export function loadTheme(): ThemeExtension;
export function loadTokens(): unknown;
export function buildTheme(tokens: unknown): ThemeExtension;
