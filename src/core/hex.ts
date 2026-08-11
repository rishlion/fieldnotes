/** Pointy-top axial hex grid math. */

export interface Axial { q: number; r: number }

export const key = (q: number, r: number) => `${q},${r}`;
export const keyOf = (h: Axial) => key(h.q, h.r);

export const DIRS: Axial[] = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

export function neighbors(h: Axial): Axial[] {
  return DIRS.map((d) => ({ q: h.q + d.q, r: h.r + d.r }));
}

export function add(a: Axial, b: Axial): Axial {
  return { q: a.q + b.q, r: a.r + b.r };
}

export function distance(a: Axial, b: Axial): number {
  const dq = a.q - b.q, dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function ring(center: Axial, radius: number): Axial[] {
  if (radius === 0) return [center];
  const out: Axial[] = [];
  let h = { q: center.q + DIRS[4].q * radius, r: center.r + DIRS[4].r * radius };
  for (let side = 0; side < 6; side++) {
    for (let i = 0; i < radius; i++) {
      out.push(h);
      h = add(h, DIRS[side]);
    }
  }
  return out;
}

export function disc(center: Axial, radius: number): Axial[] {
  const out: Axial[] = [];
  for (let rr = 0; rr <= radius; rr++) out.push(...ring(center, rr));
  return out;
}

/** Pixel position of hex center (unit size). */
export function toPixel(h: Axial, size: number): { x: number; y: number } {
  return {
    x: size * Math.sqrt(3) * (h.q + h.r / 2),
    y: size * 1.5 * h.r,
  };
}

/** Pixel → axial with cube rounding. */
export function fromPixel(x: number, y: number, size: number): Axial {
  const q = ((Math.sqrt(3) / 3) * x - (1 / 3) * y) / size;
  const r = ((2 / 3) * y) / size;
  return cubeRound(q, r);
}

function cubeRound(q: number, r: number): Axial {
  const s = -q - r;
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}

/** The six corners of a hex at center (cx, cy). */
export function corners(cx: number, cy: number, size: number, shrink = 0): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push([cx + (size - shrink) * Math.cos(a), cy + (size - shrink) * Math.sin(a)]);
  }
  return pts;
}
