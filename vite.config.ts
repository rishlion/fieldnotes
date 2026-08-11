import { defineConfig } from 'vite';

export default defineConfig({
  // relative asset paths: the same dist/ works on itch.io, GitHub Pages, or any static host
  base: './',
  // honour a harness-assigned port (falls back to vite's default 5173)
  server: { port: Number(process.env.PORT) || 5173 },
});
