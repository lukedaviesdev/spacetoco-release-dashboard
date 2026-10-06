import { defineVuetifyConfiguration } from 'vuetify-nuxt-module/custom-configuration';

// Design tokens, layers 1-2 (see docs/design.md "Decisions"). Hex values are the primitives; the colour names are the
// semantic layer. Vuetify emits each as `--v-theme-<name>` (an rgb triplet) and swaps them with the theme, so dark mode
// needs nothing else. Component tokens built on these live in assets/css/tokens.css.
// Every text-bearing colour clears WCAG AA (4.5:1) on its theme's background.
export default defineVuetifyConfiguration({
  theme: {
    defaultTheme: 'system',
    themes: {
      light: {
        dark: false,
        colors: {
          'background': '#F4F1EA', // enamel board
          'surface': '#FAF8F3',
          'on-background': '#16202A', // ink
          'on-surface': '#16202A',
          'primary': '#16202A',
          'muted': '#5B6670',
          'rule': '#D9D3C7',
          'signal-clear': '#17734C',
          'signal-caution': '#8C5A00',
          'signal-danger': '#C2362C',
          'signal-return': '#2C6FB7',
          'line-api': '#0B6A73',
        },
      },
      dark: {
        dark: true,
        colors: {
          'background': '#201D18', // warm charcoal mimic panel
          'surface': '#272320',
          'on-background': '#E4DFD3',
          'on-surface': '#E4DFD3',
          'primary': '#E4DFD3',
          'muted': '#A39E92',
          'rule': '#3A352D',
          'signal-clear': '#3FB27F',
          'signal-caution': '#C99A5E', // less chroma than danger, so red stays the loudest signal
          'signal-danger': '#EF6A5E',
          'signal-return': '#6AA5E8',
          'line-api': '#3BB3BC',
        },
      },
    },
  },
  defaults: {
    VDataTable: {
      density: 'compact',
      hover: true,
    },
    VChip: {
      size: 'x-small',
      variant: 'outlined',
      label: true,
    },
  },
});
