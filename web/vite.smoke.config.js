import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// Single-file classic-script build used only by scripts/smoke.mjs (jsdom cannot
// execute ESM module scripts).
export default defineConfig({
  root: path.resolve(import.meta.dirname),
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"development"' },
  build: {
    outDir: 'dist-smoke',
    emptyOutDir: true,
    minify: false,
    cssCodeSplit: false,
    rollupOptions: {
      output: { format: 'iife', inlineDynamicImports: true, entryFileNames: 'app.js', assetFileNames: 'app.[ext]' }
    }
  }
})
