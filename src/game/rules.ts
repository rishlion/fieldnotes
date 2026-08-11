import { DIRS, key, neighbors, disc, distance, type Axial } from '../core/hex';
import { mulberry32 } from '../core/rng';
import type { RunState, Tile, GameEvent, CardId, Terrain, WeatherPhase, WeatherSched } from './types';
import { unlockCodex, readNextFragment } from './codexStore';
import { FRAGMENTS } from './story';

export const MOVE_COST: Partial<Record<Terrain, number>> = {
  beach: 1, grass: 1, ash: 1, meadow: 1, forest: 2, shallow: 2, highland: 1, snow: 2, peak: 1,
};

const FUEL: Partial<Record<Terrain, number>> = { forest: 3, grass: 2, meadow: 2 };

export function tileAt(s: RunState, h: Axial): Tile | undefined {
  return s.world.tiles.get(key(h.q, h.r));
}

export function phaseFor(day: number, sched: WeatherSched): WeatherPhase {
  if (day < sched.windsAt) return 'calm';
  if (day < sched.stormAt) return 'winds';
  if (day <= sched.stormAt + 2) return 'storm';
  if (day < sched.winterAt) return 'clearing';
  return 'winter';
}

/** Base cost in supplies to step onto this tile, or null if impassable. */
export function moveCost(tile: Tile | undefined): number | null {
  if (!tile) return null;
  if (tile.burning) return null;
  if (tile.flooded) return null;
  if (tile.ov === 'ice') return 1;
  if (tile.ov === 'causeway') return 1;
  if (tile.ov === 'vine' && tile.t === 'cliff') return 2;
  return MOVE_COST[tile.t] ?? null;
}

/** True cost right now — winter adds one ration to every step. */
export function moveCostNow(s: RunState, tile: Tile | undefined): number | null {
  const base = moveCost(tile);
  if (base === null) return null;
  return s.weather === 'winter' ? base + 1 : base;
}

export function standingHigh(s: RunState): boolean {
  const t = tileAt(s, s.player);
  if (!t) return false;
  return t.t === 'highland' || t.t === 'snow' || t.t === 'peak' || (t.t === 'cliff' && t.ov === 'vine');
}

function discover(s: RunState, id: string, ev: GameEvent[]) {
  if (unlockCodex(id)) {
    s.discoveriesThisRun++;
    s.score += 40;
    ev.push({ kind: 'discover', id });
    ev.push({ kind: 'score', n: 40, at: s.player, label: 'discovery' });
  }
}

function chartAround(s: RunState, center: Axial, radius: number, ev: GameEvent[]): number {
  let n = 0;
  for (const h of disc(center, radius)) {
    const t = tileAt(s, h);
    if (t && !t.charted) {
      t.charted = true;
      s.charted++;
      s.score++;
      ev.push({ kind: 'charted', hex: h, order: n++ });
    }
  }
  return n;
}

function dirIndex(from: Axial, to: Axial): number {
  const dq = to.q - from.q, dr = to.r - from.r;
  return DIRS.findIndex((d) => d.q === dq && d.r === dr);
}

function flammable(tile: Tile | undefined): boolean {
  if (!tile || tile.burning) return false;
  if (tile.ov === 'vine') return true;
  return tile.t === 'forest' || tile.t === 'grass' || tile.t === 'meadow';
}

function ignite(s: RunState, h: Axial, ev: GameEvent[]) {
  const t = tileAt(s, h)!;
  t.burning = t.ov === 'vine' ? 2 : (FUEL[t.t] ?? 2);
  ev.push({ kind: 'ignite', hex: h });
  if (t.ov === 'vine') discover(s, 'VINE_BURNS', ev);
}

