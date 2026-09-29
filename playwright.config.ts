import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// Chromium préinstallé (environnements sans téléchargement) sinon celui de Playwright.
const chromiumLocal = '/opt/pw-browsers/chromium';
const launchOptions = existsSync(chromiumLocal) ? { executablePath: chromiumLocal } : {};

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173', launchOptions, serviceWorkers: 'allow' },
  webServer: [
    {
      command: 'npm run build && npx vite preview --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    // Serveur de développement : sert le banc d'épreuve OCR (bench/banc.html).
    {
      command: 'npx vite --port 5212 --strictPort',
      url: 'http://localhost:5212/bench/banc.html',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
  projects: [
    { name: 'bureau', use: { ...devices['Desktop Chrome'], launchOptions }, grepInvert: /@mobile/ },
    { name: 'mobile', use: { ...devices['Pixel 7'], launchOptions }, grep: /@mobile/ },
  ],
});
