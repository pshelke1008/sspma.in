import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, '../../'), '');
  const apiUrl = env.VITE_API_URL ?? 'http://localhost:4300/api';

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        // Consume the shared package from source: its dist build is CommonJS
        // for the API, and Rollup cannot tree-shake named exports out of that.
        '@ashram/types': path.resolve(__dirname, '../../packages/types/src/index.ts'),
      },
    },
    define: {
      'import.meta.env.VITE_API_URL': JSON.stringify(apiUrl),
    },
    server: {
      port: 5173,
      strictPort: false,
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          // Keep the heavy chart and table libraries out of the entry chunk.
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            charts: ['recharts'],
            query: ['@tanstack/react-query', '@tanstack/react-table'],
          },
        },
      },
    },
  };
});