/** One spread attempt from every burning hex. Returns number of new fires. */
function spreadFire(s: RunState, ev: GameEvent[], boost = false): number {
  if (s.weather === 'storm') return 0; // the rain forbids it
  const burning: Axial[] = [];
  for (const [k, t] of s.world.tiles) {
    if (t.burning) {
      const [q, r] = k.split(',').map(Number);
      burning.push({ q, r });
    }
  }
  let lit = 0;
  for (const b of burning) {
    for (const n of neighbors(b)) {
      const t = tileAt(s, n);
      if (!flammable(t)) continue;
      if (n.q === s.player.q && n.r === s.player.r) continue; // you stamp it out
      const d = dirIndex(b, n);
      const rel = Math.min(Math.abs(d - s.windDir), 6 - Math.abs(d - s.windDir));
      const strong = s.windStrong > 0 || boost;
      const p = rel === 0 ? (strong ? 0.92 : 0.42) : rel === 1 ? (strong ? 0.35 : 0.18) : 0.05;
      const roll = mulberry32(
        (s.world.seed ^ (s.day * 2654435761) ^ (n.q * 374761393 + n.r * 668265263) ^ (b.q * 97)) | 0
      )();
      if (roll < p) {
        ignite(s, n, ev);
        lit++;
        if (rel === 0 && strong) discover(s, 'WIND_FANS', ev);
      }
    }
  }
  return lit;
}

/** Weather phase transition side effects. */
function applyWeather(s: RunState, phase: WeatherPhase, ev: GameEvent[]) {
  s.weather = phase;
  ev.push({ kind: 'weather', phase });
  const playerKey = key(s.player.q, s.player.r);

  if (phase === 'storm') {
    let flooded = 0;
    for (const [k, t] of s.world.tiles) {
      const [q, r] = k.split(',').map(Number);
      // rain smothers every fire — no ash, the wood is spared
      if (t.burning) {
        delete t.burning;
        ev.push({ kind: 'tilechanged', hex: { q, r } });
      }
      // the river swells over the ford
      if (t.t === 'shallow') {
        t.flooded = true;
        flooded++;
        ev.push({ kind: 'tilechanged', hex: { q, r } });
      }
      // rain eats frost-ice (never beneath your feet)
      if (t.ov === 'ice' && t.iceLeft !== undefined && k !== playerKey) {
        t.ov = null;
        delete t.iceLeft;
        ev.push({ kind: 'melt', hex: { q, r } });
        ev.push({ kind: 'tilechanged', hex: { q, r } });
      }
    }
    if (flooded > 0) discover(s, 'ON_FLOOD', ev);
  }

  if (phase === 'clearing') {
    for (const [k, t] of s.world.tiles) {
      if (t.flooded) {
        delete t.flooded;
        const [q, r] = k.split(',').map(Number);
        ev.push({ kind: 'tilechanged', hex: { q, r } });
      }
    }
  }

  if (phase === 'winter') {
    for (const [k, t] of s.world.tiles) {
      if (t.t === 'river' || t.t === 'shallow') {
        delete t.flooded;
        t.ov = 'ice';
        delete t.iceLeft; // permanent — winter ice does not melt
        const [q, r] = k.split(',').map(Number);
        ev.push({ kind: 'freeze', hex: { q, r } });
        ev.push({ kind: 'tilechanged', hex: { q, r } });
      }
    }
    discover(s, 'ON_WINTER', ev);
  }
}

/** Rain turns yesterday's ash into meadow, a few hexes at a time. */
function stormBlooms(s: RunState, ev: GameEvent[]) {
  for (const [k, t] of s.world.tiles) {
    if (t.t !== 'ash') continue;
    const [q, r] = k.split(',').map(Number);
    const roll = mulberry32((s.world.seed ^ (s.day * 40503) ^ (q * 374761393 + r * 668265263)) | 0)();
    if (roll < 0.35) {
      t.t = 'meadow';
      s.score += 2;
      ev.push({ kind: 'bloom', hex: { q, r } });
      ev.push({ kind: 'score', n: 2, at: { q, r }, label: 'the ash blooms' });
      ev.push({ kind: 'tilechanged', hex: { q, r } });
      discover(s, 'ON_RAIN', ev);
    }
  }
}

