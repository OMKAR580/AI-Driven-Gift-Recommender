import { defineConfig } from 'vite'

export default defineConfig(({ command }) => ({
  cacheDir: command === 'serve' ? `.vite-dev-cache-${Date.now()}` : '.vite-build-cache',
  build: {
    outDir: 'release',
    emptyOutDir: true,
  },
}))
