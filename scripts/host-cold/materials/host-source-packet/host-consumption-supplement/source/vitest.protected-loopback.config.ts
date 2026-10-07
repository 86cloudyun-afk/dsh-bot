/** Bounded existing transport fixtures; never permits a provider endpoint. */
import { defineConfig } from 'vitest/config'
import config from './vitest.protected.config.ts'
export default defineConfig({ ...config, test: { ...config.test,
  setupFiles: ['./packages/experimental/native-run/tests/loopback-only.ts'],
  include: ['packages/llm/llm-deepseek/tests/prepared-call.spec.ts'],
} })