/** wind direction the plan prescribes for this day */
function planDir(s: RunState, day: number): number {
  let dir = s.windPlan[0].dir;
  for (const w of s.windPlan) {
    if (w.day <= day) dir = w.dir;
    else break;
  }
  return dir;
}

/** Advance the world by one day: weather, wind, fire, ice. */
function tick(s: RunState, ev: GameEvent[]) {
  s.day++;

  const np = phaseFor(s.day, s.sched);
  if (np !== s.weather) applyWeather(s, np, ev);
  if (s.weather === 'storm') stormBlooms(s, ev);

  // wind follows the plan unless a gust is holding it
  if (s.windStrong > 0) {
    s.windStrong--;
    if (s.windStrong === 0) {
      const dir = planDir(s, s.day);
      if (dir !== s.windDir) {
        s.windDir = dir;
        ev.push({ kind: 'wind', dir });
      }
    }
  } else {
    const dir = planDir(s, s.day);
    if (dir !== s.windDir) {
      s.windDir = dir;
      ev.push({ kind: 'wind', dir });
    }
  }

  // fire spreads, drinks the snow beside it, then burns down
  let transforms = spreadFire(s, ev);
  for (const [k, t] of s.world.tiles) {
    if (!t.burning) continue;
    const [q, r] = k.split(',').map(Number);
    for (const n of neighbors({ q, r })) {
      const nt = tileAt(s, n);
      if (!nt || nt.t !== 'snow') continue;
      const roll = mulberry32((s.world.seed ^ (s.day * 83492791) ^ (n.q * 374761393 + n.r * 668265263)) | 0)();
      if (roll < 0.55) {
        nt.t = 'shallow'; // meltwater: a ford where neither fire nor snow was
        transforms++;
        ev.push({ kind: 'meltwater', hex: n });
        ev.push({ kind: 'tilechanged', hex: n });
        discover(s, 'ON_MELTWATER', ev);
      }
    }
  }
  for (const [k, t] of s.world.tiles) {
    if (!t.burning) continue;
    t.burning--;
    if (t.burning <= 0) {
      delete t.burning;
      const [q, r] = k.split(',').map(Number);
      if (t.ov === 'vine') t.ov = null; // the vine is gone; the cliff remains
      if (t.t === 'forest' || t.t === 'grass' || t.t === 'meadow') {
        t.t = 'ash';
        discover(s, 'FIRE_CLEARS', ev);
      }
      transforms++;
      ev.push({ kind: 'burnout', hex: { q, r } });
      ev.push({ kind: 'tilechanged', hex: { q, r } });
    }
  }

  // regrowth: a meadow beside standing forest slowly returns to it
  for (const [k, t] of s.world.tiles) {
    if (t.t !== 'meadow' || t.burning) continue;
    const [q, r] = k.split(',').map(Number);
    const seeded = neighbors({ q, r }).some((n) => tileAt(s, n)?.t === 'forest');
    if (!seeded) continue;
    const roll = mulberry32((s.world.seed ^ (s.day * 19349663) ^ (q * 374761393 + r * 668265263)) | 0)();
    if (roll < 0.06) {
      t.t = 'forest';
      transforms++;
      s.score += 2;
      ev.push({ kind: 'score', n: 2, at: { q, r }, label: 'the forest returns' });
      ev.push({ kind: 'tilechanged', hex: { q, r } });
      discover(s, 'ON_REGROWTH', ev);
    }
  }

  if (transforms >= 3) {
    const bonus = 5 * transforms;
    s.chainBonus += bonus;
    s.score += bonus;
    ev.push({ kind: 'chain', n: transforms, at: s.player });
    ev.push({ kind: 'score', n: bonus, at: s.player, label: `chain ×${transforms}` });
    discover(s, 'ON_CHAIN', ev);
  }

  // frost-ice melts (never beneath your feet)
  const playerKey = key(s.player.q, s.player.r);
  for (const [k, t] of s.world.tiles) {
    if (t.ov === 'ice' && t.iceLeft !== undefined) {
      if (k === playerKey) continue;
      t.iceLeft--;
      if (t.iceLeft <= 0) {
        t.ov = null;
        delete t.iceLeft;
        const [q, r] = k.split(',').map(Number);
        ev.push({ kind: 'melt', hex: { q, r } });
        ev.push({ kind: 'tilechanged', hex: { q, r } });
      }
    }
  }
}

