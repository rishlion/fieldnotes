/**
 * The journal of Expedition Nº 6 — the one that never came back.
 * One fragment surfaces at each cairn surveyed, in this order, across runs.
 * The arc doubles as quiet teaching: bread is supplies, cairns are caches,
 * the island's laws are the ones in the codex.
 */

export const FRAGMENTS: string[] = [
  // i — the terms
  'Six of us and twenty days of bread. Aldous counts the loaves twice. The guild pays by the hex, he says. The bread does not care.',
  // ii — why cairns feed you
  'We raise a cairn at each camp and bury beneath it what we can spare — biscuit, twine, a knife. A cartographer provisions the next one. That is the whole religion of the guild.',
  // iii — fire and wind
  'Tam struck an ember to clear the pines and the wind turned on us like an argument. We slept in the shallows. First law of this place: fire answers the wind, and the wind answers nothing.',
  // iv — frost
  'Pell has found the trick of frost — a river held still for twelve days. She crossed twice to be sure. Nothing on the far bank but the view, she said, as if that were payment.',
  // v — the argument
  'The glass is falling. Aldous wants the summit before the storm; Marn wants the coast while it holds. The map is not worth six names, I wrote. Then I crossed it out.',
  // vi — the storm
  'The storm ate the ford and the frost both. Three days under the boats. We are four now. I will not write how.',
  // vii — the divide
  'Marn keeps the coast, Aldous the count, Pell the summit line. I keep this page. The island keeps everything else.',
  // viii — arithmetic
  'Aldous divides what remains by four, then by the days, then by hope. The arithmetic is honest and we hate it. Every hex we chart now, we pay for in bread.',
  // ix — the ridge
  'Pell and Aldous went up for the beacon at first light. From the ridge I watched the snow take their shapes the way paper takes ink — a little at a time, then whole.',
  // x — the col
  'Found their cairn on the col, the stones still new. Beneath the top stone, her button. I have nothing to leave but this page, and I am not finished with it.',
  // xi — winter
  'Winter locked the rivers open — every water a road, and no one left to walk them but Marn and me. We chart. It is that or count.',
  // xii — the hand-off
  'If you are reading this, the island let you further than it let us. The beacon wants only a hand to light it. Ours were full of stones. Finish the map. — E.V., Expedition Nº 6',
];

const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii'];
export const roman = (n: number) => ROMAN[n] ?? String(n + 1);
