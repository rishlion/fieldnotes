import type { CardId } from './types';

export interface CardDef {
  id: CardId;
  name: string;
  blurb: string;
  /** does playing it require choosing a hex? */
  targeted: boolean;
  hot?: boolean;
}

export const CARDS: Record<CardId, CardDef> = {
  ember: { id: 'ember', name: 'Ember', blurb: 'Forest blocking the line? Burn it — fire leaves walkable ash.', targeted: true, hot: true },
  gust: { id: 'gust', name: 'Gust', blurb: 'Want a fire to travel? Set the wind for six days.', targeted: true },
  frost: { id: 'frost', name: 'Frost', blurb: 'A river bars the way? Freeze a crossing of ice.', targeted: true },
  vine: { id: 'vine', name: 'Vine', blurb: 'A cliff too sheer? Grow a climbing route up it.', targeted: true },
  stone: { id: 'stone', name: 'Stone', blurb: 'A crossing you’ll keep? Raise a causeway that outlasts thaw.', targeted: true },
  survey: { id: 'survey', name: 'Survey', blurb: 'Days too dear to wander? Chart where you stand — high ground sees further.', targeted: false },
  stride: { id: 'stride', name: 'Stride', blurb: 'A hard trek ahead? The next three days of walking cost nothing.', targeted: false },
};

export const STARTING_DECK: CardId[] = [
  'ember', 'ember', 'gust', 'gust', 'frost', 'frost',
  'vine', 'vine', 'stone', 'stone', 'survey', 'stride',
];

export const CARD_ICONS: Record<CardId, string> = {
  ember: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M24 6c2 7-7 10-6 18 .7 5.6 4.8 9 10 9s9.3-3.8 10-9c.5-4-1.5-7-4-9 0 3-1 4.5-3 5.5C32.5 15 30 9 24 6z" transform="translate(-2 2)"/><path d="M22 33c-1.8-1.4-2.6-3.4-2-6 1.6 1 3.4 1.4 4 3.6.5 1.8-.4 3.4-2 2.4z"/></svg>',
  gust: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 18h20a5 5 0 1 0-5-5"/><path d="M6 26h28a5 5 0 1 1-5 5"/><path d="M6 34h14"/></svg>',
  frost: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M24 6v36M9 15l30 18M39 15L9 33"/><path d="M24 6l-4 5m4-5l4 5M24 42l-4-5m4 5l4-5M9 15l6.5 1M9 15l1-6.5M39 33l-6.5-1m6.5 1l-1 6.5M39 15l-1-6.5M39 15l-6.5 1M9 33l1 6.5M9 33l6.5-1"/></svg>',
  vine: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M14 42C14 28 34 26 34 12a6 6 0 0 0-12-1"/><path d="M20 30c-5-1-7-4-7-8 4 0 7 2 8 6M28 20c5-1 7-4 7-8-4 0-7 2-8 6" stroke-width="2"/></svg>',
  stone: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M10 40l3-9h22l3 9zM15 31l3-8h12l3 8M20 23l2-6h5l2 6"/></svg>',
  survey: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="24" cy="22" r="12"/><path d="M24 10v-5M24 39v-5M36 22h5M7 22h5M24 22l6-6"/><path d="M14 41h20" stroke-width="2.6"/></svg>',
  stride: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 8a3 3 0 1 0 6 0 3 3 0 0 0-6 0z"/><path d="M22 14l-5 9 6 4 2 13M17 23l-6 3M23 27l8-2 6 5M14 44l6-8"/></svg>',
};

export interface CodexEntry { id: string; title: string; text: string }

export const CODEX: CodexEntry[] = [
  { id: 'FIRE_CLEARS', title: 'On Fire', text: 'Fire eats the wood and leaves a gray page behind. Ash is easy walking.' },
  { id: 'WIND_FANS', title: 'On Wind', text: 'Fire follows the wind the way ink follows the nib.' },
  { id: 'ICE_BRIDGE', title: 'On Ice', text: 'Water holds a frost for a while. A river, frozen, is a road.' },
  { id: 'CAUSEWAY', title: 'On Stone', text: 'Stone laid in the shallows outlasts any thaw.' },
  { id: 'VINE_LADDER', title: 'On Vines', text: 'A vine takes any cliff, given a day and a reason.' },
  { id: 'VINE_BURNS', title: 'On Loss', text: 'What climbs, burns. The mountain remembers both.' },
  { id: 'HIGH_VANTAGE', title: 'On Height', text: 'From high ground, the world confesses more of itself.' },
  { id: 'CAIRN_RUMORS', title: 'On Cairns', text: 'Stones stacked by hands before yours. Find one, and the rest whisper their places.' },
  { id: 'ON_RAIN', title: 'On Rain', text: 'Rain closes the fire’s chapter and opens the meadow’s.' },
  { id: 'ON_WINTER', title: 'On Winter', text: 'Winter locks the rivers open — every water a road, every day a hunger.' },
];
