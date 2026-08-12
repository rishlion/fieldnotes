import { createRun } from './game/state';
import { tryMove, playCard, validTargets, tileAt, finalScore, findPath, moveCostNow, chooseCairnCard } from './game/rules';
import { distance, neighbors, type Axial } from './core/hex';
import type { Clause } from './game/types';
import { AtlasRenderer } from './render/atlas';
import { Hud } from './ui/hud';
import { CARDS, CODEX } from './game/cards';
import { recordScore, markExpeditionEnded, currentExpeditionNo, loadCodex, fragmentsRead, bestScore } from './game/codexStore';
import { FRAGMENTS } from './game/story';
import { sound } from './audio/sound';
import type { GameEvent, RunState } from './game/types';

const cv = document.getElementById('cv') as HTMLCanvasElement;

let seed = (Date.now() ^ (Math.random() * 0x7fffffff)) | 0;
let run = createRun(seed);
let state: RunState = run.state;

const renderer = new AtlasRenderer(cv, state);
const hud = new Hud();

const HINTS: Record<string, string> = {
  ember: 'choose a neighbouring hex to strike the ember',
  gust: 'choose a direction for the wind to blow',
  frost: 'choose neighbouring water to freeze',
  vine: 'choose a neighbouring cliff to climb',
  stone: 'choose river or shallows to bridge',
};

const WEATHER_TOAST: Record<string, [string, string]> = {
  winds: ['the weather turns', 'The wind is rising. Fire will travel further than you mean it to.'],
  storm: ['storm', 'Rain drowns every fire and the river swells over its ford.'],
  clearing: ['clearing skies', 'The rain has passed. The fords stand again.'],
  winter: ['first frost', 'Winter locks the rivers open — every water a road, every day a hunger.'],
};

const clauseLabel = (c: Clause) =>
  c.kind === 'chart' ? `chart ${c.n} new hexes`
  : c.kind === 'cairns' ? `survey ${c.n} cairn${c.n > 1 ? 's' : ''}`
  : `the beacon by day ${c.n}`;

/* ---------------- the primer: a playable first-expedition tutorial ----------------
   Each step points at the exact thing to do (a pencil ring on a hex, a glowing card),
   advances only when the player actually does it, dissolves if ignored long enough,
   and can be waved away with the ✕ on the whisper line. */

const ONBOARD_KEY = 'fieldnotes.onboard.v2';
let onboardStep = 0;
try { onboardStep = parseInt(localStorage.getItem(ONBOARD_KEY) ?? '0', 10) || 0; } catch { /* ignore */ }
let movesMade = 0;
let cardsPlayed = 0;
let surveyPlayed = false;
let frostPlayed = false;
let stepMoves = 0; // movesMade when the current step began (session-local; resets kindly)

interface PrimerStep {
  hint: string;
  mark: 'hex' | 'survey' | 'frost' | null;
  done: () => boolean;
}

const PRIMER: PrimerStep[] = [
  { hint: 'walk — click the ringed hex beside your cartographer', mark: 'hex',
    done: () => movesMade >= 1 },
  { hint: 'every step is a day, and days eat supplies — the ledger is kept above', mark: null,
    done: () => movesMade - stepMoves >= 2 },
  { hint: 'the satchel now — play the Survey; it charts without a single step', mark: 'survey',
    done: () => surveyPlayed || movesMade - stepMoves >= 6 },
  { hint: 'a card spends no day and costs no ration — only walking does', mark: null,
    done: () => movesMade - stepMoves >= 1 || frostPlayed },
  { hint: 'the island has laws — stand at the water’s edge and strike the Frost at it', mark: 'frost',
    done: () => frostPlayed || movesMade - stepMoves >= 8 },
  { hint: 'what the island teaches is inked in the ✦ field codex, forever', mark: null,
    done: () => movesMade - stepMoves >= 2 },
  { hint: 'Nº 6 marked a cairn on your chart — their stones provision those who follow', mark: null,
    done: () => movesMade - stepMoves >= 3 },
];

function saveOnboard() {
  try { localStorage.setItem(ONBOARD_KEY, String(onboardStep)); } catch { /* ignore */ }
}

