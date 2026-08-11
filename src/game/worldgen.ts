import { key, neighbors, distance, type Axial } from '../core/hex';
import { mulberry32, makeNoise } from '../core/rng';
import { MOVE_COST } from './rules';
import type { Tile, Terrain, World } from './types';

const COLS = 22;
const ROWS = 15;

/** offset (odd-r) → axial */
function axial(col: number, row: number): Axial {
  return { q: col - ((row - (row & 1)) / 2), r: row };
}

const PASSABLE: Terrain[] = ['beach', 'grass', 'forest', 'ash', 'shallow', 'highland', 'snow', 'peak'];

export function generateWorld(baseSeed: number): World {
  for (let attempt = 0; attempt < 40; attempt++) {
    const seed = (baseSeed + attempt * 7919) | 0;
    const w = tryGenerate(seed);
    if (w) return { ...w, seed: baseSeed };
  }
  // pathological seed: fall back to whatever the last attempt made, un-validated
  return tryGenerate(baseSeed, true)!;
}

function tryGenerate(seed: number, force = false): World | null {
  const rng = mulberry32(seed);
  const elevNoise = makeNoise(seed ^ 0x5eed);
  const moistNoise = makeNoise(seed ^ 0xbeef);

  const tiles = new Map<string, Tile>();
  const elevOf = new Map<string, number>();

  // peak sits in the northern third
  const pcol = COLS * 0.5 + (rng() - 0.5) * 5;
  const prow = ROWS * 0.22 + (rng() - 0.5) * 2;

  let peakKey = '';
  let peakElev = -1;
  const coords: { col: number; row: number; h: Axial }[] = [];

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const h = axial(col, row);
      coords.push({ col, row, h });
      const dx = (col - COLS / 2) / (COLS * 0.46);
      const dy = (row - ROWS * 0.54) / (ROWS * 0.52);
      const base = 1 - Math.sqrt(dx * dx + dy * dy);
      const pd2 = (col - pcol) ** 2 + (row - prow) ** 2;
      const pk = Math.exp(-pd2 / (2 * (ROWS * 0.21) ** 2));
      let elev = base * 0.52 + pk * 0.62 + (elevNoise(col * 0.13, row * 0.13) - 0.5) * 0.34;
      elev = Math.max(0, Math.min(1, elev));
      elevOf.set(key(h.q, h.r), elev);
      if (elev > peakElev) { peakElev = elev; peakKey = key(h.q, h.r); }
    }
  }

  // terrain from elevation + moisture
  for (const { col, row, h } of coords) {
    const k = key(h.q, h.r);
    const elev = elevOf.get(k)!;
    const moist = moistNoise(col * 0.17 + 53, row * 0.17 + 11);
    let t: Terrain;
    if (elev < 0.24) t = 'ocean';
    else if (elev < 0.3) t = 'beach';
    else if (elev >= 0.76) t = 'snow';
    else if (elev >= 0.6) t = 'highland';
    else if (moist > 0.55 && elev >= 0.34) t = 'forest';
    else t = 'grass';
    tiles.set(k, { t, ov: null, elev, charted: false });
  }

  // cliff ring: highland/snow edge hexes overlooking low land
  for (const { h } of coords) {
    const k = key(h.q, h.r);
    const tile = tiles.get(k)!;
    if (tile.t !== 'highland' && tile.t !== 'snow') continue;
    const drop = neighbors(h).some((n) => {
      const e = elevOf.get(key(n.q, n.r));
      return e !== undefined && e < tile.elev - 0.14;
    });
    if (drop) tile.t = 'cliff';
  }

  // the peak itself
  const [pq, pr] = peakKey.split(',').map(Number);
  const peak: Axial = { q: pq, r: pr };
  const peakTile = tiles.get(peakKey)!;
  peakTile.t = 'peak';
  peakTile.ov = 'beacon';
  // guarantee at least one standable approach next to the peak
  const pNbrs = neighbors(peak).filter((n) => tiles.has(key(n.q, n.r)));
  if (!pNbrs.some((n) => PASSABLE.includes(tiles.get(key(n.q, n.r))!.t))) {
    let best = pNbrs[0];
    for (const n of pNbrs) {
      if (elevOf.get(key(n.q, n.r))! > elevOf.get(key(best.q, best.r))!) best = n;
    }
    tiles.get(key(best.q, best.r))!.t = 'snow';
  }

  // river: descend from a high shoulder to the sea
  const shoulders = coords.filter(({ h }) => {
    const tl = tiles.get(key(h.q, h.r))!;
    return tl.elev > 0.55 && tl.t !== 'peak' && distance(h, peak) >= 2 && distance(h, peak) <= 5;
  });
  if (shoulders.length > 0) {
    let cur = shoulders[Math.floor(rng() * shoulders.length)].h;
    const riverPath: Axial[] = [];
    for (let steps = 0; steps < 40; steps++) {
      riverPath.push(cur);
      const curElev = elevOf.get(key(cur.q, cur.r))!;
      let next: Axial | null = null;
      let bestE = Infinity;
      for (const n of neighbors(cur)) {
        const e = elevOf.get(key(n.q, n.r));
        if (e === undefined) continue;
        if (riverPath.some((p) => p.q === n.q && p.r === n.r)) continue;
        const jitter = (rng() - 0.5) * 0.02;
        if (e + jitter < bestE) { bestE = e + jitter; next = n; }
      }
      if (!next) break;
      const nt = tiles.get(key(next.q, next.r))!;
      if (nt.t === 'ocean') break;
      cur = next;
      if (elevOf.get(key(cur.q, cur.r))! < 0.26) break;
    }
    for (const p of riverPath) {
      const tl = tiles.get(key(p.q, p.r))!;
      if (tl.t !== 'peak' && tl.t !== 'ocean') tl.t = 'river';
    }
    // a single ford where the river runs low
    const low = riverPath.filter((p) => elevOf.get(key(p.q, p.r))! < 0.38);
    if (low.length > 0) {
      const ford = low[Math.floor(rng() * low.length)];
      tiles.get(key(ford.q, ford.r))!.t = 'shallow';
    }
  }

  // a pass through the cliff ring
  const passCandidates = coords.filter(({ h }) => {
    const tl = tiles.get(key(h.q, h.r))!;
    if (tl.t !== 'cliff') return false;
    const ns = neighbors(h).map((n) => tiles.get(key(n.q, n.r))).filter(Boolean) as Tile[];
    const hasHigh = ns.some((n) => n.t === 'highland' || n.t === 'snow' || n.t === 'peak');
    const hasLow = ns.some((n) => n.t === 'grass' || n.t === 'forest' || n.t === 'beach');
    return hasHigh && hasLow;
  });
  if (passCandidates.length > 0) {
    const pass = passCandidates[Math.floor(rng() * passCandidates.length)].h;
    tiles.get(key(pass.q, pass.r))!.t = 'highland';
  }

  // landing: the southernmost beach
  let start: Axial | null = null;
  for (let row = ROWS - 1; row >= 0 && !start; row--) {
    const beaches = coords.filter(({ row: rr, h }) => rr === row && tiles.get(key(h.q, h.r))!.t === 'beach');
    if (beaches.length > 0) start = beaches[Math.floor(beaches.length / 2)].h;
  }
  if (!start) return force ? null : null;

  // cairns: scattered, mutually distant, away from the landing
  const cairnSpots: Axial[] = [];
  const candidates = coords
    .map(({ h }) => h)
    .filter((h) => {
      const tl = tiles.get(key(h.q, h.r))!;
      return PASSABLE.includes(tl.t) && tl.t !== 'peak' && !tl.ov && distance(h, start!) >= 4 && distance(h, peak) >= 2;
    })
    .sort(() => rng() - 0.5);
  for (const c of candidates) {
    if (cairnSpots.length >= 4) break;
    if (cairnSpots.every((s) => distance(s, c) >= 4)) cairnSpots.push(c);
  }
  for (const c of cairnSpots) tiles.get(key(c.q, c.r))!.ov = 'cairn';

  // validate: the island must be finishable without a single card — and the
  // cheapest card-free walk to the beacon prices the whole expedition
  const walk = cheapestWalk(tiles, start, peak);
  if (!walk && !force) return null;
  if (cairnSpots.length < 3 && !force) return null;

  return {
    seed, tiles, start, peak, cairns: cairnSpots, cols: COLS, rows: ROWS,
    walkCost: walk?.cost ?? 24,
    walkSteps: walk?.steps ?? 14,
  };
}

/** Dijkstra over card-free terrain: supplies and days the beeline actually takes. */
function cheapestWalk(
  tiles: Map<string, Tile>,
  start: Axial,
  peak: Axial
): { cost: number; steps: number } | null {
  const dist = new Map<string, number>([[key(start.q, start.r), 0]]);
  const hops = new Map<string, number>([[key(start.q, start.r), 0]]);
  const open: [number, Axial][] = [[0, start]];
  while (open.length) {
    open.sort((a, b) => a[0] - b[0]);
    const [d, h] = open.shift()!;
    const hk = key(h.q, h.r);
    if (d > (dist.get(hk) ?? Infinity)) continue;
    if (h.q === peak.q && h.r === peak.r) return { cost: d, steps: hops.get(hk)! };
    for (const n of neighbors(h)) {
      const nk = key(n.q, n.r);
      const tl = tiles.get(nk);
      if (!tl || !PASSABLE.includes(tl.t)) continue;
      const c = MOVE_COST[tl.t] ?? 1;
      const nd = d + c;
      if (nd < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, nd);
        hops.set(nk, hops.get(hk)! + 1);
        open.push([nd, n]);
      }
    }
  }
  return null;
}
