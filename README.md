# FIELDNOTES — an expedition journal

A browser roguelike about charting an island that doesn't exist until you ink it.
All art and sound are generative code — zero assets. Design in `GAME_DESIGN.md`,
working log in `IMPROVEMENT_PLAN.md`, agent orientation in `CLAUDE.md`.

**Play it:** https://rishlion.github.io/fieldnotes/ — the canonical link
(GitHub Pages; redeploy with `npm run deploy:pages`). The old Railway
deployment was retired 2026-08-13.

**Where it stands (2026-08-12):** the full loop is live — seeded islands, element-card
chemistry with a 16-law discovery codex, the Lost Expedition Nº 6 story told through
cairn journals and scripted moments, a guided first-expedition primer, a shared-seed
daily with one attempt and a copyable spoiler-free report. The first-cairn story beat
now sequences cleanly (cache draft → law → journal page, read at your own pace), and
a fresh-player pass closed the pre-field-test polish list. Current focus: field-testing
with real players, then a mobile/touch pass and balance follow-through. The ranked plan
lives at the top of `IMPROVEMENT_PLAN.md`; systems detail in `GAME_DESIGN.md`.

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
