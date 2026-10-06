import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    // The FastAPI wrapper around yt_dl_agent (see src/lib/api.ts) is expected here.
    proxy: { '/api': 'http://127.0.0.1:8765' },
  },
})
