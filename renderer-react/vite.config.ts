import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) {
            return;
          }

          if (id.includes('monaco-editor') || id.includes('@monaco-editor')) {
            return 'editor';
          }

          if (id.includes('xterm')) {
            return 'terminal';
          }

          if (id.includes('appwrite')) {
            return 'appwrite';
          }

          if (id.includes('react') || id.includes('scheduler')) {
            return 'react-vendor';
          }
        },
      },
    },
  },
})