function checkClauses(s: RunState, ev: GameEvent[]) {
  s.contract.forEach((c, idx) => {
    if (c.met || c.failed) return;
    if (c.kind === 'chart' && s.charted >= c.n) {
      c.met = true;
      ev.push({ kind: 'clause', idx, met: true });
    } else if (c.kind === 'cairns' && s.cairnsFound >= c.n) {
      c.met = true;
      ev.push({ kind: 'clause', idx, met: true });
    } else if (c.kind === 'beacon' && !s.over && s.day > c.n) {
      c.failed = true;
      ev.push({ kind: 'clause', idx, met: false });
    }
  });
}

export function sealsMet(s: RunState): number {
  return s.contract.filter((c) => c.met).length;
}

/** base score × guild-seal multiplier */
export function finalScore(s: RunState): number {
  return Math.round(s.score * (1 + 0.25 * sealsMet(s)));
}

function drawCards(s: RunState, n: number, ev: GameEvent[]) {
  for (let i = 0; i < n; i++) {
    if (s.deck.length === 0 || s.hand.length >= 6) break;
    const c = s.deck.pop()!;
    s.hand.push(c);
    ev.push({ kind: 'draw', card: c });
  }
}

function finish(s: RunState, won: boolean, ev: GameEvent[]) {
  s.over = true;
  s.won = won;
  if (won) {
    s.score += 150 + s.supplies * 2;
    const beacon = s.contract.find((c) => c.kind === 'beacon');
    if (beacon && !beacon.failed && s.day <= beacon.n) {
      beacon.met = true;
      ev.push({ kind: 'clause', idx: s.contract.indexOf(beacon), met: true });
    }
  }
  checkClauses(s, ev);
  ev.push({ kind: 'end', won });
}

export function tryMove(s: RunState, to: Axial): GameEvent[] {
  const ev: GameEvent[] = [];
  if (s.over) return ev;
  if (distance(s.player, to) !== 1) return ev;
  const tile = tileAt(s, to);
  const cost = moveCostNow(s, tile);
  if (cost === null) return ev;
  if (s.supplies <= 0) return ev;
  // a step you can't quite afford still goes — it just spends the last of it
  const paid = s.freeSteps > 0 ? 0 : Math.min(cost, s.supplies);
  if (s.freeSteps > 0) s.freeSteps--;

  const from = s.player;
  s.player = to;
  s.supplies -= paid;
  s.trail.push(to);
  if (s.trail.length > 60) s.trail.shift();
  ev.push({ kind: 'moved', from, to, cost: paid });

  const t = tile!;

  // the ford underfoot teaches its own law
  if (t.t === 'shallow') discover(s, 'ON_FORD', ev);

  // cairns
  if (t.ov === 'cairn' && !t.visited) {
    t.visited = true;
    s.cairnsFound++;
    s.score += 25;
    ev.push({ kind: 'cairn', hex: to });
    ev.push({ kind: 'score', n: 25, at: to, label: 'cairn surveyed' });
    s.supplies += 6;
    ev.push({ kind: 'supplies', n: 6, at: to });
    // the cache beneath the stones: choose one of two cards; a second comes blind
    if (s.deck.length >= 2 && s.hand.length < 6) {
      ev.push({ kind: 'cardchoice', a: s.deck[s.deck.length - 1], b: s.deck[s.deck.length - 2] });
    } else {
      drawCards(s, 2, ev);
    }
    // the first survey teaches the law: the rest are pencilled in as rumours
    discover(s, 'CAIRN_RUMORS', ev);
    // and every cairn holds the next page of Nº 6's journal, until it is whole
    const frag = readNextFragment(FRAGMENTS.length);
    if (frag !== null) ev.push({ kind: 'fragment', idx: frag });
  }

  // chart what we can see
  const high = standingHigh(s);
  const n = chartAround(s, to, high ? 2 : 1, ev);
  if (high && n > 0) discover(s, 'HIGH_VANTAGE', ev);

  // the summit
  if (to.q === s.world.peak.q && to.r === s.world.peak.r) {
    finish(s, true, ev);
    return ev;
  }

  tick(s, ev);
  checkClauses(s, ev);
  if (s.supplies <= 0) finish(s, false, ev);
  return ev;
}

