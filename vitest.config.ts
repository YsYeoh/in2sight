import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  // server-only throws outside Next's server bundle; the no-op file ships inside next
  resolve: { alias: { '@': path.resolve(__dirname, '.'), 'server-only': 'next/dist/compiled/server-only/empty' } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    testTimeout: 20_000, // Recharts renders in jsdom are slow on a busy machine; the 5 s default flaked
  },
});
