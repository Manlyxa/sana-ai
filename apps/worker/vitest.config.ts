import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // BullMQ-обвязка требует живой Redis — проверяется вручную/в CI с сервисом.
      exclude: ['src/**/*.test.ts', 'src/main.ts', 'src/queues.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
});