/**
 * Cheapest walking route to a charted hex, or null if none is known.
 * Searches only charted, passable tiles — the cartographer plans on what's inked.
 */
export function findPath(s: RunState, to: Axial): { path: Axial[]; cost: number } | null {
  if (s.over) return null;
  if (to.q === s.player.q && to.r === s.player.r) return null;
  const dest = tileAt(s, to);
  if (!dest || !dest.charted || moveCostNow(s, dest) === null) return null;

  const startK = key(s.player.q, s.player.r);
  const dist = new Map<string, number>([[startK, 0]]);
  const prev = new Map<string, string>();
  const open: [number, Axial][] = [[0, s.player]];
  while (open.length) {
    open.sort((a, b) => a[0] - b[0]); // the island is ~300 tiles; a heap would be ceremony
    const [d, h] = open.shift()!;
    if (d > (dist.get(key(h.q, h.r)) ?? Infinity)) continue;
    if (h.q === to.q && h.r === to.r) break;
    for (const n of neighbors(h)) {
      const t = tileAt(s, n);
      if (!t || !t.charted) continue;
      const c = moveCostNow(s, t);
      if (c === null) continue;
      const nk = key(n.q, n.r);
      const nd = d + c;
      if (nd < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, nd);
        prev.set(nk, key(h.q, h.r));
        open.push([nd, n]);
      }
    }
  }
  const toK = key(to.q, to.r);
  if (!dist.has(toK)) return null;
  const path: Axial[] = [];
  let cur = toK;
  while (cur !== startK) {
    const [q, r] = cur.split(',').map(Number);
    path.unshift({ q, r });
    cur = prev.get(cur)!;
  }
  return { path, cost: dist.get(toK)! };
}

/** Supplies a walk would actually spend, honouring any free Stride steps. */
export function pathSupplyCost(s: RunState, path: Axial[]): number {
  let paid = 0;
  path.forEach((h, i) => {
    if (i < s.freeSteps) return;
    paid += moveCostNow(s, tileAt(s, h)) ?? 0;
  });
  return paid;
}

/** Resolve the cairn's cache: take one of the two offered cards (or neither), then a blind second. */
export function chooseCairnCard(s: RunState, pick: 0 | 1 | null): GameEvent[] {
  const ev: GameEvent[] = [];
  if (pick !== null && s.deck.length >= 2 && s.hand.length < 6) {
    const idx = s.deck.length - 1 - pick;
    const [card] = s.deck.splice(idx, 1);
    s.hand.push(card);
    ev.push({ kind: 'draw', card });
  }
  drawCards(s, 1, ev);
  return ev;
}

