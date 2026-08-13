# CLAUDE.md — orientation for AI agents

FIELDNOTES is a browser expedition-roguelike: chart a seeded island, discover its
element-chemistry laws, light the beacon. Zero image/audio assets — everything is
generative code. Vite + TypeScript, vanilla Canvas 2D (map) + DOM/CSS (UI).

**Read first:** the "Status" block and "next moves, ranked" at the top of
`IMPROVEMENT_PLAN.md` — that is the current truth and the agreed priority order.
Systems and design intent live in `GAME_DESIGN.md`. Below the divider in
IMPROVEMENT_PLAN.md is history; don't re-fix things listed there.

Live at https://rishlion.github.io/fieldnotes/ — the one canonical host
(the Railway deployment was retired 2026-08-13; don't resurrect it).

## Commands

```bash
npm run dev            # vite dev server on :5173
npm run typecheck      # tsc --noEmit — run after every change; keep it clean
npm run build          # production build → dist/ (static, relative paths)
npm run deploy:pages   # build + force-push dist/ to the gh-pages branch
```

The gh CLI account (rishlion) has no workflow scope — Pages deploys from the
built `gh-pages` branch via the script above, never via Actions; pushing `main`
does NOT deploy. After deploying, verify the live site serves the new bundle
(curl for a marker string from the change).

## Architecture (4.6k lines total — read the file you're touching, it's short)

- `src/game/rules.ts` — all game logic. Mutates `RunState`, returns `GameEvent[]`.
  No DOM, no canvas. The deck is face-down: reordering unrevealed cards is legal.
- `src/main.ts` — the conductor. `processEvents()` switches on events → hud/renderer/
  sound. Click handling, auto-walk (Dijkstra over charted+passable only), daily
  expedition, dev hook.
- `src/ui/hud.ts` — all DOM UI: chips, letter, codex, end panel, card hand, the
  banner queue (see rules below), margin notes, primer whispers.
- `src/render/atlas.ts` — the whole canvas renderer (biggest file). Camera, hex
  sprites, settle animations, floaters (per-instance `ttl`), ghost trail, veil.
- `src/game/worldgen.ts` — seeded islands. Prices each seed with a Dijkstra beeline:
  supplies = `max(walkCost + 4, 14)`. **Invariant: every seed must stay zero-card
  winnable with a thin margin.** Touch supplies/terrain costs only with that in mind.
- `src/game/state.ts` — `createRun` + commission scaling; `story.ts` — the 12
  journal fragments; `cards.ts` — card defs + codex law text; `codexStore.ts` —
  cross-run persistence; `src/audio/sound.ts` — synthesized audio; `src/core/` —
  hex math, seeded rng.

localStorage keys: `fieldnotes.codex.v1` (laws), `fieldnotes.fragments.v1`,
`fieldnotes.onboard.v2` (primer step), `fieldnotes.daily.v1` (one attempt — written
on seal-break, NOT on peeking at the letter), `fieldnotes.flags.v1` (career moments).
Fresh-player test = `localStorage.clear()` on the dev origin.

## Hard-won rules — violate these and you re-introduce shipped bugs

1. **Hidden overlay panels must disarm their subtree.** `#overlay button
   {pointer-events:auto}` beats a hidden panel's `pointer-events:none`, so any new
   panel needs `#your-panel.hidden *{pointer-events:none}` or its invisible buttons
   swallow clicks (this bug shipped once — "break the seal" silently restarted runs).
2. **The banner queue owns the page's center.** Laws/fragments/moments go through
   `hud.pushBanner`; the queue holds while a modal is up (`pageHeld`) and any new
   modal must call `holdBanner()` on open and `pumpLaw()` after close. Journal
   fragments are sticky (ms 0, click-to-dismiss) — pages are read, not timed. Never
   show a modal over a playing banner; sequence them.
3. **Don't remove the renderer's viewport guards.** The Claude Code browser pane
   reports a 0×0 viewport at load and suspends rAF/timers when idle; the renderer
   clamps sizes, re-layouts lazily in `draw()`, and repaints synchronously after
   user actions. Also: pane screenshots lag ~1–2s, so short-lived canvas floaters
   can be invisible in screenshots while rendering fine for real users — verify
   timing-sensitive UI with the dev hook or longer ttls, not screenshots alone.
4. **Hand cap is 6.** The cairn cache draft and blind second draw both respect it —
   check the interaction when touching draw logic (`drawCards`, `chooseCairnCard`).
5. **Cairn draft resolution is positional** (`deck.length - 1 - pick`). The offer
   must be the top two deck slots; to change what's offered, swap cards into those
   slots (face-down, invisible) rather than changing the resolve.

## Dev hook

`window.__fieldnotes` exposes `{ state, center(q,r), renderer }`. For deterministic
tests: mutate `state.deck`/`state.player`, use `center(q,r)` for click coordinates
(divide by devicePixel factor when driving a scaled screenshot surface), read
`state.world.cairns` to find targets. This is how the stacked-deck draft test and
scripted playtests were done.

## Voice and working style

- All player-facing copy is in the guild's voice: lowercase whispers, spare prose,
  no gamey jargon ("the clerk notes…", "no way through", "turn the page"). Match it.
  Code comments in this repo carry the same voice — keep that register.
- Rishabh's preferences: polish over speed; when a change is a design choice (not a
  bug fix), present options and align before building; playtest in the browser and
  verify before calling anything done; commit only when asked.
- The discovery aesthetic is sacred: the game never explains chemistry. Teaching
  happens through card blurbs ("A river bars the way? Freeze a crossing."), the
  primer's whispers, and the codex after the fact — never through tooltips that
  spoil undiscovered laws.
