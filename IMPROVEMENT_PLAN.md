# FIELDNOTES — Improvement Plan

Written after playtesting v0.1 (core loop + Inked Atlas + dynamic camera + synth audio).
Each phase attacks a diagnosed weakness. Polish (phase 5) threads between phases.

## Fresh-gamer playtest findings — 2026-08-05, prioritized

Blind run of expedition 1: won first try on day 17/26, 11 supplies left, 4 cards played,
1 of 4 cairns, score 669. Confirms diagnosis #1 below (never had to sweat). New findings,
ranked; P0/P1 built same day, P2 remains open.

### P0 — bugs — ✅ BUILT
1. **Wind chip overlaps the commission** — `#hud` wraps (flex-wrap, max-width 54vw) onto
   the absolutely-positioned `#contract` when the day label grows ("Day 11 · winds
   rising"). Fixed by stacking hud + contract in one top-left flow column.
2. **Codex can look uncloseable** — close button below the scroll fold; Esc and
   outside-click did nothing. Fixed: sticky ✕, Esc closes, clicking the map closes.

### P1 — high-priority UX — ✅ BUILT
3. **Silent move rejection / no pathing** (top friction of the run). Clicks on illegal
   hexes did nothing at all; every trip home was hex-by-hex re-clicking. Now: click any
   charted hex to auto-walk the cheapest known route (Dijkstra over charted, passable
   tiles; one day per step; halts on discovery/cairn/weather/clause so events are never
   steamrolled). Hovering a distant hex previews the pencil route with total cost in
   supplies and days. Illegal clicks get an inked floater ("no way through" / "uncharted"
   / "beyond the chart") instead of silence.
4. **Discoveries are missable** (+40 fired three times in the run without being noticed;
   corner toast too quiet for the game's core reward). Now a centered "law of the island"
   banner — wax-red title, the codex line, ink-settle animation, queued if several land
   at once — replaces the corner toast for discoveries.
5. **World changes happen silently** (the storm ate the frozen river — the player's only
   road home — with no notice). Now: journal margin notes (bottom-left, stacking, fading)
   for ice giving way, fire spreading on its own, and a first-sighting note when a cairn
   is charted. Melting ice also gets an on-map floater.
6. **Unsurveyed cairns look already-claimed** — the red flag was part of the base glyph,
   so a fresh player reads them as decorative/done and walks past. Now dormant cairns are
   flagless stones; surveying plants the flag.
7. **Summit beat cut short** — tally slid over the beacon flare at 1.6 s. Now 2.6 s so
   the pull-back camera and the lit beacon read before the report.
8. **Card economy never taught** — whisper sequence now includes "a card spends no day
   and costs no ration — only walking does", and the card whisper no longer promises
   red-marked hexes for untargeted cards (Survey/Stride).
9. **Wind forecast cryptic** — "↘ D8" reads like dice. Now "turns ↘ day 8" plus a full
   tooltip on the chip.
10. **Guild letter repeats verbatim** — from expedition 2 the four-verb primer collapses
    to a one-line "standing orders" reminder; the commission stays.
11. **Card targets could hide under the hand** (found while verifying) — the camera fits
    only charted tiles, but Frost/Stone targets can be uncharted southern water, which
    rendered beneath the card fan and swallowed the click. fitCamera now includes active
    targets in its bounds.

### Difficulty pass — ✅ BUILT (2026-08-05, tuned by feel)
12. The budget is now priced off each island's own beeline: worldgen runs Dijkstra over
    card-free terrain (`walkCost`/`walkSteps` on World) and the satchel is
    `max(walkCost + 4, 14)` — every seed stays zero-card winnable by construction, but
    the margin is thin and wandering spends it. The landing reveal is a free sketch:
    it inks the map but earns no score and no clause progress (kills the old
    40%-pre-paid chart clause AND the score-starts-at-19 confusion, old items 12/15).
    Chart clause asks for NEW hexes: `max(22, land*0.18 + exp*5 + rng*5)` (~27–34 on
    expedition 1, +5/expedition, cap 62% of land). Beacon deadline
    `max(walkSteps + 5, 21 − exp, 15)` (~day 20 on expedition 1, tightening to 15).
    Feel-test (near-optimal play with full map knowledge): full seal on day 12/20 with
    7 of 17 supplies left, supplies dipping to 8 mid-run and forest steps genuinely
    hurting; cairn refuels (+6) became load-bearing route anchors. Blind play should
    land meaningfully tighter. If it still runs loose in real hands, the next notch is
    `walkCost + 3` and/or floor 13 — change one dial at a time.
### Cairn rumor breadcrumbs — ✅ BUILT (2026-08-05)
13. Surveying your first cairn on an island pencils the rest in as rumours: small
    dashed stone-stack sketches at their true hexes (the beacon rumour's visual
    language), clamped to the page edge with a chevron when off-frame, vanishing once
    the real hex is charted. Gated per run on the first survey; taught once, forever,
    by a new codex law — "On Cairns: Stones stacked by hands before yours. Find one,
    and the rest whisper their places." (codex is 10 entries now) — plus a margin note
    naming how many remain. Rumours are directional pull only: they sit on uncharted
    parchment, so the route to them is still yours to find. Verified in-browser on
    expedition 2: banner + note + two edge-clamped rumours fired on first survey.

### The Lost Expedition Nº 6 + card clarity — ✅ BUILT (2026-08-06, after Rishabh's
### blind playtest: "doesn't pull me in; cards unclear; no story, benefits, or risks")
16. **Story spine.** The guild letter is now a search, not a quota: Expedition Nº 6
    went into these waters a year ago and never came back. Their journal — 12 authored
    fragments in `src/game/story.ts`, sparse and wordless-adjacent — surfaces one page
    per cairn surveyed, in order, persisted across runs (`fieldnotes.fragments.v1`).
    Fragments double as diegetic teaching: bread = supplies, cairns = caches (why they
    refuel you), fire/wind/frost/winter laws, the storm as dread. Presentation: a
    journal-styled variant of the law banner (ink-dashed, longer hold), a journal
    section in the codex ("N of 12 pages recovered"), the cairn nearest the landing
    rumour-marked from day one ("Nº 6's ledger"), win-tally flavor acknowledges the
    story, and the beacon goal reads "the one Nº 6 never lit."
17. **When-first card blurbs.** Every card text now leads with the situation it
    answers ("A river bars the way? Freeze a crossing of ice."). Verified in play:
    a river blocked the cairn trek and Stone's blurb answered the exact moment.
    (Situational glow + first-moment whispers were offered and declined for now.)

### Intro screen & arrival flow — ✅ BUILT (2026-08-06)
18. Boot no longer drops the player into a modal over a live board. Flow: **title page**
    (FIELDNOTES inks in over washed parchment; only the beacon rumour and the ledger
    cairn's chevron bleed through; returning players get a bookmark line — expedition
    nº, codex, journal pages, best; "open the journal" doubles as the audio-unlock
    gesture) → **ship-to-shore crossing** (~2.8 s, click to skip: an inked ship with a
    red pennant draws a dashed wake from the page edge to the landing; the chart is
    veiled until it beaches, via `chartVeiled` on the renderer, since createRun marks
    tiles charted before the reveal animation plays) → **the landing inks in** with its
    pen-scratch audio (the staggered reveal that used to play unseen behind the letter)
    → **the guild letter**. "New expedition" / "chart this island again" replay
    crossing → letter; every beat is click-through. HUD, hand, and margin UI stay
    hidden until the letter (body.arriving).

### The primer — a playable tutorial — ✅ BUILT (2026-08-06)
19. The first-expedition whispers grew hands. Seven gated steps, each pointing at the
    exact thing to do and advancing only when the player does it: a pulsing pencil
    ring on the suggested hex (toward the ledger cairn) → the ledger line → the Survey
    card glows, play it → "a card spends no day" → the Frost card glows, walk to water
    and strike it — which fires the real ON ICE law banner, teaching the discovery
    loop with live ammunition → the codex line → the cairn line, then silence.
    Expedition 1's opening hand is guaranteed to hold Survey and Frost (state.ts).
    Every step soft-skips if ignored for a few moves, and the whisper line carries a
    ✕ that dismisses the whole primer ("enough — I have the way of it"). No cage:
    nothing is ever locked, the primer only points. Storage key bumped to
    fieldnotes.onboard.v2 so existing playtesters see it once. Verified end-to-end
    in-browser, including the fizzle path (Stone at the ocean's edge) and portrait
    layout.

### Phase 4 thin-slice: daily · cairn draft · report — ✅ BUILT (2026-08-11)
20. Researched what the genre's best do (Balatro/StS dailies build community around one
    shared seed; StS's pick-one-of-three IS the deckbuilding skill; Wordle's spoiler-free
    share grid made the daily a ritual), then built the three interlocking pieces:
    **The Daily Expedition** — title-screen button, seed hashed from the local date,
    fixed three-clause commission (expedition-3 difficulty, incl. survey 2 cairns), one
    attempt enforced (`fieldnotes.daily.v1`; retry hidden on the end panel; the title
    shows the settled result until tomorrow). Daily runs don't advance the campaign
    counter; codex/journal still accrue.
    **The cairn cache draft** — cairns now offer a choice of two cards (take one or
    "leave it be", Esc skips) plus a blind second draw, replacing auto-draw-2; found
    and fixed the hand-cap ordering bug where a 5-card hand suppressed the choice.
    **The expedition report** — "copy the report" on the end panel: a 4-line
    spoiler-free journal-voiced text block (⬡ hexes · ⚑ cairns · ✦ laws · seals ·
    score) for pasting anywhere; clipboard with execCommand fallback.

### Surfaced-issue sweep — ✅ BUILT (2026-08-12)
21. The open items from earlier reviews, closed: **hover terrain names** ("beach · −1",
    "forest · −2 · 3 days" — vocabulary taught in passing, overlays named too), the
    **walk tween** (the cartographer slides hex-to-hex over 220 ms with a small step
    arc instead of teleporting — auto-walk finally reads as walking), and the
    **end-tally count-up** (each ledger line counts up staggered, then the total, then
    the record suffix). The live-site partial-viewport framing was investigated and
    confirmed environmental: the embedded preview pane reports a 0×0 viewport (the
    documented quirk the renderer already guards against) — real browsers unaffected.

### P2 — open (next up, in order)
15. **Blind-playtest the new economy** — the difficulty pass was feel-tested with full
    map knowledge; watch a truly blind run (or Rishabh's own) for whether full seal is
    still reachable and whether defeat by empty satchel ever lands. Dials to nudge:
    supplies margin (+4 → +3), floor (14 → 13), chart base (0.18).

## Diagnosis

1. Runs are solvable by walking — worldgen guarantees a card-free route and supplies are
   generous, so chemistry is optional garnish. (Balatro never lets you ignore the machine.)
2. Nothing escalates within a run — day 14 feels like day 2.
3. Score is unmotivated — no target, no greed-vs-safety tension.
4. Discovery runs dry — 7 codex entries, mostly found in two runs.
5. The Edith Finch ingredient (narrative vignettes) is absent — cairns are just +25.
6. Runs repeat — same deck, objective, island grammar every time.

## Phase 1 — "The run has stakes" — ✅ BUILT (needs by-hand balance tuning)

- Guild contracts: 2–3 clauses per expedition (chart N hexes / survey N cairns / beacon
  by day D). Met clauses = wax seals + score multipliers. Soft failure (unsealed report).
  Escalating asks across expeditions = journal-flavored antes.
- Weather arc: visible track — calm → rising winds → storm (~day 18: rain kills fires,
  river swells, ford floods) → early winter (snowline descends, some water freezes free).
  Urgency via chemistry, not a hard timer.
- Supplies tuning: tighten economy so cards become routes, not conveniences.
- Wind forecast: margin note predicting tomorrow's wind (makes Gust/Ember plays plans).
- Success test: winning with <4 cards played should be rare; greed should sometimes kill.

## Phase 2 — "The island answers" (chemistry depth) — ✅ FIRST PASS BUILT (2026-08-11)

- Built: **Meltwater** (fire beside snow → shallow ford, 55%/tick, counts toward
  chains), **Regrowth** (meadow beside standing forest → forest, 6%/tick, +2, counts
  toward chains — closing burn → ash → meadow → forest), **Steam both ways** (Frost
  targets a burning hex → fire out, wood spared; Ember targets ice → crossing spent),
  and observational laws: **On Fords** (step a shallow), **On Flood** (storm floods
  fords), **On Cascades** (first chain bonus). Codex 10 → 16. Frost-over-fire and
  ember-on-ice verified in-browser through the targeting UI.
- Remaining for a second pass: more fizzles-with-flavor for null pairings, possible
  Stormglass-style unlockable cards (Phase 4), codex toward 18–20.
- Also this date: `git init` with clean history (baseline commit of v0.1), Vite
  `base: './'` for host-anywhere builds, README with itch.io / Pages / Netlify deploy
  paths. Next deploy step needs Rishabh: create the remote/host account and push.

## Phase 3 — "The lost expedition" (the soul; Finch + Journey)

- Cairns hold out-of-order journal fragments of Expedition Nº 6 (the one that never
  returned), each a few sparse sentences, sometimes with a scripted moment (ghost-ink
  trail for three days; "stand where they stood"). Beacon finale acknowledges the story.
- Arrival/finale staging: ship-to-shore ink sketch opening; closing line under pull-back.
- Island memory: retrying a seed keeps the old chart as faint pencil.

## Phase 4 — "The long game" (replayability/meta)

- Island archetypes (highland wall, river-delta maze, archipelago), named on contracts.
- Satchel drafting: 1-of-3 starting kits; cairns offer a card choice; codex milestones
  unlock new cards (learn "On Storms" → Stormglass enters drafts).
- Daily expedition (shared seed, one attempt) + shareable expedition report: generated
  PNG of the inked map with stats and seals — no server needed.

## Onboarding — ✅ BUILT (added after user feedback: "not sure what I'm supposed to do")

- The guild letter: an intro panel on every expedition — the fantasy, the four verbs
  (walk / chart / light the beacon / learn), this run's commission, "break the seal —
  begin" (which is also the audio-unlock gesture). Input is gated while it's open.
- First-expedition whispers: a one-time hint sequence in the margin line (walk → days eat
  supplies → try a card → the codex keeps what you learn), each advancing only when the
  player actually does the thing; progress persisted in localStorage.
- Principle held: the letter explains the GOAL, never the chemistry — discovery stays
  intact.

## Phase 5 — Polish backlog (ongoing, threaded between phases)

End-tally count-up · walk tween · trail fading · one-step undo (only when no fire spread
that tick) · audio mix tuning by ear · keyboard movement · reduced-motion · touch layout.

## Principles to protect

- Runs stay 15–30 minutes.
- Contracts are invitations, never checklist anxiety; failure never punishes the next run.
- Wordless restraint everywhere except the vignettes (the deliberate exception).
- Zero external assets — all art and sound stay generative.