/** Hexes a card may legally target right now (empty for untargeted cards). */
export function validTargets(s: RunState, card: CardId): Axial[] {
  if (s.over) return [];
  const near = neighbors(s.player).filter((h) => tileAt(s, h));
  switch (card) {
    case 'ember':
      if (s.weather === 'storm') return []; // the rain forbids fire
      // flame takes wood and grass — and, grudgingly, undoes ice
      return near.filter((h) => {
        const t = tileAt(s, h)!;
        return flammable(t) || t.ov === 'ice';
      });
    case 'gust': return near;
    case 'frost': return near.filter((h) => {
      const t = tileAt(s, h)!;
      // frost takes open water — or smothers a fire in a sigh of steam
      return ((t.t === 'ocean' || t.t === 'river' || t.t === 'shallow') && !t.ov && !t.flooded) || !!t.burning;
    });
    case 'vine': return near.filter((h) => {
      const t = tileAt(s, h)!;
      return t.t === 'cliff' && !t.ov;
    });
    case 'stone': return near.filter((h) => {
      const t = tileAt(s, h)!;
      return (t.t === 'river' || t.t === 'shallow') && t.ov !== 'causeway' && !t.flooded;
    });
    default: return [];
  }
}

export function playCard(s: RunState, handIdx: number, target: Axial | null): GameEvent[] {
  const ev: GameEvent[] = [];
  if (s.over) return ev;
  const card = s.hand[handIdx];
  if (!card) return ev;

  const targets = validTargets(s, card);
  const needsTarget = ['ember', 'gust', 'frost', 'vine', 'stone'].includes(card);
  if (needsTarget) {
    if (!target || !targets.some((h) => h.q === target.q && h.r === target.r)) return ev;
  }

  switch (card) {
    case 'ember': {
      const t = tileAt(s, target!)!;
      if (t.ov === 'ice') {
        // fire on ice: the crossing is spent, not the wood
        t.ov = null;
        delete t.iceLeft;
        ev.push({ kind: 'melt', hex: target! });
        ev.push({ kind: 'tilechanged', hex: target! });
        discover(s, 'ON_STEAM', ev);
      } else {
        ignite(s, target!, ev);
      }
      break;
    }
    case 'gust': {
      const d = dirIndex(s.player, target!);
      if (d >= 0) {
        s.windDir = d;
        s.windStrong = 6;
        ev.push({ kind: 'wind', dir: d });
        spreadFire(s, ev, true);
      }
      break;
    }
    case 'frost': {
      const t = tileAt(s, target!)!;
      if (t.burning) {
        // frost over fire: both are spent; the wood is spared
        delete t.burning;
        ev.push({ kind: 'tilechanged', hex: target! });
        discover(s, 'ON_STEAM', ev);
      } else {
        t.ov = 'ice';
        t.iceLeft = 12;
        ev.push({ kind: 'freeze', hex: target! });
        ev.push({ kind: 'tilechanged', hex: target! });
        discover(s, 'ICE_BRIDGE', ev);
      }
      break;
    }
    case 'vine': {
      const t = tileAt(s, target!)!;
      t.ov = 'vine';
      ev.push({ kind: 'overlay', hex: target!, ov: 'vine' });
      ev.push({ kind: 'tilechanged', hex: target! });
      discover(s, 'VINE_LADDER', ev);
      break;
    }
    case 'stone': {
      const t = tileAt(s, target!)!;
      t.ov = 'causeway';
      delete t.iceLeft;
      ev.push({ kind: 'overlay', hex: target!, ov: 'causeway' });
      ev.push({ kind: 'tilechanged', hex: target! });
      discover(s, 'CAUSEWAY', ev);
      break;
    }
    case 'survey': {
      const high = standingHigh(s);
      const n = chartAround(s, s.player, high ? 3 : 2, ev);
      if (high && n > 0) discover(s, 'HIGH_VANTAGE', ev);
      break;
    }
    case 'stride':
      s.freeSteps += 3;
      break;
  }

  s.hand.splice(handIdx, 1);
  drawCards(s, 1, ev);
  checkClauses(s, ev);
  return ev;
}