/** the ringed hex: the affordable neighbour that walks toward the story */
function primerHex(): Axial | null {
  const goal = state.ledgerCairn ?? state.world.peak;
  let best: Axial | null = null;
  let bestKey = Infinity;
  for (const n of neighbors(state.player)) {
    const cost = moveCostNow(state, tileAt(state, n));
    if (cost === null) continue;
    const k = distance(n, goal) * 10 + cost;
    if (k < bestKey) { bestKey = k; best = n; }
  }
  return best;
}

/** advance the primer from what the player has actually done, and point at the next thing */
function updateOnboarding(): string | null {
  while (onboardStep < PRIMER.length && PRIMER[onboardStep].done()) {
    onboardStep++;
    stepMoves = movesMade;
    saveOnboard();
  }
  const step = PRIMER[onboardStep] as PrimerStep | undefined;
  renderer.tutHex = step?.mark === 'hex' ? primerHex() : null;
  hud.highlightCard(step?.mark === 'survey' || step?.mark === 'frost' ? step.mark : null);
  return step?.hint ?? null;
}

function dismissPrimer() {
  onboardStep = PRIMER.length;
  saveOnboard();
  renderer.tutHex = null;
  hud.highlightCard(null);
  hud.hint(null);
  renderer.draw(performance.now());
}

function processEvents(evts: GameEvent[], opts: { fromCard?: boolean; silent?: boolean } = {}) {
  const now = performance.now();
  let chartDirty = false;
  let drawn = 0;
  let ignites = 0;
  let melts = 0;
  for (const e of evts) {
    switch (e.kind) {
      case 'draw':
        sound.drawCard(drawn);
        drawn++;
        break;
      case 'charted': {
        renderer.chartHex(e.hex, 90 + e.order * 55, now);
        sound.inkIn(90 + e.order * 55);
        chartDirty = true; // rebuild so the settle animation isn't drawn over a pre-stamped hex
        const t = tileAt(state, e.hex);
        if (!opts.silent && t?.ov === 'cairn' && !t.visited) {
          hud.marginNote(`day ${state.day} — a cairn stands there, unsurveyed. the guild pays for those`);
        }
        break;
      }
      case 'tilechanged':
        chartDirty = true;
        break;
      case 'moved': {
        const t = tileAt(state, e.to);
        sound.step(t?.t, t?.ov === 'ice');
        renderer.playerMoved(e.from, e.to);
        movesMade++;
        break;
      }
      case 'ignite':
        sound.ignite(ignites++);
        break;
      case 'burnout':
        sound.burnout();
        break;
      case 'melt':
        sound.melt();
        melts++;
        renderer.addFloater(e.hex, 'the ice gives way', { color: '#4a3826' });
        break;
      case 'meltwater':
        sound.melt();
        renderer.addFloater(e.hex, 'the fire drinks the snow', { color: '#4a3826' });
        break;
      case 'cairn': {
        renderer.addFloater(e.hex, 'surveyed ✓', { color: '#8c2f22' });
        sound.cairn();
        chartDirty = true; // the survey flag is planted into the chart layer
        if (!opts.silent && state.cairnsFound === 1) {
          const left = state.world.cairns.filter((c) => !tileAt(state, c)?.visited).length;
          if (left > 0) {
            hud.marginNote(`day ${state.day} — the cairn's ledger names ${left} more, pencilled where rumour puts them`);
          }
        }
        break;
      }
      case 'supplies':
        renderer.addFloater(e.at, `+${e.n} supplies`, {});
        break;
      case 'score':
        if (e.at && e.label && e.label.startsWith('chain')) break; // chain floater handles it
        if (e.at) renderer.addFloater(e.at, `+${e.n}${e.label ? ` ${e.label}` : ''}`, { color: '#8c2f22' });
        break;
      case 'chain':
        renderer.addFloater(e.at, `chain ×${e.n}!`, { color: '#8c2f22', big: true });
        sound.chain(e.n);
        break;
      case 'discover': {
        const entry = CODEX.find((c) => c.id === e.id);
        if (entry) hud.law(entry.title, entry.text);
        hud.codexGlow();
        sound.discovery();
        break;
      }
      case 'fragment':
        hud.fragment(e.idx);
        hud.codexGlow(); // the journal lives in the codex
        break;
      case 'cardchoice':
        hud.showCardChoice(e.a, e.b);
        break;
      case 'weather': {
        const t = WEATHER_TOAST[e.phase];
        if (t) hud.toast(`◈ ${t[0]}`, t[1]);
        sound.weatherChange(e.phase);
        break;
      }
      case 'clause': {
        const c = state.contract[e.idx];
        if (c) {
          if (e.met) {
            hud.toast('◈ commission', `${clauseLabel(c)} — sealed ✓`);
            sound.seal();
          } else {
            hud.toast('◈ commission', `${clauseLabel(c)} — the clause lapses`);
            sound.clauseFail();
          }
        }
        setTimeout(() => hud.flashClause(e.idx), 50);
        break;
      }
      case 'end': {
        if (e.won) {
          renderer.beaconLit = true;
          renderer.addFloater(state.world.peak, 'the beacon is lit', { color: '#8c2f22', big: true });
          sound.beacon();
        } else {
          sound.pageClose();
        }
        if (dailyMode) {
          // the daily is one attempt: record it, and spare the campaign ledger
          try {
            localStorage.setItem(DAILY_KEY, JSON.stringify({
              date: todayStr(), score: finalScore(state), won: e.won, day: state.day,
            }));
          } catch { /* private mode */ }
        } else {
          markExpeditionEnded();
        }
        const { best, isBest } = recordScore(finalScore(state));
        // let the pull-back camera and the beacon flare read before the report slides in
        setTimeout(() => hud.showEnd(state, best, isBest), e.won ? 2600 : 700);
        break;
      }
    }
  }
  // the world's own doings get a line in the margin
  if (!opts.silent) {
    if (melts > 0) hud.marginNote(`day ${state.day} — the ice gives way`);
    if (ignites > 0 && !opts.fromCard) hud.marginNote(`day ${state.day} — the fire spreads`);
  }
  if (chartDirty) renderer.refreshChart();
  hud.markDrawn(drawn);
  hud.clearSelection(state);
  renderer.targets = [];
  const whisper = updateOnboarding();
  hud.hint(whisper ?? (!state.over && state.hand.length === 0 && state.deck.length === 0
    ? 'the satchel is empty — walk wisely'
    : null), whisper !== null);
  hud.update(state);
  renderer.draw(performance.now());
}

