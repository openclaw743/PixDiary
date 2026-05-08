import type { Config } from 'tailwindcss';
import { loadTheme } from './scripts/tokens-to-tailwind.mjs';

const theme = loadTheme();

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    // Replace defaults so all utilities derive from tokens.json.
    screens: theme.screens,
    fontFamily: theme.fontFamily,
    fontSize: theme.fontSize,
    fontWeight: theme.fontWeight,
    spacing: theme.spacing,
    borderRadius: theme.borderRadius,
    boxShadow: theme.boxShadow,
    colors: theme.colors,
    transitionDuration: theme.transitionDuration,
    transitionTimingFunction: theme.transitionTimingFunction,
    zIndex: theme.zIndex,
    extend: {},
  },
  plugins: [],
};

export default config;
