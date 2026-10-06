// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  // Static SPA: the page fetches /snapshot.json at runtime, so a fresh snapshot needs no rebuild of the app shell.
  ssr: false,
  modules: [
    'vuetify-nuxt-module',
    '@pinia/nuxt',
    '@vueuse/nuxt',
    '@nuxt/eslint',
    '@nuxt/test-utils/module',
  ],
  vuetify: {
    // Nuxt has its own useLayout; Vuetify's becomes useVLayout.
    moduleOptions: { prefixComposables: ['useLayout'] },
  },
  typescript: {
    // Node-side code outside Nuxt's default type contexts.
    nodeTsConfig: { include: ['../scripts/**/*', '../test/unit/**/*'] },
  },
  app: {
    head: { title: 'Release dashboard' },
  },
})
