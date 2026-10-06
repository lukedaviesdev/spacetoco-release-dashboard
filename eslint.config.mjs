import withNuxt from './.nuxt/eslint.config.mjs';
import pluginA11y from 'eslint-plugin-vuejs-accessibility';

// Mirrors the base rules of spacetoco-app's @spacetoco-app/eslint-config (packages/shared/eslint-config).
// When this app moves into the monorepo, replace this block with `...nuxtConfig` from that package.
// Left out: i18n (no translations here), turbo env vars, import-x domain boundaries.
const spacetocoRules = [
  {
    plugins: { 'vuejs-accessibility': pluginA11y },
    rules: pluginA11y.configs?.recommended?.rules ?? {},
  },
  {
    rules: {
      'max-len': ['error', {
        code: 128,
        comments: 256,
        ignoreUrls: true,
        ignoreTrailingComments: true,
        ignoreStrings: false,
        ignoreTemplateLiterals: true,
        ignoreRegExpLiterals: true,
        ignorePattern: '^\\s*(import|export)\\s.+from\\s.+',
      }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-underscore-dangle': ['error', { allow: ['_id'] }],
      semi: ['error', 'always'],
      'spaced-comment': ['error', 'always', { markers: ['*', '/'] }],
      'no-trailing-spaces': 'error',
      'indent': ['error', 2, { SwitchCase: 1 }],
      'object-curly-newline': ['error', {
        multiline: true,
        consistent: true,
      }],
      'object-property-newline': ['error', { allowAllPropertiesOnSameLine: false }],
      'vue/max-attributes-per-line': ['error', {
        singleline: 6,
        multiline: 1,
      }],
      'vue/prop-name-casing': ['error', 'camelCase'],
      'vue/attributes-order': ['warn', {
        order: [
          'DEFINITION',
          'LIST_RENDERING',
          'CONDITIONALS',
          'RENDER_MODIFIERS',
          'GLOBAL',
          ['UNIQUE', 'SLOT'],
          'TWO_WAY_BINDING',
          'OTHER_DIRECTIVES',
          'ATTR_DYNAMIC',
          'ATTR_STATIC',
          'ATTR_SHORTHAND_BOOL',
          'EVENTS',
          'CONTENT',
        ],
      }],
      'vue/block-order': ['error', { order: ['script', 'template', 'style'] }],
      'vue/component-api-style': ['error', ['script-setup']],
      'vue/component-name-in-template-casing': ['error', 'kebab-case'],
      'vue/define-props-declaration': ['error', 'type-based'],
      'vue/enforce-style-attribute': ['error', { allow: ['scoped'] }],
      'vue/max-lines-per-block': ['error', {
        script: 300,
        template: 300,
        style: 600,
        skipBlankLines: true,
      }],
      'vue/no-boolean-default': ['error', 'default-false'],
      'vue/no-ref-object-reactivity-loss': 'error',
      'vue/no-required-prop-with-default': 'error',
      'vue/no-useless-v-bind': 'error',
      '@typescript-eslint/unified-signatures': 'warn',
      '@typescript-eslint/no-dynamic-delete': 'warn',
    },
  },
];

export default withNuxt(
  ...spacetocoRules,
  // Not in the shared config, but it's how spacetoco-app code is written; stops autofix leaving bare multiline objects.
  { rules: { 'comma-dangle': ['error', 'always-multiline'] } },
  {
    files: ['pages/**/*.vue', 'layouts/**/*.vue'],
    rules: { 'vue/multi-word-component-names': 'off' },
  },
);
