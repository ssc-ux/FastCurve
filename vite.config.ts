/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Base relative : fonctionne à la racine comme sous /<repo>/ (GitHub Pages).
export default defineConfig({
  base: './',
  plugins: [svelte()],
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
