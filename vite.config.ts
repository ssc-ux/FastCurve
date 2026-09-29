/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const buildId = new Date().toISOString().replace(/\D/g, '').slice(0, 14);

/** Versionne le cache du service worker à chaque build : une mise en ligne
 *  purge proprement l'ancien cache au lieu de l'accumuler. */
const versionnerServiceWorker = {
  name: 'fastcurve-sw-version',
  apply: 'build' as const,
  closeBundle() {
    const f = new URL('./dist/service-worker.js', import.meta.url);
    if (!existsSync(f)) return;
    writeFileSync(f, readFileSync(f, 'utf8').replace("'fastcurve-shell-dev'", `'fastcurve-shell-${buildId}'`));
  },
};

// Base relative : fonctionne à la racine comme sous /<repo>/ (GitHub Pages).
export default defineConfig({
  base: './',
  plugins: [svelte(), versionnerServiceWorker],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_ID__: JSON.stringify(buildId),
  },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 6000,
    reportCompressedSize: false,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