/* ---------------- auto-walk: click a charted hex, walk the known route ---------------- */

let autoWalk: Axial[] = [];
let autoTimer: number | null = null;

function cancelAutoWalk() {
  autoWalk = [];
  if (autoTimer !== null) {
    clearTimeout(autoTimer);
    autoTimer = null;
  }
}

/** Events worth stopping the walk for — the player should be looking. */
const HALTS = new Set(['discover', 'fragment', 'cairn', 'weather', 'clause', 'chain', 'end']);

function stepAutoWalk() {
  autoTimer = null;
  const next = autoWalk.shift();
  if (!next) return;
  // the world moves between steps — re-check the ground before trusting yesterday's plan
  if (state.over || distance(state.player, next) !== 1 || moveCostNow(state, tileAt(state, next)) === null) {
    cancelAutoWalk();
    return;
  }
  const evts = tryMove(state, next);
  const halt = evts.some((e) => HALTS.has(e.kind));
  processEvents(evts);
  if (state.over || halt) {
    cancelAutoWalk();
    return;
  }
  if (autoWalk.length > 0) autoTimer = window.setTimeout(stepAutoWalk, 270);
}

/* ---------------- input ---------------- */

hud.onCardChoice = (pick) => {
  processEvents(chooseCairnCard(state, pick));
};

hud.onCardSelect = (idx) => {
  if (hud.introVisible || hud.choiceOpen) return;
  cancelAutoWalk();
  if (idx === null) {
    renderer.targets = [];
    hud.hint(null);
    renderer.draw(performance.now());
    return;
  }
  const card = state.hand[idx];
  const def = CARDS[card];
  if (!def.targeted) {
    sound.cardPlay(card);
    cardsPlayed++;
    if (card === 'survey') surveyPlayed = true;
    processEvents(playCard(state, idx, null), { fromCard: true });
    return;
  }
  sound.cardSelect();
  const targets = validTargets(state, card);
  renderer.targets = targets;
  hud.hint(targets.length > 0 ? HINTS[card] : `no place for the ${def.name.toLowerCase()} here`);
  renderer.draw(performance.now());
};

cv.addEventListener('pointermove', (e) => {
  renderer.hover = renderer.screenToHex(e.clientX, e.clientY);
  renderer.draw(performance.now());
});

