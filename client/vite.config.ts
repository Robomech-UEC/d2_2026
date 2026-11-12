import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: { host: '0.0.0.0', proxy: { '/ws': { target: 'ws://localhost:8000', ws: true }, '/api': 'http://localhost:8000' } },
  build: { outDir: 'dist', emptyOutDir: true },
});
