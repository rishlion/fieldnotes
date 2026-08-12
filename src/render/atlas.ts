import { corners, key, neighbors, toPixel, fromPixel, distance, type Axial } from '../core/hex';
import { hashRng, mulberry32, type Rng } from '../core/rng';
import type { RunState, Tile, Terrain } from '../game/types';
import { tileAt, moveCostNow, findPath, pathSupplyCost } from '../game/rules';

const INK = '#4a3826';
const RED = '#8c2f22';
/** hex size the glyph art was designed at — everything scales from here */
const BASE = 22;

const WASH: Partial<Record<Terrain, string>> = {
  ocean: '#a5c0ba', shallow: '#bccfc2', beach: '#e2cf9d', grass: '#b8bd8b',
  forest: '#8ea36c', ash: '#b3a58f', meadow: '#c2ca8e', river: '#96b7bb', cliff: '#c2ab84',
  highland: '#adb78a', snow: '#efe9da', peak: '#e8ddc6',
};

/** what the hover label calls each terrain — vocabulary taught in passing */
const TERRAIN_NAME: Record<Terrain, string> = {
  ocean: 'open water', shallow: 'shallows', beach: 'beach', grass: 'grassland',
  forest: 'forest', ash: 'ash', meadow: 'meadow', river: 'river', cliff: 'cliff',
  highland: 'highland', snow: 'snow', peak: 'the summit',
};

function tileName(t: Tile): string {
  if (t.ov === 'ice') return 'ice';
  if (t.ov === 'causeway') return 'causeway';
  if (t.ov === 'vine') return 'vine';
  if (t.ov === 'cairn') return 'cairn';
  if (t.ov === 'beacon') return 'the beacon';
  return TERRAIN_NAME[t.t];
}

/** direction of edge e (edge spans corners e and e+1) */
const EDGE_DIR: Axial[] = [
  { q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 },
  { q: -1, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 },
];

interface Settle { hex: Axial; sprite: HTMLCanvasElement; spriteS: number; t0: number; stamped: boolean }
interface Floater { x: number; y: number; text: string; color: string; t0: number; big?: boolean }

export class AtlasRenderer {
  private cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private paper = document.createElement('canvas');
  private chart = document.createElement('canvas');
  private grain = document.createElement('canvas');

  private DPR = 1;
  private CW = 0;
  private CH = 0;
  private lastVW = -1;
  private lastVH = -1;

  /* camera: current, target, and the camera the chart layer was stamped at */
  S = BASE;
  private OX = 0;
  private OY = 0;
  private tS = BASE;
  private tOX = 0;
  private tOY = 0;
  private stampS = BASE;
  private stampOX = 0;
  private stampOY = 0;
  private lastT = 0;

  private settles: Settle[] = [];
  private floaters: Floater[] = [];

  hover: Axial | null = null;
  targets: Axial[] = [];
  beaconLit = false;
  /** true from run creation until the ship lands — the chart stays blank parchment */
  chartVeiled = true;
  /** the primer's pencil ring: the hex it is currently pointing at */
  tutHex: Axial | null = null;
  /** the walk tween: the cartographer slides between hexes rather than teleporting */
  private moveAnim: { from: Axial; to: Axial; t0: number } | null = null;

  playerMoved(from: Axial, to: Axial) {
    this.moveAnim = { from, to, t0: performance.now() };
  }

  /** Nº 6's line of march: old ink under the new, three days from fading */
  ghostTrail: { path: Axial[]; bornDay: number } | null = null;
  /** the beacon lit twice — theirs, at last */
  twinFlame = false;
  /** the ridge vignette: two shapes climbing toward the summit, dissolving */
  private ghostWalk: { from: Axial; t0: number } | null = null;

  startGhostWalk(from: Axial) {
    this.ghostWalk = { from, t0: performance.now() };
  }

  /* ship-to-shore arrival: a short inked crossing before the letter */
  private arrival: { t0: number; dur: number; onDone: () => void } | null = null;

  get arrivalActive(): boolean {
    return this.arrival !== null;
  }

  startArrival(onDone: () => void) {
    this.arrival = { t0: performance.now(), dur: 2800, onDone };
  }

  skipArrival() {
    if (!this.arrival) return;
    const cb = this.arrival.onDone;
    this.arrival = null;
    cb();
  }

