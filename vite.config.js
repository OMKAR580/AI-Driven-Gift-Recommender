import { defineConfig, loadEnv } from 'vite';

const DEFAULT_API_PORT = 8787;

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const configuredPort = Number.parseInt(env.PORT || '', 10);
  const apiPort = Number.isFinite(configuredPort) && configuredPort > 0
    ? configuredPort
    : DEFAULT_API_PORT;

  return {
    base: '/',
    cacheDir: command === 'serve' ? `.vite-dev-cache-${Date.now()}` : '.vite-build-cache',
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    server: {
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
