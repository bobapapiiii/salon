import { defineConfig } from 'vitest/config'

// Node environment is enough today -- the only tests in the project so far
// are pure discount-engine.ts unit tests with no DOM dependency. Add
// environment: 'jsdom' (and the jsdom devDependency) if/when component
// tests are introduced.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
