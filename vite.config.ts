import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/energy/',
  build: { target: ['es2020', 'safari14'] },
  // amazon-cognito-identity-js (Hive sign-in) expects Node's `global`.
  define: { __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)), global: 'globalThis' },
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Home Energy',
        short_name: 'Energy',
        description: 'Heating schedule (Hive) and electricity + gas use, prices and cost (Octopus) for the house.',
        theme_color: '#3b6da8',
        background_color: '#f7f8fa',
        display: 'standalone',
        start_url: '/energy/',
        scope: '/energy/',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // Only the app itself is kept for offline; Octopus and Hive figures are always asked fresh (and cached by the app).
      workbox: { globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}'], navigateFallbackDenylist: [/^\/api/] },
    }),
  ],
});
