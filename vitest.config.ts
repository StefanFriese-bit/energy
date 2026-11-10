import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts'] }, define: { __BUILD_DATE__: '"test"' } });