cv.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  if (renderer.arrivalActive) {
    renderer.skipArrival(); // the crossing can be waved ashore
    return;
  }
  if (inFlow) {
    finishFlow(); // and so can the settling ink
    return;
  }
  if (hud.introVisible || hud.choiceOpen) return;
  if (hud.codexOpen) {
    hud.closeCodex();
    return;
  }
  cancelAutoWalk();
  const hex = renderer.screenToHex(e.clientX, e.clientY);
  if (hud.selected !== null) {
    const ok = renderer.targets.some((t) => t.q === hex.q && t.r === hex.r);
    if (ok) {
      const card = state.hand[hud.selected];
      sound.cardPlay(card);
      cardsPlayed++;
      if (card === 'frost') frostPlayed = true;
      processEvents(playCard(state, hud.selected, hex), { fromCard: true });
    } else {
      hud.clearSelection(state);
      renderer.targets = [];
      hud.hint(null);
      renderer.draw(performance.now());
    }
    return;
  }
  if (state.over) return;
  const d = distance(state.player, hex);
  if (d === 0) return;
  if (d === 1) {
    const evts = tryMove(state, hex);
    if (evts.length === 0) {
      const t = tileAt(state, hex);
      renderer.addFloater(hex, !t ? 'beyond the chart' : t.burning ? 'aflame' : t.flooded ? 'flooded' : 'no way through',
        { color: '#8c2f22' });
      renderer.draw(performance.now());
      return;
    }
    processEvents(evts);
    return;
  }
  // a distant click: walk the charted route there, a day at a time
  const tile = tileAt(state, hex);
  if (!tile) {
    renderer.addFloater(hex, 'beyond the chart', { color: '#8a7550' });
  } else if (!tile.charted) {
    renderer.addFloater(hex, 'uncharted', { color: '#8a7550' });
  } else {
    const route = findPath(state, hex);
    if (!route) {
      renderer.addFloater(hex, 'no way through', { color: '#8c2f22' });
    } else {
      autoWalk = route.path;
      stepAutoWalk();
      return;
    }
  }
  renderer.draw(performance.now());
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (hud.choiceOpen) {
      hud.pickChoice(null); // leaving the cache is always allowed
      return;
    }
    if (hud.codexOpen) {
      hud.closeCodex();
      return;
    }
    cancelAutoWalk();
    hud.clearSelection(state);
    renderer.targets = [];
    hud.hint(null);
    renderer.draw(performance.now());
  }
});
window.addEventListener('contextmenu', (e) => e.preventDefault());

/* ---------------- run lifecycle & the arrival flow ---------------- */

let pendingInitial: typeof run.initialEvents | null = run.initialEvents;
let inFlow = false;
let flowTimer: number | null = null;

/** title/new-run → ship-to-shore crossing → landing inks in → the guild letter */
function startExpedition() {
  inFlow = true;
  document.body.classList.add('arriving');
  renderer.startArrival(() => {
    renderer.chartVeiled = false; // ashore — the parchment may take ink now
    if (pendingInitial) {
      processEvents(pendingInitial, { silent: true });
      pendingInitial = null;
    }
    flowTimer = window.setTimeout(finishFlow, 1500); // let the ink settle before the letter
  });
  renderer.draw(performance.now());
}

function finishFlow() {
  if (flowTimer !== null) {
    clearTimeout(flowTimer);
    flowTimer = null;
  }
  if (!inFlow) return;
  inFlow = false;
  document.body.classList.remove('arriving');
  hud.showIntro(state);
}

function newRun(sameSeed: boolean) {
  if (!sameSeed) seed = (Date.now() ^ (Math.random() * 0x7fffffff)) | 0;
  cancelAutoWalk();
  dailyMode = false;
  hud.dailyLabel = null;
  run = createRun(seed);
  state = run.state;
  renderer.setState(state);
  hud.hideEnd();
  hud.clearSelection(state);
  hud.update(state);
  pendingInitial = run.initialEvents;
  startExpedition();
}

/* ---------------- the daily expedition: one island, once, for everyone ---------------- */

const DAILY_KEY = 'fieldnotes.daily.v1';
let dailyMode = false;

const todayStr = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local

function dailySeed(date: string): number {
  let h = 0x9e3779b9;
  for (const ch of date) h = Math.imul(h ^ ch.charCodeAt(0), 2654435761);
  return h | 0;
}