  constructor(canvas: HTMLCanvasElement, private state: RunState) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.makeGrain();
    this.layout();
  }

  setState(s: RunState) {
    this.state = s;
    this.settles = [];
    this.floaters = [];
    this.targets = [];
    this.beaconLit = false;
    this.chartVeiled = true;
    this.tutHex = null;
    this.moveAnim = null;
    this.ghostTrail = null;
    this.ghostWalk = null;
    this.twinFlame = false;
    this.layout();
  }

  /* ---------------- camera ---------------- */

  private availW() { return Math.max(120, this.CW - 130); }
  private availH() { return Math.max(90, this.CH - 96 - 216); }

  /**
   * Where the camera wants to be: fit the charted region (plus the player)
   * while exploring, or the whole landmass once the expedition is over.
   */
  private fitCamera() {
    const s = this.state;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const include = (q: number, r: number) => {
      const p = toPixel({ q, r }, 1);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    };

    if (s.over) {
      // the finale: pull back to the whole island and its coast
      for (const [k, t] of s.world.tiles) {
        const [q, r] = k.split(',').map(Number);
        if (t.t === 'ocean') {
          const coastal = neighbors({ q, r }).some((n) => {
            const nt = s.world.tiles.get(key(n.q, n.r));
            return nt && nt.t !== 'ocean';
          });
          if (!coastal) continue;
        }
        include(q, r);
      }
    } else {
      for (const [k, t] of s.world.tiles) {
        if (!t.charted) continue;
        const [q, r] = k.split(',').map(Number);
        include(q, r);
      }
      include(s.player.q, s.player.r);
      // card targets can sit on uncharted water — never let the hand hide them
      for (const t of this.targets) include(t.q, t.r);
    }
    if (minX === Infinity) return;

    const aw = this.availW(), ah = this.availH();
    const spanX = maxX - minX + 3.4, spanY = maxY - minY + 3.4;
    this.tS = Math.max(4, Math.min(46, Math.min(aw / spanX, ah / spanY)));
    const wpx = (maxX - minX) * this.tS, wpy = (maxY - minY) * this.tS;
    this.tOX = 65 + (aw - wpx) / 2 - minX * this.tS;
    this.tOY = 84 + (ah - wpy) / 2 - minY * this.tS;
  }

  private tweenCamera(now: number) {
    const dt = Math.min(100, this.lastT ? now - this.lastT : 16);
    this.lastT = now;
    const k = 1 - Math.exp(-dt / 320);
    this.S += (this.tS - this.S) * k;
    this.OX += (this.tOX - this.OX) * k;
    this.OY += (this.tOY - this.OY) * k;
    if (Math.abs(this.S - this.tS) < 0.04 && Math.abs(this.OX - this.tOX) < 0.4 && Math.abs(this.OY - this.tOY) < 0.4) {
      this.S = this.tS; this.OX = this.tOX; this.OY = this.tOY;
    }
  }

  private cameraAtStamp(): boolean {
    return this.S === this.stampS && this.OX === this.stampOX && this.OY === this.stampOY;
  }

  layout() {
    this.DPR = Math.min(2, window.devicePixelRatio || 1);
    this.lastVW = window.innerWidth;
    this.lastVH = window.innerHeight;
    // some embeds report a 0×0 viewport at boot — never build zero-sized canvases
    this.CW = Math.max(320, window.innerWidth);
    this.CH = Math.max(240, window.innerHeight);
    this.cv.width = this.CW * this.DPR;
    this.cv.height = this.CH * this.DPR;

    this.buildPaper();
    this.fitCamera();
    // viewport changes snap; in-game growth tweens
    this.S = this.tS; this.OX = this.tOX; this.OY = this.tOY;
    for (const st of this.settles) {
      if (st.stamped) continue;
      const tile = this.state.world.tiles.get(key(st.hex.q, st.hex.r));
      if (tile) { st.sprite = this.spriteFor(st.hex, tile); st.spriteS = this.S; }
    }
    this.buildChart();
  }

  center(h: Axial): { x: number; y: number } {
    const p = toPixel(h, this.S);
    return { x: p.x + this.OX, y: p.y + this.OY };
  }

  screenToHex(px: number, py: number): Axial {
    return fromPixel(px - this.OX, py - this.OY, this.S);
  }

  /* ---------------- static layers ---------------- */

  private makeGrain() {
    this.grain.width = 256;
    this.grain.height = 256;
    const g = this.grain.getContext('2d')!;
    const im = g.createImageData(256, 256);
    const rnd = mulberry32(7);
    for (let i = 0; i < im.data.length; i += 4) {
      const v = 200 + rnd() * 55;
      im.data[i] = im.data[i + 1] = im.data[i + 2] = v;
      im.data[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  }

  private buildPaper() {
    const w = this.CW, h = this.CH;
    this.paper.width = w * this.DPR;
    this.paper.height = h * this.DPR;
    const g = this.paper.getContext('2d')!;
    g.setTransform(this.DPR, 0, 0, this.DPR, 0, 0);

    const bg = g.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, Math.max(w, h) * 0.75);
    bg.addColorStop(0, '#ecdfc0');
    bg.addColorStop(0.75, '#e3d2ab');
    bg.addColorStop(1, '#cdb587');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);

    g.globalAlpha = 0.09;
    g.globalCompositeOperation = 'multiply';
    for (let x = 0; x < w; x += 256) for (let y = 0; y < h; y += 256) g.drawImage(this.grain, x, y);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';

    const rnd = mulberry32(11);
    for (let i = 0; i < 7; i++) {
      const x = rnd() * w, y = rnd() * h, rad = 30 + rnd() * 90;
      const st = g.createRadialGradient(x, y, rad * 0.3, x, y, rad);
      st.addColorStop(0, 'rgba(150,120,70,0.05)');
      st.addColorStop(1, 'rgba(150,120,70,0)');
      g.fillStyle = st;
      g.beginPath();
      g.arc(x, y, rad, 0, 7);
      g.fill();
    }

    g.strokeStyle = 'rgba(120,90,50,.35)';
    g.lineWidth = 2;
    g.strokeRect(14.5, 14.5, w - 29, h - 29);
    g.strokeStyle = 'rgba(120,90,50,.18)';
    g.lineWidth = 1;
    g.strokeRect(20.5, 20.5, w - 41, h - 41);

    this.compass(g, w - 92, h - 190);
  }

  private compass(g: CanvasRenderingContext2D, x: number, y: number) {
    g.save();
    g.translate(x, y);
    g.strokeStyle = 'rgba(64,48,28,.7)';
    g.fillStyle = 'rgba(64,48,28,.7)';
    g.lineWidth = 1.3;
    g.beginPath(); g.arc(0, 0, 26, 0, 7); g.stroke();
    g.beginPath(); g.arc(0, 0, 20, 0, 7); g.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4, L = i % 2 ? 12 : 20;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(Math.sin(a - 0.12) * L * 0.35, -Math.cos(a - 0.12) * L * 0.35);
      g.lineTo(Math.sin(a) * L, -Math.cos(a) * L);
      g.lineTo(Math.sin(a + 0.12) * L * 0.35, -Math.cos(a + 0.12) * L * 0.35);
      g.closePath();
      i % 2 ? g.stroke() : g.fill();
    }
    g.font = '700 13px Palatino,serif';
    g.textAlign = 'center';
    g.fillText('N', 0, -32);
    g.restore();
  }

  buildChart() {
    this.chart.width = this.CW * this.DPR;
    this.chart.height = this.CH * this.DPR;
    const g = this.chart.getContext('2d')!;
    g.setTransform(this.DPR, 0, 0, this.DPR, 0, 0);
    this.stampS = this.S; this.stampOX = this.OX; this.stampOY = this.OY;
    const settling = new Set(this.settles.filter((s) => !s.stamped).map((s) => key(s.hex.q, s.hex.r)));
    for (const [k, t] of this.state.world.tiles) {
      if (!t.charted || settling.has(k)) continue;
      const [q, r] = k.split(',').map(Number);
      this.stampTile(g, { q, r }, t);
    }
  }

  /** Full repaint of the chart layer (cheap enough; called on tile changes). */
  refreshChart() {
    this.buildChart();
  }

  /* ---------------- per-hex painting ---------------- */

  private wobblyPath(g: CanvasRenderingContext2D, pts: [number, number][], wob: number, rnd: Rng) {
    g.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
      if (i === 0) g.moveTo(x1, y1);
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      for (let s = 1; s <= 3; s++) {
        const t = s / 3, o = (rnd() - 0.5) * wob;
        g.lineTo(x1 + dx * t + nx * o, y1 + dy * t + ny * o);
      }
    }
    g.closePath();
  }

  stampTile(g: CanvasRenderingContext2D, h: Axial, tile: Tile, cx?: number, cy?: number) {
    const S = this.S;
    const u = S / BASE;
    const c = cx !== undefined && cy !== undefined ? { x: cx, y: cy } : this.center(h);
    const color = tile.flooded ? '#7fa3ad' : WASH[tile.t] ?? '#ccc';
    const rnd = hashRng(h.q, h.r, 5);

    // watercolor wash
    g.save();
    this.wobblyPath(g, corners(c.x, c.y, S, u), 2.5 * u, hashRng(h.q, h.r, 6));
    g.globalAlpha = tile.t === 'ocean' || tile.t === 'river' || tile.t === 'shallow' ? 0.5 : 0.62;
    g.fillStyle = color;
    g.fill();
    g.globalAlpha *= 0.5;
    g.lineWidth = 3 * u;
    g.strokeStyle = color;
    g.stroke();
    for (let i = 0; i < 2; i++) {
      g.globalAlpha = 0.09;
      g.fillStyle = color;
      g.beginPath();
      g.arc(c.x + (rnd() - 0.5) * S * 0.7, c.y + (rnd() - 0.5) * S * 0.6, S * 0.22 * rnd() + 2 * u, 0, 7);
      g.fill();
    }
    g.restore();

    // glyphs and overlays are drawn at design scale, uniformly zoomed
    g.save();
    g.translate(c.x, c.y);
    g.scale(u, u);
    this.glyphs(g, h, tile);
    if (tile.ov) this.overlayArt(g, h, tile);
    g.restore();

    this.edgeInk(g, h, tile, c.x, c.y, u);
  }

  /** terrain marks, drawn around (0,0) at BASE scale */
  private glyphs(g: CanvasRenderingContext2D, h: Axial, tile: Tile) {
    const B = BASE;
    const rnd = hashRng(h.q, h.r, 9);
    g.save();
    g.strokeStyle = INK;
    g.fillStyle = INK;
    g.lineWidth = 1.2;
    g.lineCap = 'round';
    switch (tile.t) {
      case 'forest': {
        const n = 2 + Math.floor(rnd() * 2);
        for (let i = 0; i < n; i++) {
          const tx = (rnd() - 0.5) * B * 0.9, ty = (rnd() - 0.5) * B * 0.8;
          g.beginPath(); g.moveTo(tx, ty + 5); g.lineTo(tx, ty - 1); g.stroke();
          g.globalAlpha = 0.75;
          g.beginPath();
          g.arc(tx - 2, ty - 4, 3.4, 0, 7);
          g.arc(tx + 2.5, ty - 3.4, 3, 0, 7);
          g.arc(tx, ty - 6.5, 3.1, 0, 7);
          g.fillStyle = '#5f7a45';
          g.fill();
          g.globalAlpha = 1;
          g.fillStyle = INK;
          g.beginPath(); g.arc(tx - 2, ty - 4, 3.4, 0.6, 3.6); g.stroke();
        }
        break;
      }
      case 'meadow': {
        g.globalAlpha = 0.55;
        for (let i = 0; i < 2; i++) {
          const tx = (rnd() - 0.5) * B, ty = (rnd() - 0.5) * B * 0.8;
          g.beginPath();
          g.moveTo(tx - 2, ty + 2); g.lineTo(tx - 1, ty - 2);
          g.stroke();
        }
        g.globalAlpha = 0.9;
        for (let i = 0; i < 4; i++) {
          g.fillStyle = i % 2 ? '#b0512f' : '#efe6d0';
          g.beginPath();
          g.arc((rnd() - 0.5) * B * 0.95, (rnd() - 0.5) * B * 0.8, 1.1, 0, 7);
          g.fill();
        }
        g.fillStyle = INK;
        break;
      }
      case 'grass':
      case 'highland': {
        g.globalAlpha = 0.55;
        for (let i = 0; i < 3; i++) {
          const tx = (rnd() - 0.5) * B, ty = (rnd() - 0.5) * B * 0.8;
          g.beginPath();
          g.moveTo(tx - 2, ty + 2); g.lineTo(tx - 1, ty - 2);
          g.moveTo(tx + 1, ty + 2); g.lineTo(tx + 2, ty - 1.5);
          g.stroke();
        }
        if (tile.t === 'highland') {
          g.globalAlpha = 0.4;
          g.beginPath();
          g.arc(0, B * 0.1, B * 0.55, Math.PI * 1.15, Math.PI * 1.85);
          g.stroke();
        }
        break;
      }
      case 'beach': {
        g.globalAlpha = 0.5;
        for (let i = 0; i < 6; i++) {
          g.beginPath();
          g.arc((rnd() - 0.5) * B * 1.1, (rnd() - 0.5) * B * 0.9, 0.8, 0, 7);
          g.fill();
        }
        break;
      }
      case 'cliff': {
        g.globalAlpha = 0.8;
        for (let i = 0; i < 3; i++) {
          const tx = (rnd() - 0.5) * B * 0.7, ty = (rnd() - 0.5) * B * 0.6;
          g.beginPath();
          g.moveTo(tx - 4, ty + 3); g.lineTo(tx, ty - 3); g.lineTo(tx + 4, ty + 3);
          g.stroke();
        }
        break;
      }
      case 'snow': {
        g.globalAlpha = 0.45;
        for (let i = 0; i < 4; i++) {
          g.beginPath();
          g.arc((rnd() - 0.5) * B, (rnd() - 0.5) * B * 0.8, 0.9, 0, 7);
          g.fill();
        }
        break;
      }
      case 'peak': {
        g.globalAlpha = 0.9;
        g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(-B * 0.55, B * 0.35);
        g.lineTo(-B * 0.1, -B * 0.4);
        g.lineTo(B * 0.1, -B * 0.05);
        g.lineTo(B * 0.3, -B * 0.5);
        g.lineTo(B * 0.6, B * 0.35);
        g.stroke();
        break;
      }
      case 'ash': {
        g.globalAlpha = 0.6;
        for (let i = 0; i < 3; i++) {
          const tx = (rnd() - 0.5) * B * 0.8, ty = (rnd() - 0.5) * B * 0.7;
          g.beginPath(); g.moveTo(tx, ty + 3); g.lineTo(tx, ty - 2); g.stroke();
          g.beginPath(); g.moveTo(tx - 2.5, ty - 1); g.lineTo(tx + 2.5, ty - 3); g.stroke();
        }
        break;
      }
      case 'river':
      case 'shallow':
      case 'ocean': {
        g.strokeStyle = 'rgba(60,90,90,.45)';
        g.lineWidth = 1;
        for (let i = 0; i < 2; i++) {
          const rx = (rnd() - 0.5) * B, ry = (rnd() - 0.5) * B * 0.8;
          g.beginPath();
          g.moveTo(rx - 5, ry);
          g.quadraticCurveTo(rx, ry - 2.5, rx + 5, ry);
          g.stroke();
        }
        if (tile.t === 'shallow' && !tile.flooded) {
          g.fillStyle = 'rgba(74,56,38,.5)';
          for (let i = 0; i < 4; i++) {
            g.beginPath();
            g.arc((rnd() - 0.5) * B, (rnd() - 0.5) * B * 0.7, 0.8, 0, 7);
            g.fill();
          }
        }
        break;
      }
    }
    g.restore();
  }

  private edgeInk(g: CanvasRenderingContext2D, h: Axial, tile: Tile, x: number, y: number, u: number) {
    const S = this.S;
    const water = (t?: Tile) => !!t && t.t === 'ocean';
    const riverish = (t?: Tile) => !!t && (t.t === 'river' || t.t === 'shallow');
    const isLand = !water(tile) && !riverish(tile);
    if (!isLand) return;
    const pts = corners(x, y, S);
    for (let e = 0; e < 6; e++) {
      const nb = tileAt(this.state, { q: h.q + EDGE_DIR[e].q, r: h.r + EDGE_DIR[e].r });
      if (!nb) continue;
      const coast = water(nb);
      const bank = riverish(nb);
      if (!coast && !bank) continue;
      const [x1, y1] = pts[e], [x2, y2] = pts[(e + 1) % 6];
      const rnd = hashRng(h.q * 7 + e, h.r * 13, 17);
      g.save();
      g.lineCap = 'round';
      g.lineWidth = (coast ? 1.8 : 1.1) * u;
      g.strokeStyle = coast ? 'rgba(58,44,28,.85)' : 'rgba(58,44,28,.5)';
      g.beginPath();
      g.moveTo(x1, y1);
      const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1;
      const nx = -dy / L, ny = dx / L;
      for (let s = 1; s <= 3; s++) {
        const t = s / 3, o = (rnd() - 0.5) * 3 * u;
        g.lineTo(x1 + dx * t + nx * o, y1 + dy * t + ny * o);
      }
      g.stroke();
      if (coast) {
        g.lineWidth = 3.5 * u;
        g.strokeStyle = 'rgba(80,110,110,.25)';
        g.beginPath();
        g.moveTo(x1 + nx * 3 * u, y1 + ny * 3 * u);
        g.lineTo(x2 + nx * 3 * u, y2 + ny * 3 * u);
        g.stroke();
      }
      g.restore();
    }
  }

  /** overlay art, drawn around (0,0) at BASE scale */
  private overlayArt(g: CanvasRenderingContext2D, h: Axial, tile: Tile) {
    const B = BASE;
    g.save();
    switch (tile.ov) {
      case 'cairn': {
        g.strokeStyle = INK;
        g.lineWidth = 1.4;
        g.fillStyle = '#a99674';
        const st = (dx: number, dy: number, w2: number, h2: number) => {
          g.beginPath(); g.ellipse(dx, dy, w2, h2, 0, 0, 7); g.fill(); g.stroke();
        };
        st(0, 4, 6, 2.6); st(0, 0, 4.6, 2.2); st(0, -3.4, 3, 1.8);
        // the flag is the surveyor's mark — dormant cairns are bare stones
        if (tile.visited) {
          g.strokeStyle = RED;
          g.lineWidth = 1.6;
          g.beginPath(); g.moveTo(7, 6); g.lineTo(7, -9); g.stroke();
          g.fillStyle = RED;
          g.beginPath(); g.moveTo(7, -9); g.lineTo(14, -6.6); g.lineTo(7, -4.4); g.closePath(); g.fill();
        }
        break;
      }
      case 'beacon': {
        g.strokeStyle = RED;
        g.fillStyle = RED;
        g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(-4, 6); g.lineTo(-2, -6); g.lineTo(2, -6); g.lineTo(4, 6); g.stroke();
        g.beginPath(); g.arc(0, -8.5, 2.4, 0, 7); g.fill();
        break;
      }
      case 'ice': {
        g.globalAlpha = 0.55;
        this.wobblyPath(g, corners(0, 0, B, 2), 2, hashRng(h.q, h.r, 33));
        g.fillStyle = '#dcebe8';
        g.fill();
        g.globalAlpha = 0.7;
        g.strokeStyle = 'rgba(90,130,140,.8)';
        g.lineWidth = 1;
        const rnd = hashRng(h.q, h.r, 34);
        for (let i = 0; i < 3; i++) {
          const ax = (rnd() - 0.5) * B, ay = (rnd() - 0.5) * B * 0.8;
          g.beginPath();
          g.moveTo(ax - 4, ay + (rnd() - 0.5) * 3);
          g.lineTo(ax + 1, ay);
          g.lineTo(ax + 5, ay - 3 * rnd());
          g.stroke();
        }
        break;
      }
      case 'causeway': {
        g.strokeStyle = INK;
        g.fillStyle = '#b5a88c';
        g.lineWidth = 1.1;
        const rnd = hashRng(h.q, h.r, 35);
        for (let i = -1; i <= 1; i++) {
          const sx = i * B * 0.42, sy = (rnd() - 0.5) * 3;
          g.beginPath();
          g.ellipse(sx, sy, B * 0.2, B * 0.13, (rnd() - 0.5) * 0.4, 0, 7);
          g.fill(); g.stroke();
        }
        break;
      }
      case 'vine': {
        g.strokeStyle = '#4c6b34';
        g.lineWidth = 1.8;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(-B * 0.25, B * 0.5);
        g.bezierCurveTo(-B * 0.55, 0, B * 0.35, B * 0.05, B * 0.1, -B * 0.5);
        g.stroke();
        g.lineWidth = 1.2;
        for (const [lx, ly] of [[-0.28, 0.15], [0.08, -0.12], [-0.05, -0.35]] as [number, number][]) {
          g.beginPath();
          g.ellipse(lx * B, ly * B, 2.6, 1.5, 0.6, 0, 7);
          g.stroke();
        }
        break;
      }
    }
    g.restore();
  }

  /* ---------------- charted-hex animation ---------------- */

  private spriteFor(h: Axial, tile: Tile): HTMLCanvasElement {
    const S = this.S;
    const box = Math.ceil(S * 4);
    const cnv = document.createElement('canvas');
    cnv.width = box * this.DPR;
    cnv.height = box * this.DPR;
    const g = cnv.getContext('2d')!;
    g.setTransform(this.DPR, 0, 0, this.DPR, 0, 0);
    this.stampTile(g, h, tile, box / 2, box / 2);
    return cnv;
  }

  chartHex(h: Axial, delayMs: number, now: number) {
    const tile = tileAt(this.state, h);
    if (!tile) return;
    this.settles.push({ hex: h, sprite: this.spriteFor(h, tile), spriteS: this.S, t0: now + delayMs, stamped: false });
  }

  addFloater(h: Axial, text: string, opts: { color?: string; big?: boolean } = {}) {
    const c = this.center(h);
    const jitter = (Math.random() - 0.5) * 14;
    this.floaters.push({
      x: c.x + jitter, y: c.y - this.S * 0.6, text,
      color: opts.color ?? INK, t0: performance.now(), big: opts.big,
    });
  }

  /* ---------------- frame ---------------- */

  draw(now: number) {
    // recover once the real viewport size arrives (or on resize)
    if (this.lastVW !== window.innerWidth || this.lastVH !== window.innerHeight) this.layout();
    this.fitCamera();
    this.tweenCamera(now);

    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.cv.width, this.cv.height);
    g.drawImage(this.paper, 0, 0);

    if (!this.chartVeiled) {
      if (this.cameraAtStamp()) {
        g.drawImage(this.chart, 0, 0);
      } else {
        // mid-glide: blit the stamped chart scaled; re-stamp crisp once settled
        const sc = this.S / this.stampS;
        g.drawImage(
          this.chart,
          (this.OX - this.stampOX * sc) * this.DPR,
          (this.OY - this.stampOY * sc) * this.DPR,
          this.chart.width * sc,
          this.chart.height * sc
        );
        if (this.S === this.tS && this.OX === this.tOX && this.OY === this.tOY) this.buildChart();
      }
    }

    g.setTransform(this.DPR, 0, 0, this.DPR, 0, 0);
    if (!this.chartVeiled) {
      this.drawFrontier(g);
    }
    this.drawRumor(g);
    this.drawCairnRumors(g);
    this.drawSettles(g, now);
    this.drawGhostTrail(g);
    this.drawRidgeMark(g);
    this.drawTrail(g);
    this.drawStepDots(g);
    this.drawTutMark(g, now);
    this.drawTargets(g, now);
    this.drawHover(g);
    this.drawFires(g, now);
    this.drawPlayer(g, now);
    this.drawGhostWalk(g, now);
    this.drawWeather(g, now);
    this.drawFloaters(g, now);
    this.drawArrival(g, now);
  }

  /** the old ink: Nº 6's route, pale beneath the player's own wax-red line */
  private drawGhostTrail(g: CanvasRenderingContext2D) {
    if (!this.ghostTrail || this.chartVeiled) return;
    const age = this.state.day - this.ghostTrail.bornDay;
    if (age >= 3 || this.state.over) {
      this.ghostTrail = null; // the rain takes it
      return;
    }
    const pts = this.ghostTrail.path.map((h) => this.center(h));
    if (pts.length < 2) return;
    g.save();
    g.setLineDash([4, 6]);
    g.strokeStyle = `rgba(110,90,60,${0.4 - age * 0.11})`;
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
      g.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    g.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    g.stroke();
    g.restore();
  }

  /** the pencil ✕ on the ridge where E.V. stood */
  private drawRidgeMark(g: CanvasRenderingContext2D) {
    const h = this.state.ridgeHex;
    if (!h || this.chartVeiled || this.arrival || this.state.over) return;
    const c = this.center(h);
    const r = this.S * 0.3;
    g.save();
    g.strokeStyle = 'rgba(90,70,45,.55)';
    g.lineWidth = 1.8;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(c.x - r, c.y - r * 0.8); g.lineTo(c.x + r, c.y + r * 0.8);
    g.moveTo(c.x - r, c.y + r * 0.8); g.lineTo(c.x + r * 0.9, c.y - r);
    g.stroke();
    g.restore();
  }

  /** two shapes on the snow, climbing — the way paper takes ink, in reverse */
  private drawGhostWalk(g: CanvasRenderingContext2D, now: number) {
    if (!this.ghostWalk) return;
    const t = (now - this.ghostWalk.t0) / 5200;
    if (t >= 1) {
      this.ghostWalk = null;
      return;
    }
    const a = this.center(this.ghostWalk.from);
    const b = this.center(this.state.world.peak);
    const u = Math.min(1.6, Math.max(0.9, this.S / BASE)) * 0.85;
    for (let i = 0; i < 2; i++) {
      const p = Math.max(0, Math.min(1, t * 1.15 - i * 0.12));
      const e = 1 - Math.pow(1 - p, 2);
      const x = a.x + (b.x - a.x) * e + (i === 0 ? -4 : 5);
      const y = a.y + (b.y - a.y) * e + (i === 0 ? 1 : 3);
      const fade = Math.max(0, 0.5 * (1 - t * t) * (p > 0 ? 1 : 0));
      if (fade <= 0) continue;
      g.save();
      g.globalAlpha = fade;
      g.translate(x, y + Math.sin(now / 300 + i * 2) * 0.8);
      g.scale(u, u);
      g.strokeStyle = '#6b5a3e';
      g.fillStyle = '#6b5a3e';
      g.lineWidth = 1.8;
      g.lineCap = 'round';
      g.beginPath(); g.moveTo(0, 5); g.lineTo(0, -3); g.stroke();
      g.beginPath(); g.arc(0, -6, 3, 0, 7); g.fill();
      g.restore();
    }
  }

  /** the crossing: an inked ship draws its wake from the page edge to the landing */
  private drawArrival(g: CanvasRenderingContext2D, now: number) {
    if (!this.arrival) return;
    const t = (now - this.arrival.t0) / this.arrival.dur;
    if (t >= 1) {
      const cb = this.arrival.onDone;
      this.arrival = null;
      cb();
      return;
    }
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const dest = this.center(this.state.world.start);
    const sx = dest.x + 60;
    const sy = this.CH + 50;
    const x = sx + (dest.x - sx) * e;
    const y = sy + (dest.y + this.S * 0.4 - sy) * e;

    g.save();
    // the wake, dashed like a pencilled course
    g.setLineDash([5, 7]);
    g.strokeStyle = 'rgba(90,115,115,.5)';
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(sx, sy);
    g.quadraticCurveTo(sx, (sy + y) / 2, x, y);
    g.stroke();
    g.setLineDash([]);

    // the ship, small and certain
    const u = Math.min(1.6, Math.max(1, this.S / BASE));
    const bob = Math.sin(now / 260) * 1.5;
    g.translate(x, y + bob);
    g.scale(u, u);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = INK;
    g.fillStyle = '#efe3c6';
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(-9, -2);
    g.quadraticCurveTo(0, 5, 9, -2);
    g.lineTo(7, -3);
    g.lineTo(-7, -3);
    g.closePath();
    g.fill();
    g.stroke();
    g.beginPath(); g.moveTo(0, -3); g.lineTo(0, -16); g.stroke();
    g.beginPath();
    g.moveTo(0, -15);
    g.lineTo(8.5, -5);
    g.lineTo(0, -5);
    g.closePath();
    g.fill();
    g.stroke();
    g.strokeStyle = RED;
    g.fillStyle = RED;
    g.beginPath(); g.moveTo(0, -16); g.lineTo(4.5, -14.4); g.lineTo(0, -12.8); g.closePath(); g.fill();
    g.restore();
  }

  /** ambient weather over the page: wind wisps, rain, winter drift */
  private drawWeather(g: CanvasRenderingContext2D, now: number) {
    const w = this.CW, h = this.CH;
    const phase = this.state.weather;
    if (phase === 'winds' || this.state.windStrong > 0) {
      g.save();
      g.strokeStyle = 'rgba(90,80,60,.1)';
      g.lineWidth = 1.4;
      g.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const t = ((now / 7000 + i * 0.37) % 1);
        const x = t * (w + 300) - 150;
        const y = h * (0.2 + ((i * 0.31) % 0.55));
        g.beginPath();
        g.moveTo(x, y);
        g.bezierCurveTo(x + 40, y - 10, x + 80, y + 8, x + 130, y - 4);
        g.stroke();
      }
      g.restore();
    }
    if (phase === 'storm') {
      g.save();
      g.fillStyle = 'rgba(85,100,120,.07)';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(70,95,115,.28)';
      g.lineWidth = 1;
      const rnd = mulberry32(31);
      for (let i = 0; i < 70; i++) {
        const sx = rnd() * (w + 200) - 100;
        const sy = rnd() * h;
        const fall = ((now / 900 + rnd()) % 1);
        const x = sx + fall * 60, y = (sy + fall * h * 0.9) % h;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x - 5, y + 13);
        g.stroke();
      }
      g.restore();
    }
    if (phase === 'winter') {
      g.save();
      g.fillStyle = 'rgba(195,210,230,.09)';
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,.55)';
      const rnd = mulberry32(57);
      for (let i = 0; i < 40; i++) {
        const sx = rnd() * w;
        const sp = 0.4 + rnd() * 0.6;
        const fall = ((now / 14000) * sp + rnd()) % 1;
        const x = sx + Math.sin(now / 1700 + i) * 14;
        const y = fall * (h + 20) - 10;
        g.beginPath();
        g.arc(x, y, 1 + rnd(), 0, 7);
        g.fill();
      }
      g.restore();
    }
  }

  private drawFrontier(g: CanvasRenderingContext2D) {
    const s = this.state;
    g.save();
    g.setLineDash([4, 5]);
    g.lineWidth = 1;
    for (const [k, t] of s.world.tiles) {
      if (t.charted) continue;
      const [q, r] = k.split(',').map(Number);
      const isFrontier = neighbors({ q, r }).some((n) => {
        const nt = s.world.tiles.get(key(n.q, n.r));
        return nt?.charted;
      });
      if (!isFrontier) continue;
      const c = this.center({ q, r });
      g.strokeStyle = 'rgba(90,70,45,.15)';
      const pts = corners(c.x, c.y, this.S, 2.5);
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < 6; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.closePath();
      g.stroke();
    }
    g.restore();
  }

  /** faint sketch of the far peak until it is charted; clamps to the page edge when out of view */
  private drawRumor(g: CanvasRenderingContext2D) {
    const s = this.state;
    const peakTile = tileAt(s, s.world.peak);
    if (peakTile?.charted) return;
    const c = this.center(s.world.peak);
    const S = Math.min(26, this.S);
    const x0 = 70, x1 = this.CW - 70, y0 = 96, y1 = this.CH - 240;
    const off = c.x < x0 || c.x > x1 || c.y < y0 || c.y > y1;
    const cx = Math.max(x0, Math.min(x1, c.x));
    const cy = Math.max(y0, Math.min(y1, c.y));

    g.save();
    g.strokeStyle = 'rgba(90,70,45,.3)';
    g.lineWidth = 1.4;
    g.lineCap = 'round';
    g.setLineDash([3, 4]);
    const k = off ? 0.62 : 1;
    g.beginPath();
    g.moveTo(cx - S * 1.7 * k, cy + S * 0.9 * k);
    g.lineTo(cx - S * 0.5 * k, cy - S * 0.9 * k);
    g.lineTo(cx, cy - S * 0.1 * k);
    g.lineTo(cx + S * 0.5 * k, cy - S * 1.1 * k);
    g.lineTo(cx + S * 1.6 * k, cy + S * 0.9 * k);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = 'rgba(90,70,45,.42)';
    g.font = `italic ${Math.max(11, Math.min(14.5, Math.round(S * 0.44)))}px "Iowan Old Style",Palatino,serif`;
    g.textAlign = 'center';
    g.fillText(off ? 'the beacon waits, beyond' : 'the beacon waits', cx, cy + S * 1.35 * k + 8);
    if (off) {
      // a small ink chevron pointing the way
      const dx = c.x - cx, dy = c.y - cy;
      const L = Math.hypot(dx, dy) || 1;
      const ux = dx / L, uy = dy / L;
      const ax = cx + ux * S * 2, ay = cy + uy * S * 2;
      g.strokeStyle = 'rgba(140,47,34,.55)';
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(ax - ux * 10 - uy * 5, ay - uy * 10 + ux * 5);
      g.lineTo(ax, ay);
      g.lineTo(ax - ux * 10 + uy * 5, ay - uy * 10 - ux * 5);
      g.stroke();
    }
    g.restore();
  }

  /**
   * Nº 6's ledger marks one cairn from day one; surveying your first cairn
   * pencils in the rest as rumours.
   */
  private drawCairnRumors(g: CanvasRenderingContext2D) {
    const s = this.state;
    if (s.over) return;
    const x0 = 70, x1 = this.CW - 70, y0 = 96, y1 = this.CH - 240;
    g.save();
    g.strokeStyle = 'rgba(90,70,45,.42)';
    g.lineWidth = 1.2;
    for (const c of s.world.cairns) {
      const tile = tileAt(s, c);
      if (!tile || tile.charted) continue; // charted cairns draw their real stones
      const ledgerMarked = s.ledgerCairn && c.q === s.ledgerCairn.q && c.r === s.ledgerCairn.r;
      if (s.cairnsFound === 0 && !ledgerMarked) continue;
      const p = this.center(c);
      const off = p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1;
      const cx = Math.max(x0, Math.min(x1, p.x));
      const cy = Math.max(y0, Math.min(y1, p.y));
      const k = (Math.min(26, this.S) / BASE) * (off ? 0.7 : 1);
      g.setLineDash([3, 3.5]);
      g.beginPath(); g.ellipse(cx, cy + 4 * k, 6 * k, 2.6 * k, 0, 0, 7); g.stroke();
      g.beginPath(); g.ellipse(cx, cy, 4.6 * k, 2.2 * k, 0, 0, 7); g.stroke();
      g.beginPath(); g.ellipse(cx, cy - 3.4 * k, 3 * k, 1.8 * k, 0, 0, 7); g.stroke();
      if (off) {
        // a small chevron pointing off the page toward the rumour
        const dx = p.x - cx, dy = p.y - cy;
        const L = Math.hypot(dx, dy) || 1;
        const ux = dx / L, uy = dy / L;
        const ax = cx + ux * 15, ay = cy + uy * 15;
        g.setLineDash([]);
        g.beginPath();
        g.moveTo(ax - ux * 6 - uy * 3.5, ay - uy * 6 + ux * 3.5);
        g.lineTo(ax, ay);
        g.lineTo(ax - ux * 6 + uy * 3.5, ay - uy * 6 - ux * 3.5);
        g.stroke();
      }
    }
    g.restore();
  }

  private drawSettles(g: CanvasRenderingContext2D, now: number) {
    const chartG = this.chart.getContext('2d')!;
    for (const st of this.settles) {
      if (st.stamped) continue;
      const t = (now - st.t0) / 420;
      if (t < 0) continue;
      if (t >= 1) {
        // stamp into the chart layer in its own (stamp-camera) space
        const p = toPixel(st.hex, this.stampS);
        const box = (st.sprite.width / this.DPR) * (this.stampS / st.spriteS);
        chartG.setTransform(this.DPR, 0, 0, this.DPR, 0, 0);
        chartG.drawImage(st.sprite, p.x + this.stampOX - box / 2, p.y + this.stampOY - box / 2, box, box);
        st.stamped = true;
        continue;
      }
      const c = this.center(st.hex);
      const box = (st.sprite.width / this.DPR) * (this.S / st.spriteS);
      const ease = 1 - Math.pow(1 - t, 3);
      const sc = 1.06 - 0.06 * ease;
      g.save();
      g.globalAlpha = ease;
      g.drawImage(st.sprite, c.x - (box * sc) / 2, c.y - (box * sc) / 2, box * sc, box * sc);
      g.restore();
    }
    if (this.settles.length > 120) this.settles = this.settles.filter((x) => !x.stamped);
  }

  private drawTrail(g: CanvasRenderingContext2D) {
    const s = this.state;
    if (s.trail.length < 2) return;
    g.save();
    g.setLineDash([6, 7]);
    g.strokeStyle = 'rgba(140,47,34,.6)';
    g.lineWidth = 2;
    g.beginPath();
    const pts = s.trail.map((h) => this.center(h));
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
      g.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    g.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    g.stroke();
    g.restore();
  }

  /** faint pencil dots on every hex you could step to right now */
  private drawStepDots(g: CanvasRenderingContext2D) {
    const s = this.state;
    if (s.over || this.targets.length > 0 || this.arrival || this.chartVeiled) return;
    const r = Math.max(1.7, this.S * 0.085);
    g.save();
    for (const n of neighbors(s.player)) {
      const tile = tileAt(s, n);
      const cost = moveCostNow(s, tile);
      if (cost === null) continue;
      const affordable = s.freeSteps > 0 || cost <= s.supplies;
      const c = this.center(n);
      g.fillStyle = affordable ? 'rgba(90,70,45,.4)' : 'rgba(140,47,34,.4)';
      g.beginPath();
      g.arc(c.x, c.y, r, 0, 7);
      g.fill();
    }
    g.restore();
  }

  /** the primer's pointer: a breathing pencil ring around the suggested hex */
  private drawTutMark(g: CanvasRenderingContext2D, now: number) {
    if (!this.tutHex || this.chartVeiled || this.arrival || this.state.over) return;
    if (this.targets.length > 0) return; // a selected card outranks the primer
    const c = this.center(this.tutHex);
    const pulse = 0.5 + Math.sin(now / 320) * 0.5;
    g.save();
    g.setLineDash([4, 4]);
    g.lineWidth = 2;
    g.strokeStyle = `rgba(74,56,38,${0.35 + 0.4 * pulse})`;
    g.beginPath();
    g.arc(c.x, c.y, this.S * (0.56 + 0.05 * pulse), 0, 7);
    g.stroke();
    g.restore();
  }

  private drawTargets(g: CanvasRenderingContext2D, now: number) {
    if (this.targets.length === 0) return;
    const pulse = 0.75 + Math.sin(now / 260) * 0.25;
    g.save();
    for (const h of this.targets) {
      const c = this.center(h);
      const pts = corners(c.x, c.y, this.S, 3);
      g.setLineDash([5, 4]);
      g.lineWidth = 2;
      g.strokeStyle = `rgba(140,47,34,${0.75 * pulse})`;
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < 6; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.closePath();
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 0.12 * pulse;
      g.fillStyle = RED;
      g.fill();
      g.globalAlpha = 1;
    }
    g.restore();
  }

  /** route preview cache — Dijkstra is cheap, but not every-frame cheap */
  private pathKey = '';
  private pathRes: { path: Axial[]; cost: number } | null = null;

  private routeTo(h: Axial): { path: Axial[]; cost: number } | null {
    const s = this.state;
    const k = `${h.q},${h.r}|${s.player.q},${s.player.r}|${s.day}|${s.freeSteps}`;
    if (this.pathKey !== k) {
      this.pathKey = k;
      this.pathRes = findPath(s, h);
    }
    return this.pathRes;
  }

  private drawHover(g: CanvasRenderingContext2D) {
    const s = this.state;
    if (!this.hover || s.over || this.chartVeiled) return;
    const h = this.hover;
    const tile = tileAt(s, h);
    if (!tile) return;
    if (this.targets.length > 0) return;
    if (h.q === s.player.q && h.r === s.player.r) return;
    const isNeighbor = distance(h, s.player) === 1;
    const cost = moveCostNow(s, tile);
    const c = this.center(h);
    const label = (text: string, warn: boolean) => {
      g.font = `italic ${Math.max(11, Math.min(15, Math.round(this.S * 0.42)))}px Palatino,serif`;
      g.textAlign = 'center';
      g.fillStyle = warn ? 'rgba(140,47,34,.8)' : 'rgba(74,56,38,.85)';
      g.fillText(text, c.x, c.y - this.S * 0.95);
    };
    const outline = (warn: boolean) => {
      const pts = corners(c.x, c.y, this.S, 2);
      g.lineWidth = 1.6;
      g.strokeStyle = warn ? 'rgba(140,47,34,.55)' : 'rgba(74,56,38,.65)';
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < 6; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.closePath();
      g.stroke();
    };
    g.save();

    if (isNeighbor) {
      outline(cost === null);
      if (cost === null) {
        label(`${tileName(tile)} · ${tile.burning ? 'aflame' : tile.flooded ? 'flooded' : 'no way through'}`, true);
      } else {
        const paid = s.freeSteps > 0 ? 0 : cost;
        label(`${tileName(tile)} · ${paid === 0 ? 'free' : `−${paid}`}`, false);
      }
      g.restore();
      return;
    }

    // distant hex: preview the pencil route the cartographer would take
    if (!tile.charted) { g.restore(); return; } // the frontier keeps its own counsel
    const route = this.routeTo(h);
    if (!route) {
      outline(true);
      label(`${tileName(tile)} · ${tile.burning ? 'aflame' : tile.flooded ? 'flooded' : 'no way through'}`, true);
      g.restore();
      return;
    }
    g.setLineDash([3, 5]);
    g.lineWidth = 1.5;
    g.strokeStyle = 'rgba(90,70,45,.5)';
    g.beginPath();
    const start = this.center(s.player);
    g.moveTo(start.x, start.y);
    for (const step of route.path) {
      const p = this.center(step);
      g.lineTo(p.x, p.y);
    }
    g.stroke();
    g.setLineDash([]);
    outline(false);
    const paid = pathSupplyCost(s, route.path);
    const days = route.path.length;
    label(`${tileName(tile)} · ${paid === 0 ? 'free' : `−${paid}`} · ${days} day${days > 1 ? 's' : ''}`, false);
    g.restore();
  }

  private drawFires(g: CanvasRenderingContext2D, now: number) {
    const s = this.state;
    const S = this.S;
    const u = S / BASE;
    for (const [k, t] of s.world.tiles) {
      if (!t.burning || !t.charted) continue;
      const [q, r] = k.split(',').map(Number);
      const { x, y } = this.center({ q, r });
      const fl = 0.85 + Math.sin(now / 130 + q) * 0.15;
      const gr = g.createRadialGradient(x, y, 2, x, y, S * 1.25 * fl);
      gr.addColorStop(0, 'rgba(255,196,80,.85)');
      gr.addColorStop(0.45, 'rgba(235,120,40,.45)');
      gr.addColorStop(1, 'rgba(200,80,30,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, S * 1.3, 0, 7);
      g.fill();

      g.save();
      g.translate(x, y);
      g.scale(u, u);
      g.strokeStyle = 'rgba(140,50,20,.85)';
      g.lineWidth = 1.6;
      g.lineCap = 'round';
      const h2 = BASE * 0.55 * fl;
      g.beginPath();
      g.moveTo(-5, 6);
      g.quadraticCurveTo(-7, -h2 * 0.4, 0, -h2);
      g.quadraticCurveTo(7, -h2 * 0.4, 5, 6);
      g.stroke();

      g.strokeStyle = 'rgba(90,80,70,.4)';
      g.lineWidth = 1.4;
      const sw = Math.sin(now / 900 + q) * 4;
      g.beginPath();
      g.moveTo(0, -h2 - 2);
      g.bezierCurveTo(-6 + sw, -h2 - 14, 8 + sw, -h2 - 20, 2 + sw * 1.5, -h2 - 32);
      g.stroke();

      const rnd = hashRng(q, r, 99);
      for (let i = 0; i < 5; i++) {
        const ph = (now / 1400 + rnd()) % 1;
        g.globalAlpha = (1 - ph) * 0.8;
        g.fillStyle = '#e8863c';
        g.beginPath();
        g.arc((rnd() - 0.5) * BASE + Math.sin(now / 300 + i) * 3, -ph * BASE * 1.6, 1.5, 0, 7);
        g.fill();
      }
      g.restore();
    }

    if (this.beaconLit) {
      const { x, y } = this.center(s.world.peak);
      const fl = 0.85 + Math.sin(now / 160) * 0.15;
      const gr = g.createRadialGradient(x, y - S * 0.4, 3, x, y - S * 0.4, S * 2.6 * fl);
      gr.addColorStop(0, 'rgba(255,214,110,.95)');
      gr.addColorStop(0.4, 'rgba(240,140,50,.4)');
      gr.addColorStop(1, 'rgba(220,100,40,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y - S * 0.4, S * 2.7, 0, 7);
      g.fill();
      g.save();
      g.translate(x, y);
      g.scale(u, u);
      g.strokeStyle = 'rgba(140,50,20,.9)';
      g.lineWidth = 2;
      g.lineCap = 'round';
      const h2 = BASE * 1.1 * fl;
      g.beginPath();
      g.moveTo(-6, 2);
      g.quadraticCurveTo(-9, -h2 * 0.4, 0, -h2);
      g.quadraticCurveTo(9, -h2 * 0.4, 6, 2);
      g.stroke();
      const rnd = hashRng(1, 2, 77);
      for (let i = 0; i < 9; i++) {
        const ph = (now / 1600 + rnd()) % 1;
        g.globalAlpha = (1 - ph) * 0.9;
        g.fillStyle = '#f0a24c';
        g.beginPath();
        g.arc((rnd() - 0.5) * BASE * 1.4 + Math.sin(now / 260 + i) * 4, -BASE * 0.3 - ph * BASE * 2.6, 1.8, 0, 7);
        g.fill();
      }
      // the journal whole: a second, smaller flame — theirs, at last
      if (this.twinFlame) {
        g.globalAlpha = 1;
        g.strokeStyle = 'rgba(140,50,20,.75)';
        g.lineWidth = 1.5;
        const h3 = BASE * 0.6 * (0.85 + Math.sin(now / 210 + 2) * 0.15);
        g.beginPath();
        g.moveTo(8, 4);
        g.quadraticCurveTo(6, -h3 * 0.4, 12, -h3);
        g.quadraticCurveTo(17, -h3 * 0.4, 16, 4);
        g.stroke();
      }
      g.restore();
    }
  }

  private drawPlayer(g: CanvasRenderingContext2D, now: number) {
    if (this.arrival || this.chartVeiled) return; // still aboard
    const s = this.state;
    let { x, y } = this.center(s.player);
    if (this.moveAnim) {
      const t = (now - this.moveAnim.t0) / 220;
      if (t >= 1) {
        this.moveAnim = null;
      } else {
        const a = this.center(this.moveAnim.from);
        const b = this.center(this.moveAnim.to);
        const e = 1 - Math.pow(1 - t, 2);
        x = a.x + (b.x - a.x) * e;
        y = a.y + (b.y - a.y) * e - Math.sin(Math.PI * t) * this.S * 0.14; // a small step's arc
      }
    }
    const u = Math.min(1.9, Math.max(0.9, this.S / BASE));
    g.save();
    g.translate(x, y);
    g.scale(u, u);
    g.fillStyle = 'rgba(50,35,18,.25)';
    g.beginPath();
    g.ellipse(0, 7, 7, 2.6, 0, 0, 7);
    g.fill();
    g.strokeStyle = '#3c2c18';
    g.lineWidth = 2;
    g.lineCap = 'round';
    g.beginPath(); g.moveTo(0, 6); g.lineTo(0, -3); g.stroke();
    g.beginPath(); g.arc(0, -7, 3.6, 0, 7);
    g.fillStyle = '#3c2c18';
    g.fill();
    const sw = Math.sin(now / 450) * 2;
    g.strokeStyle = '#a13023';
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(1, -4);
    g.quadraticCurveTo(7, -6 + sw, 12, -3 + sw * 1.4);
    g.stroke();
    g.restore();
  }

  private drawFloaters(g: CanvasRenderingContext2D, now: number) {
    g.save();
    g.textAlign = 'center';
    this.floaters = this.floaters.filter((f) => now - f.t0 < 1500);
    const size = Math.min(19, Math.max(11, this.S * 0.5));
    for (const f of this.floaters) {
      const t = (now - f.t0) / 1500;
      const ease = 1 - Math.pow(1 - t, 2);
      g.globalAlpha = t < 0.15 ? t / 0.15 : 1 - ease * 0.9;
      g.fillStyle = f.color;
      g.font = `${f.big ? '700 ' : 'italic '}${Math.round(f.big ? size * 1.3 : size)}px "Iowan Old Style",Palatino,serif`;
      g.fillText(f.text, f.x, f.y - ease * 38);
    }
    g.restore();
  }
}
