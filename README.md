# FIELDNOTES — an expedition journal

A browser roguelike about charting an island that doesn't exist until you ink it.
All art and sound are generative code — zero assets. Design in `GAME_DESIGN.md`,
working log in `IMPROVEMENT_PLAN.md`.

**Play it:**
- https://rishlion.github.io/fieldnotes/ (GitHub Pages — redeploy with `npm run deploy:pages`)
- https://fieldnotes-production-dce3.up.railway.app (Railway — redeploy with `railway up --detach`)

## Dev

```bash
npm install
npm run dev        # vite dev server on :5173
npm run typecheck  # tsc --noEmit
npm run build      # production build → dist/
```

## Deploy

The build is a fully static, self-contained `dist/` (~26 KB gzipped JS) with
relative asset paths, so any static host works:

- **itch.io** — zip the *contents* of `dist/` and upload as an HTML game
  (viewport 1280×720 or fullscreen).
- **GitHub Pages** — push the repo, enable Pages, publish `dist/` (via a
  `gh-pages` branch or an actions workflow running `npm run build`).
- **Netlify / Vercel** — connect the repo; build command `npm run build`,
  output directory `dist`.

The daily expedition seeds from the player's local date, and all progression
(codex, journal, bests) lives in `localStorage` — no server needed.
