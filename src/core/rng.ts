/** Deterministic PRNG utilities — everything in the game is seeded. */

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable per-coordinate rng (for wobble, glyph placement — never shimmer). */
export function hashRng(x: number, y: number, salt: number): Rng {
  return mulberry32((x * 374761393 + y * 668265263 + salt * 2246822519) | 0);
}

/** Value-noise fbm in 2D on a unit-ish scale, deterministic per seed. */
export function makeNoise(seed: number): (x: number, y: number) => number {
  const perm = new Uint8Array(512);
  const rng = mulberry32(seed);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  const grad = (h: number, x: number, y: number) => {
    switch (h & 3) {
      case 0: return x + y;
      case 1: return -x + y;
      case 2: return x - y;
      default: return -x - y;
    }
  };
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

  function noise(x: number, y: number): number {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = fade(xf), v = fade(yf);
    const aa = perm[perm[X] + Y], ab = perm[perm[X] + Y + 1];
    const ba = perm[perm[X + 1] + Y], bb = perm[perm[X + 1] + Y + 1];
    const l = (a: number, b: number, t: number) => a + t * (b - a);
    return (
      l(
        l(grad(aa, xf, yf), grad(ba, xf - 1, yf), u),
        l(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u),
        v
      ) * 0.7071 + 0.5
    );
  }

  return (x, y) =>
    0.55 * noise(x, y) + 0.3 * noise(x * 2.1 + 31, y * 2.1 + 17) + 0.15 * noise(x * 4.3 + 7, y * 4.3 + 43);
}
