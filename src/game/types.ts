import type { Axial } from '../core/hex';

export type Terrain =
  | 'ocean' | 'shallow' | 'beach' | 'grass' | 'forest' | 'ash' | 'meadow'
  | 'river' | 'cliff' | 'highland' | 'snow' | 'peak';

export type WeatherPhase = 'calm' | 'winds' | 'storm' | 'clearing' | 'winter';

export interface WeatherSched {
  windsAt: number;
  stormAt: number;   // storm lasts stormAt..stormAt+2
  winterAt: number;
}

export interface WindChange { day: number; dir: number }

export type ClauseKind = 'chart' | 'cairns' | 'beacon';
export interface Clause {
  kind: ClauseKind;
  n: number;          // target hexes / cairns / day limit
  met: boolean;
  failed: boolean;
}

export type Overlay = 'ice' | 'causeway' | 'vine' | 'cairn' | 'beacon';

export interface Tile {
  t: Terrain;
  ov: Overlay | null;
  elev: number;
  charted: boolean;
  /** ticks of ice remaining; undefined on ov==='ice' means permanent (winter) */
  iceLeft?: number;
  /** fuel ticks remaining while on fire */
  burning?: number;
  /** cairn already surveyed */
  visited?: boolean;
  /** ford drowned by the storm swell */
  flooded?: boolean;
}

export interface World {
  seed: number;
  tiles: Map<string, Tile>;
  start: Axial;
  peak: Axial;
  cairns: Axial[];
  cols: number;
  rows: number;
  /** supplies the cheapest card-free walk to the beacon costs — the budget anchor */
  walkCost: number;
  /** days that walk takes */
  walkSteps: number;
}

export type CardId = 'ember' | 'gust' | 'frost' | 'vine' | 'stone' | 'survey' | 'stride';

export interface RunState {
  world: World;
  player: Axial;
  supplies: number;
  day: number;
  score: number;
  charted: number;
  cairnsFound: number;
  discoveriesThisRun: number;
  chainBonus: number;
  windDir: number;      // index into DIRS
  windStrong: number;   // remaining gust ticks
  windPlan: WindChange[];
  weather: WeatherPhase;
  sched: WeatherSched;
  contract: Clause[];
  deck: CardId[];
  hand: CardId[];
  trail: Axial[];
  freeSteps: number;
  over: boolean;
  won: boolean;
  expeditionNo: number;
  /** the cairn Nº 6's water-stained ledger marks — rumoured from day one */
  ledgerCairn: Axial | null;
  /** the ridge where E.V. watched — set once fragment ix is read, until witnessed */
  ridgeHex: Axial | null;
}

export type GameEvent =
  | { kind: 'charted'; hex: Axial; order: number }
  | { kind: 'moved'; from: Axial; to: Axial; cost: number }
  | { kind: 'ignite'; hex: Axial }
  | { kind: 'burnout'; hex: Axial }
  | { kind: 'freeze'; hex: Axial }
  | { kind: 'melt'; hex: Axial }
  | { kind: 'meltwater'; hex: Axial }
  | { kind: 'overlay'; hex: Axial; ov: Overlay }
  | { kind: 'cairn'; hex: Axial }
  | { kind: 'discover'; id: string }
  | { kind: 'fragment'; idx: number }
  | { kind: 'cardchoice'; a: CardId; b: CardId }
  | { kind: 'ridge'; hex: Axial }
  | { kind: 'button'; hex: Axial }
  | { kind: 'chain'; n: number; at: Axial }
  | { kind: 'score'; n: number; at?: Axial; label?: string }
  | { kind: 'wind'; dir: number }
  | { kind: 'weather'; phase: WeatherPhase }
  | { kind: 'bloom'; hex: Axial }
  | { kind: 'clause'; idx: number; met: boolean }
  | { kind: 'draw'; card: CardId }
  | { kind: 'supplies'; n: number; at: Axial }
  | { kind: 'tilechanged'; hex: Axial }
  | { kind: 'end'; won: boolean };
