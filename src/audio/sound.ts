/**
 * All sound is synthesized — no audio assets, in keeping with the game's
 * generative-ink aesthetic. Quiet, papery, organic. Everything runs through
 * a procedurally generated reverb so it sits in a space.
 */
import { mulberry32 } from '../core/rng';
import type { RunState, Terrain } from '../game/types';

const MUTE_KEY = 'fieldnotes.muted.v1';

interface BurstOpts {
  t?: number; dur: number; type?: BiquadFilterType;
  f0: number; f1?: number; q?: number; g: number; a?: number; rev?: number;
}
interface ToneOpts {
  t?: number; f0: number; f1?: number; dur: number;
  type?: OscillatorType; g: number; a?: number; rev?: number;
}

/** A-minor pentatonic, journal register */
const SCALE = [220, 261.6, 293.7, 329.6, 392, 440, 523.3];

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private dry!: GainNode;
  private wetIn!: GainNode;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private rainGain!: GainNode;
  private muted = false;
  private nextPluck = 0;
  private nextGull = 0;
  private nextCrackle = 0;
  private nextRainPop = 0;
  private rnd = mulberry32((Math.random() * 1e9) | 0);
  onMuteChange: (muted: boolean) => void = () => {};

  constructor() {
    try { this.muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* ignore */ }
  }

  get isMuted() { return this.muted; }

  /** Call on a user gesture; safe to call repeatedly. */
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.buildGraph();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch { /* ignore */ }
    if (this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.08);
    }
    this.onMuteChange(m);
  }

  /* ---------------- graph ---------------- */

  private buildGraph() {
    const ctx = this.ctx!;
    const cmp = ctx.createDynamicsCompressor();
    cmp.threshold.value = -20;
    cmp.ratio.value = 5;
    cmp.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    this.master.connect(cmp);

    this.dry = ctx.createGain();
    this.dry.gain.value = 0.9;
    this.dry.connect(this.master);

    // generated impulse-response reverb
    const conv = ctx.createConvolver();
    conv.buffer = this.makeImpulse(2.4);
    const wetOut = ctx.createGain();
    wetOut.gain.value = 0.4;
    this.wetIn = ctx.createGain();
    this.wetIn.connect(conv);
    conv.connect(wetOut);
    wetOut.connect(this.master);

    // shared noise source material
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.startWind();
    this.startRain();
    this.startDrone();
  }

  private startRain() {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.9;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    src.connect(lp).connect(this.rainGain);
    this.rainGain.connect(this.dry);
    const w = ctx.createGain();
    w.gain.value = 0.3;
    this.rainGain.connect(w).connect(this.wetIn);
    src.start();
  }

  private makeImpulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.2) * Math.exp(-3 * t);
      }
    }
    return buf;
  }

  /* ---------------- voices ---------------- */

  private burst(o: BurstOpts) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + (o.t ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.7 + this.rnd() * 0.6;
    const f = ctx.createBiquadFilter();
    f.type = o.type ?? 'bandpass';
    f.frequency.setValueAtTime(o.f0, t0);
    if (o.f1 !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.f1), t0 + o.dur);
    f.Q.value = o.q ?? 1;
    const g = ctx.createGain();
    const a = o.a ?? 0.006;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.g, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(f).connect(g);
    g.connect(this.dry);
    if (o.rev) {
      const w = ctx.createGain();
      w.gain.value = o.rev;
      g.connect(w).connect(this.wetIn);
    }
    src.start(t0);
    src.stop(t0 + o.dur + 0.05);
  }

  private tone(o: ToneOpts) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + (o.t ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.f0, t0);
    if (o.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(30, o.f1), t0 + o.dur);
    const g = ctx.createGain();
    const a = o.a ?? 0.005;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.g, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(g);
    g.connect(this.dry);
    if (o.rev) {
      const w = ctx.createGain();
      w.gain.value = o.rev;
      g.connect(w).connect(this.wetIn);
    }
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.05);
  }

  /** soft struck bell: fundamental + inharmonic partials */
  private bell(freq: number, t: number, g: number) {
    this.tone({ t, f0: freq, dur: 1.4, g, a: 0.004, rev: 0.8 });
    this.tone({ t, f0: freq * 2.71, dur: 0.9, g: g * 0.22, a: 0.004, rev: 0.8 });
    this.tone({ t, f0: freq * 5.4, dur: 0.5, g: g * 0.08, a: 0.004, rev: 0.6 });
  }

  private crackles(n: number, over: number, t = 0, g = 0.045) {
    for (let i = 0; i < n; i++) {
      this.burst({
        t: t + this.rnd() * over,
        dur: 0.012 + this.rnd() * 0.03,
        type: 'highpass',
        f0: 1200 + this.rnd() * 2600,
        g: g * (0.5 + this.rnd() * 0.5),
        a: 0.001,
      });
    }
  }

  /* ---------------- ambients ---------------- */

  private startWind() {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 340;
    this.windFilter.Q.value = 0.55;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.018;
    src.connect(this.windFilter).connect(this.windGain);
    this.windGain.connect(this.dry);
    const w = ctx.createGain();
    w.gain.value = 0.5;
    this.windGain.connect(w).connect(this.wetIn);
    // slow breathing of the filter and level
    const lfo1 = ctx.createOscillator();
    lfo1.frequency.value = 0.06;
    const l1g = ctx.createGain();
    l1g.gain.value = 110;
    lfo1.connect(l1g).connect(this.windFilter.frequency);
    lfo1.start();
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.041;
    const l2g = ctx.createGain();
    l2g.gain.value = 0.007;
    lfo2.connect(l2g).connect(this.windGain.gain);
    lfo2.start();
    src.start();
  }

  private startDrone() {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = 0.011;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    lp.connect(g);
    g.connect(this.dry);
    const w = ctx.createGain();
    w.gain.value = 0.7;
    g.connect(w).connect(this.wetIn);
    for (const [f, det] of [[110, -2.5], [110, 2.5], [165, 0]] as [number, number][]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(lp);
      o.start();
    }
  }

  /**
   * Called every frame from the game loop: breathes the ambience
   * (gust level, fire crackle, sparse plucks, the odd gull).
   */
  tick(s: RunState) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;

    // ambience follows the weather (and gusts)
    let windT = 0.018, windF = 340, rainT = 0;
    switch (s.weather) {
      case 'winds': windT = 0.042; windF = 470; break;
      case 'storm': windT = 0.07; windF = 540; rainT = 0.05; break;
      case 'clearing': windT = 0.02; windF = 360; break;
      case 'winter': windT = 0.032; windF = 720; break;
    }
    if (s.windStrong > 0) { windT = Math.max(windT, 0.055); windF = Math.max(windF, 620); }
    this.windGain.gain.setTargetAtTime(windT, now, 0.6);
    this.windFilter.frequency.setTargetAtTime(windF, now, 0.8);
    this.rainGain.gain.setTargetAtTime(rainT, now, 0.9);

    // rain patter during the storm
    if (s.weather === 'storm') {
      if (this.nextRainPop < now) this.nextRainPop = now;
      while (this.nextRainPop < now + 0.3) {
        this.burst({
          t: this.nextRainPop - now,
          dur: 0.015 + this.rnd() * 0.02,
          type: 'lowpass',
          f0: 700 + this.rnd() * 900,
          g: 0.013 * (0.5 + this.rnd() * 0.5),
          a: 0.001,
        });
        this.nextRainPop += 0.05 + this.rnd() * 0.12;
      }
    }

    // fire crackle: schedule pops a little ahead
    let fires = 0;
    for (const t of s.world.tiles.values()) if (t.burning && t.charted) fires++;
    if (fires > 0) {
      if (this.nextCrackle < now) this.nextCrackle = now;
      const level = Math.min(1, fires * 0.35);
      while (this.nextCrackle < now + 0.35) {
        this.burst({
          t: this.nextCrackle - now,
          dur: 0.014 + this.rnd() * 0.035,
          type: 'highpass',
          f0: 1000 + this.rnd() * 2800,
          g: 0.03 * level * (0.4 + this.rnd() * 0.6),
          a: 0.001,
        });
        this.nextCrackle += 0.04 + this.rnd() * 0.3 / (0.4 + level);
      }
    }

    // sparse pentatonic plucks — the island's quiet music (rarer in winter)
    if (this.nextPluck === 0) this.nextPluck = now + 4 + this.rnd() * 6;
    if (now >= this.nextPluck && !s.over) {
      const f = SCALE[Math.floor(this.rnd() * SCALE.length)];
      this.tone({ f0: f, dur: 1.6, type: 'triangle', g: 0.02, a: 0.004, rev: 0.9 });
      this.nextPluck = now + (9 + this.rnd() * 16) * (s.weather === 'winter' ? 1.7 : 1);
    }

    // a distant gull, rarely
    if (this.nextGull === 0) this.nextGull = now + 10 + this.rnd() * 15;
    if (now >= this.nextGull) {
      this.gull();
      this.nextGull = now + 20 + this.rnd() * 35;
    }
  }

  private gull() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const f = 1000 + this.rnd() * 250;
    osc.frequency.setValueAtTime(f, t0);
    osc.frequency.linearRampToValueAtTime(f * 1.35, t0 + 0.12);
    osc.frequency.linearRampToValueAtTime(f * 0.8, t0 + 0.34);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.011, t0 + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.38);
    osc.connect(g);
    const w = ctx.createGain();
    w.gain.value = 0.9;
    g.connect(w).connect(this.wetIn);
    osc.start(t0);
    osc.stop(t0 + 0.45);
  }

  /* ---------------- event sounds ---------------- */

  /** pen scratch as a hex inks itself in */
  inkIn(delayMs: number) {
    const t = delayMs / 1000;
    this.burst({
      t, dur: 0.08 + this.rnd() * 0.05,
      f0: 1500 + this.rnd() * 900, f1: 2400 + this.rnd() * 900,
      q: 1.1, g: 0.038, rev: 0.15,
    });
  }

  step(terrain: Terrain | undefined, onIce: boolean) {
    this.tone({ f0: 95, f1: 68, dur: 0.09, g: 0.045 });
    if (onIce) {
      this.burst({ dur: 0.06, type: 'lowpass', f0: 900, f1: 400, g: 0.035 });
      this.tone({ f0: 1750 + this.rnd() * 400, dur: 0.25, g: 0.007, rev: 0.7 });
      return;
    }
    switch (terrain) {
      case 'beach':
        this.burst({ dur: 0.07, type: 'lowpass', f0: 420, f1: 220, g: 0.032 });
        break;
      case 'forest':
        this.burst({ dur: 0.05, type: 'lowpass', f0: 500, f1: 280, g: 0.035 });
        this.burst({ t: 0.02, dur: 0.1, f0: 2300, f1: 1600, g: 0.014 });
        break;
      case 'snow':
        this.burst({ dur: 0.05, type: 'lowpass', f0: 800, f1: 350, g: 0.035 });
        this.burst({ t: 0.045, dur: 0.045, type: 'lowpass', f0: 700, f1: 300, g: 0.025 });
        break;
      case 'shallow':
        this.burst({ dur: 0.12, f0: 700, f1: 380, g: 0.035 });
        this.tone({ f0: 520, f1: 300, dur: 0.08, g: 0.014 });
        break;
      default:
        this.burst({ dur: 0.055, type: 'lowpass', f0: 480, f1: 260, g: 0.033 });
    }
  }

  cardSelect() {
    this.burst({ dur: 0.11, f0: 750, f1: 2200, q: 0.8, g: 0.028 });
  }

  drawCard(i = 0) {
    this.burst({ t: i * 0.12, dur: 0.1, f0: 1900, f1: 950, q: 0.8, g: 0.024 });
  }

  cardPlay(id: string) {
    this.burst({ dur: 0.05, f0: 1200, f1: 800, g: 0.04 });
    switch (id) {
      case 'ember':
        this.burst({ t: 0.04, dur: 0.45, type: 'lowpass', f0: 250, f1: 1300, g: 0.08, a: 0.06 });
        this.crackles(6, 0.5, 0.12);
        this.tone({ t: 0.05, f0: 58, f1: 42, dur: 0.5, g: 0.035, a: 0.03 });
        break;
      case 'gust':
        this.burst({ t: 0.02, dur: 0.9, f0: 320, f1: 850, q: 0.7, g: 0.075, a: 0.28, rev: 0.4 });
        break;
      case 'frost':
        for (let i = 0; i < 5; i++) {
          this.tone({
            t: 0.03 + i * 0.045,
            f0: 1250 * Math.pow(2, this.rnd() * 1.15),
            dur: 0.4 + this.rnd() * 0.5,
            g: 0.016, a: 0.003, rev: 0.7,
          });
        }
        this.crackles(2, 0.2, 0.05, 0.02);
        break;
      case 'vine':
        for (let i = 0; i < 3; i++) {
          this.burst({ t: 0.03 + i * 0.07, dur: 0.09, f0: 2200 + this.rnd() * 1500, g: 0.026 });
        }
        this.tone({ t: 0.26, f0: 150, f1: 110, dur: 0.12, g: 0.035 });
        break;
      case 'stone':
        this.tone({ t: 0.02, f0: 130, f1: 95, dur: 0.12, g: 0.06 });
        this.burst({ t: 0.02, dur: 0.08, type: 'lowpass', f0: 420, f1: 200, g: 0.045 });
        this.tone({ t: 0.13, f0: 110, f1: 85, dur: 0.1, g: 0.035 });
        break;
      case 'survey':
        for (let i = 0; i < 3; i++) {
          this.burst({
            t: i * 0.16, dur: 0.13,
            f0: 1600 + this.rnd() * 700, f1: 2500 + this.rnd() * 700,
            q: 1.1, g: 0.04,
          });
        }
        break;
      case 'stride':
        this.step('grass', false);
        this.tone({ t: 0.16, f0: 95, f1: 68, dur: 0.09, g: 0.045 });
        break;
    }
  }

  discovery() {
    this.burst({ dur: 0.25, f0: 1300, f1: 700, g: 0.02 });
    this.bell(392, 0.05, 0.045);
    this.bell(523.3, 0.32, 0.038);
  }

  cairn() {
    this.tone({ f0: 240, f1: 210, dur: 0.15, g: 0.04 });
    this.tone({ t: 0.09, f0: 360, f1: 330, dur: 0.15, g: 0.03 });
    this.bell(659.3, 0.24, 0.03);
  }

  chain(n: number) {
    this.crackles(Math.min(10, 3 + n), 0.55, 0, 0.055);
    this.burst({ dur: 0.6, type: 'lowpass', f0: 300, f1: 1100, g: 0.06, a: 0.15, rev: 0.3 });
  }

  ignite(i = 0) {
    this.burst({ t: Math.min(i, 5) * 0.06, dur: 0.25, type: 'lowpass', f0: 300, f1: 950, g: 0.04, a: 0.03 });
  }

  burnout() {
    this.burst({ dur: 0.3, type: 'lowpass', f0: 480, f1: 140, g: 0.03, a: 0.02 });
  }

  freeze() {
    for (let i = 0; i < 4; i++) {
      this.tone({
        t: i * 0.05, f0: 1400 * Math.pow(2, this.rnd()),
        dur: 0.35 + this.rnd() * 0.4, g: 0.014, a: 0.003, rev: 0.7,
      });
    }
  }

  melt() {
    this.tone({ f0: 700, f1: 300, dur: 0.1, g: 0.025 });
    this.burst({ t: 0.02, dur: 0.12, f0: 800, f1: 420, g: 0.02 });
  }

  beacon() {
    this.tone({ f0: 49, dur: 2.6, g: 0.06, a: 0.5, rev: 0.5 });
    this.burst({ dur: 1.2, type: 'lowpass', f0: 200, f1: 1700, g: 0.09, a: 0.35, rev: 0.5 });
    this.crackles(12, 1.2, 0.3, 0.04);
    this.bell(440, 0.6, 0.045);
    this.bell(523.3, 1.0, 0.04);
    this.bell(659.3, 1.5, 0.045);
  }

  pageClose() {
    this.tone({ f0: 82, f1: 60, dur: 0.22, g: 0.05 });
    this.burst({ t: 0.06, dur: 0.35, f0: 900, f1: 300, g: 0.035 });
    this.bell(220, 0.35, 0.025);
  }

  weatherChange(phase: string) {
    switch (phase) {
      case 'winds':
        this.burst({ dur: 1.3, f0: 300, f1: 820, q: 0.7, g: 0.05, a: 0.4, rev: 0.4 });
        break;
      case 'storm':
        this.tone({ f0: 42, f1: 30, dur: 2.2, g: 0.05, a: 0.15, rev: 0.6 });
        this.burst({ dur: 1.8, type: 'lowpass', f0: 420, f1: 90, g: 0.08, a: 0.08, rev: 0.6 });
        break;
      case 'clearing':
        this.tone({ f0: 587.3, dur: 1.3, type: 'triangle', g: 0.02, a: 0.004, rev: 0.9 });
        break;
      case 'winter':
        for (let i = 0; i < 5; i++) {
          this.tone({
            t: i * 0.12, f0: 2200 * Math.pow(0.82, i),
            dur: 0.6 + this.rnd() * 0.5, g: 0.014, a: 0.004, rev: 0.8,
          });
        }
        this.tone({ t: 0.3, f0: 82, dur: 2, g: 0.02, a: 0.4, rev: 0.6 });
        break;
    }
  }

  seal() {
    this.bell(659.3, 0, 0.04);
  }

  clauseFail() {
    this.tone({ f0: 130, f1: 85, dur: 0.4, g: 0.03 });
    this.burst({ t: 0.05, dur: 0.3, type: 'lowpass', f0: 300, f1: 150, g: 0.02 });
  }
}

export const sound = new SoundEngine();
