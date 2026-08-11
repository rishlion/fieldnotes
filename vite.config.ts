import { defineConfig } from 'vite';

// honour a harness-assigned port (falls back to vite's default 5173)
export default defineConfig({
  server: { port: Number(process.env.PORT) || 5173 },
});
