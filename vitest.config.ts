import { defineConfig } from 'vitest/config';

// This repository's tests only: CI's contract job checks Armature out inside the workspace (armature/), whose own suites are not ours to run.
export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
});
