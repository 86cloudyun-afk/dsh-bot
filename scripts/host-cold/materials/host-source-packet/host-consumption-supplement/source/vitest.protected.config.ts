import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { standardDecoratorPlugin, vitestExecArgv } from './vitest.shared.ts'

export default defineConfig({
  plugins: [standardDecoratorPlugin(), tsconfigPaths({ projects: ['./tsconfig.base.json'] })],
  test: {
    pool: 'forks', fileParallelism: false, maxWorkers: 1,
    execArgv: vitestExecArgv,
    setupFiles: ['./packages/experimental/native-run/tests/no-io.ts'],
    testTimeout: 8000, hookTimeout: 8000,
    include: ['packages/**/tests/**/*.spec.ts'],
  },
})
