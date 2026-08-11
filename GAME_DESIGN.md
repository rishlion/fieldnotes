# FIELDNOTES — an expedition journal

A browser game about charting an island that doesn't exist until you ink it.

## The pitch

You are a guild cartographer. Each expedition, a seeded island waits under blank parchment.
Walk, and the journal draws itself — watercolor washes, wobbly ink coastlines, little tree
glyphs. Terrain blocks you: rivers, cliffs, dense forest. Your satchel of element cards
interacts *systemically* with the world, and the interactions are never explained — you
discover them, and each discovery is inked permanently into your Field Codex.

Reach the beacon on the summit before supplies run out. Score for hexes charted, cairns
surveyed, discoveries made, and chain reactions.

## Influences → what we took

- **Balatro** — the run loop, drafting-adjacent card scarcity, cascade joy (chain bonuses)
- **Breath of the Wild** — chemistry: fire spreads downwind, burns forest to ash; ice
  bridges; vines climb cliffs and also burn
- **Blue Prince** — knowledge as the real meta-progression (the codex persists; islands don't)
- **The Witness** — nothing is tutorialized; the world teaches through observation
- **Edith Finch** — (planned) vignettes at landmarks, each with a unique micro-mechanic
- **Journey** — restraint: wordless where possible, one warm accent color, calm pacing

## Art direction: "Inked Atlas"

The game IS the journal. Uncharted land is literally blank paper with faint pencil
frontier hexes. Charted hexes ink themselves in with a settle animation. Fire glows
through ink-scribble smoke. The far peak exists only as a dashed rumor sketch
("the beacon waits") until charted. All rendering is generative canvas code — no image
assets. Palette anchored on parchment (#e9dcbe), sepia ink (#4a3826), wax red (#8c2f22).

(Concept art with two alternate directions lives in `concept/index.html` — tabs A/B/C.)

## Systems (v1, implemented)

- **Island**: seeded worldgen (22×15 offset → axial hexes). Elevation + moisture noise,
  cliff ring with a carved pass, river descending from the highlands with one ford,
  4 cairns, beacon on the peak. Worldgen prices the island with Dijkstra: the cheapest
  card-free walk to the beacon (`walkCost`/`walkSteps`) both validates the seed and
  anchors the economy — cards make routes *shorter*, never merely possible.
- **Economy** (post difficulty pass): supplies = `max(walkCost + 4, 14)` — enough to
  beeline with a thin margin; wandering spends it, cairns (+6) buy it back. The landing
  reveal is a free sketch (no score, no clause progress). Contract: chart ~27–34 NEW
  hexes on expedition 1 (+5 per expedition), beacon by ~day 20 (tightening to 15).
- **Movement**: click adjacent hex — or any charted hex to auto-walk the cheapest known
  route (Dijkstra over charted passable tiles, one day per step; the walk halts on
  discoveries, cairns, weather turns and sealed clauses, and re-checks the ground every
  step so mid-walk fires/melts abort it). Hovering a distant hex previews the pencil
  route with its cost in supplies and days. Illegal clicks answer with an inked floater,
  never silence. Terrain costs supplies (grass/beach/ash 1, forest 2, snow/shallow 2).
  Each move = 1 day = 1 world tick. Reveal radius 1 (2 from high ground).
- **Dynamic camera**: starts zoomed close on the landing (hex size capped at 46px), then
  eases out/pans to always frame the charted region + player; pulls back to the whole
  island when the run ends. Glyph art scales from a BASE=22 design size; during the zoom
  glide the chart layer is scale-blitted, then re-stamped crisp once the camera settles.
  When the beacon rumor is off-frame it clamps to the page edge with an ink chevron.
- **Cards** (deck 12, hand 5, draw 1 per play, +2 at cairns): Ember, Gust, Frost, Vine,
  Stone, Survey, Stride.
- **Fire**: fuel-limited (forest 3, grass 2 ticks), spreads by wind relation
  (downwind 0.42 / gusting 0.92), leaves passable ash, never onto the player's hex.
  Fire beside snow melts it into a shallow ford (meltwater). Frost thrown onto a
  burning hex snuffs it — the wood spared, both cards' work undone (steam).
- **Ice**: 12 ticks then melts — never beneath your feet. Ember on ice spends the
  crossing. **Causeway**: permanent. **Vine**: makes cliffs climbable; flammable.
- **Regrowth**: a meadow beside standing forest returns to forest over time —
  burn → ash → (rain) → meadow → forest is a buildable, chain-scoring engine.
- **Weather arc** (Phase 1): seeded schedule per run — calm → winds rising (~day 8, wind
  shifts often, fire travels) → 3-day storm (~day 16: fires drowned, ford floods, ash
  blooms into meadow) → clearing → winter (~day 25: rivers freeze into permanent ice
  roads, every step costs +1 ration). Wind is pre-rolled and forecast in the HUD.
- **Guild contracts** (Phase 1): 2–3 clauses per expedition (chart N, beacon by day D,
  survey N cairns from expedition 3), escalating with expedition number. Met clauses are
  wax seals: final score = base × (1 + 0.25 × seals). Soft failure only.
- **Codex**: 16 discoveries, +40 each, persisted across runs — laws for every element,
  the weather, fords, cascades, and the cairns.
- **Cairn rumours**: surveying the first cairn on an island pencils the unfound ones in
  as dashed rumour sketches at their true hexes (edge-clamped with a chevron when
  off-frame, gone once charted) — cairns are refuel stations, so the pull is the point.
  The cairn nearest the landing is rumour-marked from day one (Nº 6's ledger).
- **Arrival flow**: title page (wordmark over washed parchment, returning-player
  bookmark line, audio unlocks on "open the journal") → ship-to-shore ink crossing
  (~3 s, skippable; the chart stays veiled until the ship beaches) → the landing inks
  in with sound → the guild letter. Replayed, sans title, on every new expedition.
- **The primer** (playable tutorial, first expedition only): seven gated whisper
  steps that point at the exact thing to do — a pencil ring on the hex to walk, a
  glowing card to play (Survey, then Frost at the water's edge, which fires a real
  law and teaches the discovery loop live). The opening hand guarantees both cards.
  Steps soft-skip if ignored; a ✕ on the whisper dismisses the primer entirely.
  It points, never cages.
- **The Lost Expedition Nº 6** (the narrative spine): the letter frames every run as a
  search for the expedition that never returned. Their 12-fragment journal
  (`src/game/story.ts`) surfaces one authored page per cairn surveyed, in order,
  persisted across runs; collected pages reread in the codex. Fragments teach the
  economy and the island's laws diegetically. Card blurbs lead with the situation they
  answer ("A river bars the way? Freeze a crossing of ice.").
- **Scoring**: hex +1 · cairn +25 · discovery +40 · chain 5×n (n≥3 transforms in one
  tick) · beacon +150 · leftover supplies ×2. Best score persisted.

## Audio (implemented)

Fully synthesized WebAudio in `src/audio/sound.ts` — zero audio assets. All voices are
noise bursts and oscillators routed through a generated impulse-response reverb into a
limiter. Event sounds: pen scratches on ink-in (staggered with the settle animations),
terrain-flavored footsteps, per-card accents (ember whoosh + crackle, gust swell, frost
shimmer, vine rustle, stone knock, survey scribble), codex bells, cairn clink, chain
crackle flurries, freeze/melt, a ceremonial beacon finale, and a soft page-close on
defeat. Ambience: looping wind bed (level/filter follow gusting), fire-crackle pops
scheduled ahead while anything burns, a very quiet detuned drone, sparse A-minor
pentatonic plucks, and a rare distant gull. Mute toggle (persisted) top-right; audio
starts on the first user gesture per browser policy.

- **The Daily Expedition**: one shared island a day (seed = local date), one attempt,
  fixed three-clause commission; result rests on the title page until tomorrow.
- **The cairn cache**: surveying a cairn opens Nº 6's cache — choose one of two cards
  (or leave it be) plus a blind second draw.
- **The expedition report**: a copyable, spoiler-free 4-line summary on the end panel —
  made for pasting where other cartographers will see it.

## Roadmap (not yet built)

1. **Vignettes** — cairns hold playable memories of the previous expedition (Edith Finch)
2. **Guild contracts** — escalating commissions across expeditions (Balatro's blinds)
3. **More chemistry** — rain, lightning, regrowth on ash; snow + fire = meltwater
4. **Daily expedition** — shared seed, one attempt, compare scores
5. **Balance pass** — supplies economy, card counts, chain tuning
6. **Juice** — charting stagger polish, card-play flourishes, end-tally count-up
7. **Audio tuning pass** — mix levels and voice character, adjusted by ear in playtests

## Dev

```bash
npm run dev        # vite dev server on :5173
npm run typecheck  # tsc --noEmit
npm run build      # production build
```

`window.__fieldnotes` exposes `{ state, center(q,r) }` in dev for console playtesting.
