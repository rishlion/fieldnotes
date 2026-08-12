/** Cross-run persistence: the codex is the player's real progression. */

const CODEX_KEY = 'fieldnotes.codex.v1';
const EXP_KEY = 'fieldnotes.expedition.v1';
const BEST_KEY = 'fieldnotes.best.v1';
const FRAG_KEY = 'fieldnotes.fragments.v1';

let codex: Set<string> | null = null;

export function loadCodex(): Set<string> {
  if (!codex) {
    try {
      codex = new Set(JSON.parse(localStorage.getItem(CODEX_KEY) ?? '[]'));
    } catch {
      codex = new Set();
    }
  }
  return codex;
}

/** Returns true if this entry is newly discovered. */
export function unlockCodex(id: string): boolean {
  const c = loadCodex();
  if (c.has(id)) return false;
  c.add(id);
  try { localStorage.setItem(CODEX_KEY, JSON.stringify([...c])); } catch { /* private mode */ }
  return true;
}

/** Expedition nº = expeditions concluded so far + 1. Reloads don't inflate it. */
export function currentExpeditionNo(): number {
  try {
    return (parseInt(localStorage.getItem(EXP_KEY) ?? '0', 10) || 0) + 1;
  } catch {
    return 1;
  }
}

export function markExpeditionEnded(): void {
  try {
    const n = parseInt(localStorage.getItem(EXP_KEY) ?? '0', 10) || 0;
    localStorage.setItem(EXP_KEY, String(n + 1));
  } catch { /* private mode */ }
}

/** Journal fragments of Expedition Nº 6 read so far (cross-run, like the codex). */
export function fragmentsRead(): number {
  try { return parseInt(localStorage.getItem(FRAG_KEY) ?? '0', 10) || 0; } catch { return 0; }
}

/** Reveal the next unread fragment; returns its index, or null if the journal is whole. */
export function readNextFragment(total: number): number | null {
  const n = fragmentsRead();
  if (n >= total) return null;
  try { localStorage.setItem(FRAG_KEY, String(n + 1)); } catch { /* private mode */ }
  return n;
}

/** One-time story flags (the ridge witnessed, the button kept, echoes heard). */
const FLAG_KEY = 'fieldnotes.flags.v1';

export function flagSet(id: string): boolean {
  try { return (JSON.parse(localStorage.getItem(FLAG_KEY) ?? '[]') as string[]).includes(id); } catch { return false; }
}

export function markFlag(id: string): void {
  try {
    const flags = new Set(JSON.parse(localStorage.getItem(FLAG_KEY) ?? '[]') as string[]);
    flags.add(id);
    localStorage.setItem(FLAG_KEY, JSON.stringify([...flags]));
  } catch { /* private mode */ }
}

export function bestScore(): number {
  try { return parseInt(localStorage.getItem(BEST_KEY) ?? '0', 10) || 0; } catch { return 0; }
}

export function recordScore(score: number): { best: number; isBest: boolean } {
  let best = 0;
  try { best = parseInt(localStorage.getItem(BEST_KEY) ?? '0', 10) || 0; } catch { /* ignore */ }
  const isBest = score > best;
  if (isBest) {
    best = score;
    try { localStorage.setItem(BEST_KEY, String(best)); } catch { /* ignore */ }
  }
  return { best, isBest };
}