function dailyRecord(): { date: string; score: number; won: boolean; day: number } | null {
  try {
    const raw = localStorage.getItem(DAILY_KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw);
    return rec?.date === todayStr() ? rec : null;
  } catch {
    return null;
  }
}

function startDaily() {
  cancelAutoWalk();
  dailyMode = true;
  seed = dailySeed(todayStr());
  // a fixed mid-campaign commission (three clauses), the same for every cartographer
  run = createRun(seed, { expeditionNo: 3 });
  state = run.state;
  renderer.setState(state);
  hud.dailyLabel = `daily expedition · ${todayStr()}`;
  hud.hideEnd();
  hud.clearSelection(state);
  hud.update(state);
  pendingInitial = run.initialEvents;
  startExpedition();
}

document.getElementById('btn-new')!.addEventListener('click', () => newRun(false));
document.getElementById('btn-retry')!.addEventListener('click', () => newRun(true));

/* ---------------- audio ---------------- */

// browsers only allow audio after a user gesture — resume on any interaction
window.addEventListener('pointerdown', () => sound.ensure(), { capture: true });

const soundBtn = document.getElementById('sound-btn')!;
const soundLabel = (m: boolean) => { soundBtn.textContent = m ? '♪ sound off' : '♪ sound on'; };
soundLabel(sound.isMuted);
sound.onMuteChange = soundLabel;
soundBtn.addEventListener('click', () => {
  sound.ensure();
  sound.setMuted(!sound.isMuted);
});

/* ---------------- boot & loop ---------------- */

window.addEventListener('resize', () => {
  renderer.layout();
  renderer.draw(performance.now());
});

hud.onBegin = () => {
  sound.ensure(); // breaking the seal is the user gesture that wakes the audio
  const whisper = updateOnboarding();
  hud.hint(whisper ?? 'the guild asks two things: chart the island, and light the beacon on its summit', whisper !== null);
  if (state.ledgerCairn) {
    hud.marginNote('Nº 6’s ledger marks a cairn on this island — pencilled on your chart');
  }
  renderer.draw(performance.now()); // the primer's ring should be waiting when the letter lifts
};

hud.onHintDismiss = dismissPrimer;

/* ---------------- the title page ---------------- */

const titleScreen = document.getElementById('title-screen')!;
const titleLedger = document.getElementById('t-ledger')!;
{
  // a returning cartographer's bookmark; a new one gets clean parchment
  const exp = currentExpeditionNo();
  const codexN = loadCodex().size;
  const fragN = fragmentsRead();
  const best = bestScore();
  titleLedger.textContent = exp > 1 || codexN > 0 || fragN > 0
    ? `expedition nº ${exp} · codex ${codexN} of ${CODEX.length} · journal ${fragN} of ${FRAGMENTS.length}${best > 0 ? ` · best ${best}` : ''}`
    : '';
}
document.getElementById('t-begin')!.addEventListener('click', () => {
  sound.ensure(); // opening the journal is the gesture that wakes the audio
  titleScreen.classList.add('hidden');
  startExpedition();
});

{
  const dailyBtn = document.getElementById('t-daily')!;
  const rec = dailyRecord();
  if (rec) {
    dailyBtn.classList.add('played');
    dailyBtn.textContent = rec.won
      ? `today's expedition — the beacon lit on day ${rec.day} · ${rec.score}`
      : `today's expedition — the satchel ran dry · ${rec.score}`;
  } else {
    dailyBtn.textContent = `today's expedition · ${todayStr()} · one attempt`;
    dailyBtn.addEventListener('click', () => {
      sound.ensure();
      titleScreen.classList.add('hidden');
      startDaily();
    }, { once: true });
  }
}

hud.update(state);
renderer.draw(performance.now());

/* dev hook for driving playtests from the console */
(window as unknown as Record<string, unknown>).__fieldnotes = {
  get state() { return state; },
  center: (q: number, r: number) => renderer.center({ q, r }),
  renderer,
};

let rafOk = false;
function frame(now: number) {
  rafOk = true;
  renderer.draw(now);
  sound.tick(state);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
/* some embedded webviews suspend rAF — keep the journal alive regardless */
setTimeout(() => {
  if (!rafOk) setInterval(() => { renderer.draw(performance.now()); sound.tick(state); }, 40);
}, 400);
