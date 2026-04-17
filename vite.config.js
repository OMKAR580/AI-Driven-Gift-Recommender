import { defineConfig } from 'vite'

const repoName = 'AI-Driven-Gift-Recommender'

export default defineConfig(({ command }) => ({
  base: command === 'build' ? `/${repoName}/` : '/',
  cacheDir: command === 'serve' ? `.vite-dev-cache-${Date.now()}` : '.vite-build-cache',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
}))
