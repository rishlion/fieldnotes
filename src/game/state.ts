import { mulberry32 } from '../core/rng';
import { disc, key, distance } from '../core/hex';
import type { CardId, Clause, GameEvent, RunState, WindChange, WeatherSched } from './types';
import { generateWorld } from './worldgen';
import { STARTING_DECK } from './cards';
import { currentExpeditionNo } from './codexStore';

function makeSched(rng: () => number): WeatherSched {
  const windsAt = 7 + Math.floor(rng() * 4);            // 7–10
  const stormAt = windsAt + 6 + Math.floor(rng() * 4);  // ~13–20, storm lasts 3 days
  const winterAt = stormAt + 3 + 5 + Math.floor(rng() * 4); // ~5–8 clear days after storm
  return { windsAt, stormAt, winterAt };
}

/** Pre-rolled wind: learnable, forecastable, and consistent on retry. */
function makeWindPlan(rng: () => number, sched: WeatherSched): WindChange[] {
  const plan: WindChange[] = [{ day: 1, dir: Math.floor(rng() * 6) }];
  let day = 1;
  let dir = plan[0].dir;
  while (day < 70) {
    let gap: number;
    if (day < sched.windsAt) gap = 7 + Math.floor(rng() * 3);
    else if (day < sched.stormAt) gap = 3 + Math.floor(rng() * 2);
    else if (day <= sched.stormAt + 2) gap = 1;
    else if (day < sched.winterAt) gap = 5 + Math.floor(rng() * 3);
    else gap = 12;
    day += gap;
    dir = day <= sched.stormAt + 2 && day >= sched.stormAt
      ? Math.floor(rng() * 6)                       // storm winds veer wildly
      : (dir + (rng() < 0.5 ? 1 : 5)) % 6;          // otherwise back or veer one step
    plan.push({ day, dir });
  }
  return plan;
}

function makeContract(
  rng: () => number, exp: number, landHexes: number, cairnCount: number, walkSteps: number
): Clause[] {
  const clauses: Clause[] = [];
  // the ask is in NEW hexes — the free landing sketch no longer pays the clause
  const chartN = Math.min(
    Math.round(landHexes * 0.62),
    Math.max(22, Math.round(landHexes * 0.18 + exp * 5 + rng() * 5))
  );
  clauses.push({ kind: 'chart', n: chartN, met: false, failed: false });
  // deadline binds: a little past the beeline, tightening with each expedition
  clauses.push({
    kind: 'beacon',
    n: Math.max(walkSteps + 5, 21 - exp, 15),
    met: false, failed: false,
  });
  if (exp >= 3) {
    clauses.push({ kind: 'cairns', n: Math.min(cairnCount, 2 + Math.floor(exp / 4)), met: false, failed: false });
  }
  return clauses;
}

export function createRun(
  seed: number,
  opts: { expeditionNo?: number } = {}
): { state: RunState; initialEvents: GameEvent[] } {
  const world = generateWorld(seed);
  const rng = mulberry32(seed ^ 0xdec0de);

  const deck = [...STARTING_DECK];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const hand = deck.splice(deck.length - 5, 5);

  const sched = makeSched(rng);
  const windPlan = makeWindPlan(rng, sched);
  const expeditionNo = opts.expeditionNo ?? currentExpeditionNo();

  // the first expedition teaches: the opening hand always holds Survey and Frost,
  // so the primer can point at an untargeted card, then a targeted one
  if (expeditionNo === 1) {
    for (const want of ['survey', 'frost'] as CardId[]) {
      if (hand.includes(want)) continue;
      const di = deck.indexOf(want);
      if (di < 0) continue;
      const hi = hand.findIndex((c) => c !== 'survey' && c !== 'frost');
      if (hi < 0) break;
      deck[di] = hand[hi];
      hand[hi] = want;
    }
  }

  let landHexes = 0;
  for (const t of world.tiles.values()) if (t.t !== 'ocean') landHexes++;

  const state: RunState = {
    world,
    player: world.start,
    // the satchel is priced off this island's own beeline: enough to walk it
    // card-free with a thin margin — wandering spends the margin, cairns buy it back
    supplies: Math.max(world.walkCost + 4, 14),
    day: 1,
    score: 0,
    charted: 0,
    cairnsFound: 0,
    discoveriesThisRun: 0,
    chainBonus: 0,
    windDir: windPlan[0].dir,
    windStrong: 0,
    windPlan,
    weather: 'calm',
    sched,
    contract: makeContract(rng, expeditionNo, landHexes, world.cairns.length, world.walkSteps),
    deck,
    hand,
    trail: [world.start],
    freeSteps: 0,
    over: false,
    won: false,
    expeditionNo,
    // Nº 6's ledger marks the cairn nearest the landing — the first breadcrumb
    ledgerCairn: world.cairns.length
      ? world.cairns.reduce((a, b) => (distance(b, world.start) < distance(a, world.start) ? b : a))
      : null,
  };

  // opening reveal around the landing — a free sketch from the ship's rail:
  // it inks the map but earns neither coin nor clause progress
  const initialEvents: GameEvent[] = [];
  let order = 0;
  for (const h of disc(world.start, 2)) {
    const t = world.tiles.get(key(h.q, h.r));
    if (t && !t.charted) {
      t.charted = true;
      initialEvents.push({ kind: 'charted', hex: h, order: order++ });
    }
  }

  return { state, initialEvents };
}
