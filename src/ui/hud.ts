import { CARDS, CARD_ICONS, CODEX } from '../game/cards';
import { loadCodex, fragmentsRead, currentExpeditionNo } from '../game/codexStore';
import { FRAGMENTS, roman } from '../game/story';
import { finalScore, sealsMet } from '../game/rules';
import type { CardId, Clause, RunState } from '../game/types';

const WIND_DEG = [0, -60, -120, 180, 120, 60];
const WIND_NAME = ['E', 'NE', 'NW', 'W', 'SW', 'SE'];
const WIND_GLYPH = ['→', '↗', '↖', '←', '↙', '↘'];
const WEATHER_LABEL: Record<string, string> = {
  calm: '', winds: ' · winds rising', storm: ' · storm', clearing: ' · clearing skies', winter: ' · winter',
};

function clauseText(c: Clause): string {
  switch (c.kind) {
    case 'chart': return `chart ${c.n} new hexes`;
    case 'cairns': return `survey ${c.n} cairn${c.n > 1 ? 's' : ''}`;
    case 'beacon': return `the beacon by day ${c.n}`;
  }
}

export class Hud {
  onCardSelect: (idx: number | null) => void = () => {};
  selected: number | null = null;

  private chipDay = document.getElementById('chip-day')!;
  private chipSupplies = document.getElementById('chip-supplies')!;
  private chipCharted = document.getElementById('chip-charted')!;
  private chipScore = document.getElementById('chip-score')!;
  private chipWind = document.getElementById('chip-wind')!;
  private suppliesN = document.getElementById('supplies-n')!;
  private suppliesExtra = document.getElementById('supplies-extra')!;
  private chartedN = document.getElementById('charted-n')!;
  private scoreN = document.getElementById('score-n')!;
  private windArrow = document.getElementById('wind-arrow')!;
  private windNext = document.getElementById('wind-next')!;
  private contractList = document.getElementById('contract-list')!;
  private subtitle = document.getElementById('subtitle')!;
  private handEl = document.getElementById('hand')!;
  private toastsEl = document.getElementById('toasts')!;
  private hintEl = document.getElementById('hint')!;
  private codexBtn = document.getElementById('codex-btn')!;
  private codexPanel = document.getElementById('codex-panel')!;
  private codexList = document.getElementById('codex-list')!;
  private codexSub = document.getElementById('codex-sub')!;
  private endPanel = document.getElementById('end-panel')!;
  private introPanel = document.getElementById('intro-panel')!;
  private introH2 = document.getElementById('intro-h2')!;
  private introCommission = document.getElementById('intro-commission')!;

  /** set while a daily expedition is under way, e.g. "daily expedition · 2026-08-06" */
  dailyLabel: string | null = null;

  /** called when the player breaks the seal on the guild letter */
  onBegin: () => void = () => {};

  private prev = { supplies: -1, score: -1, charted: -1 };
  private prevDeck = -1;
  private deckFlash = false;
  private pendingDeal = 0;

  /** the codex has ever had something in it — laws or journal pages */
  private codexEverMarked = loadCodex().size > 0 || fragmentsRead() > 0;

  constructor() {
    this.codexBtn.addEventListener('click', () => {
      this.fillCodex();
      this.codexPanel.classList.toggle('hidden');
      this.codexBtn.classList.remove('glow');
    });
    document.getElementById('codex-close')!.addEventListener('click', () => this.closeCodex());
    document.getElementById('codex-x')!.addEventListener('click', () => this.closeCodex());
    document.getElementById('btn-begin')!.addEventListener('click', () => {
      this.introPanel.classList.add('hidden');
      this.onBegin();
    });
    document.getElementById('choice-skip')!.addEventListener('click', () => this.pickChoice(null));
    // journal pages wait for the reader — a click turns them
    this.lawEl.addEventListener('click', () => {
      if (this.lawShowing && this.lawEl.classList.contains('sticky')) this.hideBanner();
    });
    const shareBtn = document.getElementById('btn-share')!;
    shareBtn.addEventListener('click', () => {
      const done = () => {
        shareBtn.textContent = 'copied ✓';
        setTimeout(() => { shareBtn.textContent = 'copy the report'; }, 2200);
      };
      navigator.clipboard?.writeText(this.shareText).then(done).catch(() => {
        // quieter clipboards still get the report the old way
        const ta = document.createElement('textarea');
        ta.value = this.shareText;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        done();
      });
    });
  }

  /** the spoiler-free expedition report, rebuilt at each run's end */
  private shareText = '';
  /** the tally count-up's animation frame handle */
  private tallyRaf = 0;

  get codexOpen(): boolean {
    return !this.codexPanel.classList.contains('hidden');
  }

  closeCodex() {
    this.codexPanel.classList.add('hidden');
  }

  showIntro(s: RunState) {
    this.clearBanners(); // a new expedition starts with a clean page
    this.introH2.textContent = this.dailyLabel ? 'The Daily Expedition' : `Expedition Nº ${s.expeditionNo}`;
    // one line so the reader knows whose island this is — the shared one, or their own
    const mode = document.getElementById('intro-mode') as HTMLElement;
    if (this.dailyLabel) {
      mode.textContent = 'every cartographer charts this same island today — one attempt, then the seal sets';
      mode.hidden = false;
    } else if (s.expeditionNo > 1) {
      mode.textContent = 'your own commission, at your own pace — the ledger remembers';
      mode.hidden = false;
    } else {
      mode.hidden = true;
    }
    // a returning cartographer knows the work — the letter gets out of the way
    const returning = s.expeditionNo > 1;
    (document.getElementById('intro-first') as HTMLElement).hidden = returning;
    (document.getElementById('intro-standing') as HTMLElement).hidden = !returning;
    // the daily is a mid-campaign commission — warn a cartographer who hasn't charted their first
    (document.getElementById('intro-daily-note') as HTMLElement).hidden =
      !(this.dailyLabel && currentExpeditionNo() === 1);
    this.introCommission.innerHTML = '';
    for (const c of s.contract) {
      const li = document.createElement('li');
      li.textContent = clauseText(c);
      if (c.kind === 'cairns') {
        // the one clause whose verb isn't obvious — say how it's done
        const gloss = document.createElement('span');
        gloss.className = 'gloss';
        gloss.textContent = 'walk to their stones — the survey makes itself';
        li.appendChild(gloss);
      }
      this.introCommission.appendChild(li);
    }
    this.introPanel.classList.remove('hidden');
  }

  get introVisible(): boolean {
    return !this.introPanel.classList.contains('hidden');
  }

  /** flag how many cards were just drawn, so renderHand can animate them in */
  markDrawn(n: number) {
    this.pendingDeal = n;
  }

  private flash(el: HTMLElement) {
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  /** a chip or button asleep until the island first makes it matter */
  private dormant(el: HTMLElement, sleep: boolean) {
    const was = el.classList.contains('dormant');
    el.classList.toggle('dormant', sleep);
    if (was && !sleep) this.flash(el);
  }

  update(s: RunState) {
    // a first commission wakes the interface a piece at a time; every later
    // expedition (and the daily) starts with the full ledger
    const staged = s.expeditionNo === 1 && !this.dailyLabel;
    let burning = false;
    if (staged && s.weather === 'calm' && s.windStrong === 0) {
      for (const t of s.world.tiles.values()) if (t.burning) { burning = true; break; }
    }
    this.dormant(this.chipScore, staged && s.score === 0);
    this.dormant(this.chipWind, staged && s.weather === 'calm' && s.windStrong === 0 && !burning);
    this.dormant(this.codexBtn as HTMLElement, staged && !this.codexEverMarked);

    this.chipDay.textContent = `Day ${s.day}${WEATHER_LABEL[s.weather] ?? ''}`;
    this.suppliesN.textContent = String(s.supplies);
    this.suppliesExtra.textContent = s.freeSteps > 0 ? `+${s.freeSteps} free` : '';
    this.chipSupplies.classList.toggle('low', s.supplies <= 6 && !s.over);
    this.chartedN.textContent = String(s.charted);
    this.scoreN.textContent = String(s.score);
    this.subtitle.textContent = this.dailyLabel ?? `expedition nº ${s.expeditionNo}`;
    this.deckFlash = this.prevDeck !== -1 && this.prevDeck !== s.deck.length;
    this.prevDeck = s.deck.length;

    this.windArrow.style.transform = `rotate(${WIND_DEG[s.windDir]}deg)`;
    this.chipWind.classList.toggle('gust', s.windStrong > 0);
    const next = s.windPlan.find((w) => w.day > s.day);
    const turning = next && next.day - s.day <= 6 && next.dir !== s.windDir;
    this.windNext.textContent = turning ? `turns ${WIND_GLYPH[next.dir]} day ${next.day}` : '';
    this.chipWind.title =
      `wind blows ${WIND_NAME[s.windDir]}${s.windStrong > 0 ? ' (gusting)' : ''}` +
      (turning ? ` — turns ${WIND_NAME[next.dir]} on day ${next.day}` : '');
    this.renderContract(s);

    const watched: [keyof typeof this.prev, number, HTMLElement][] = [
      ['supplies', s.supplies, this.chipSupplies],
      ['score', s.score, this.chipScore],
      ['charted', s.charted, this.chipCharted],
    ];
    for (const [k, v, el] of watched) {
      if (this.prev[k] !== -1 && this.prev[k] !== v) this.flash(el);
      this.prev[k] = v;
    }

    this.renderHand(s);
  }

  private renderContract(s: RunState) {
    this.contractList.innerHTML = '';
    for (const c of s.contract) {
      const li = document.createElement('li');
      li.className = c.met ? 'met' : c.failed ? 'failed' : '';
      let prog = '';
      if (c.kind === 'chart') prog = `${Math.min(s.charted, c.n)}/${c.n}`;
      else if (c.kind === 'cairns') prog = `${Math.min(s.cairnsFound, c.n)}/${c.n}`;
      else if (!c.met && !c.failed) prog = `day ${s.day}`;
      li.innerHTML = `<span class="box">${c.met ? '✓' : c.failed ? '✕' : '▢'}</span><span>${clauseText(c)}</span><span class="prog">${prog}</span>`;
      this.contractList.appendChild(li);
    }
  }

  flashClause(idx: number) {
    const li = this.contractList.children[idx] as HTMLElement | undefined;
    if (li) {
      li.classList.remove('flash');
      void li.offsetWidth;
      li.classList.add('flash');
    }
  }

  /** the primer's pointer at a card in hand; null clears it */
  private tutCard: CardId | null = null;

  highlightCard(id: CardId | null) {
    this.tutCard = id;
  }

  private renderHand(s: RunState) {
    this.handEl.innerHTML = '';
    const dealFrom = s.hand.length - this.pendingDeal;
    let tutMarked = false;
    s.hand.forEach((id, i) => {
      const def = CARDS[id];
      const el = document.createElement('div');
      el.className = 'card' + (def.hot ? ' hot' : '') + (this.selected === i ? ' sel' : '') + (i >= dealFrom ? ' dealt' : '');
      if (!tutMarked && id === this.tutCard) {
        el.className += ' tut';
        tutMarked = true;
      }
      el.style.setProperty('--rot', `${(i - (s.hand.length - 1) / 2) * 3.2}deg`);
      el.innerHTML = `${CARD_ICONS[id]}<div class="nm">${def.name}</div><div class="fx">${def.blurb}</div>`;
      el.addEventListener('click', () => {
        const next = this.selected === i ? null : i;
        this.selected = next;
        this.onCardSelect(next);
        this.renderHand(s);
      });
      this.handEl.appendChild(el);
    });
    const pile = document.createElement('div');
    pile.className = 'deckpile' + (s.deck.length === 0 ? ' empty' : '') + (this.deckFlash ? ' flash' : '');
    pile.title = 'cards left in the satchel';
    pile.innerHTML = `<b>${s.deck.length}</b><span class="lbl">satchel</span>`;
    this.handEl.appendChild(pile);
    this.deckFlash = false;
    this.pendingDeal = 0;
  }

  clearSelection(s: RunState) {
    this.selected = null;
    this.renderHand(s);
  }

  toast(title: string, text: string) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<b>${title}</b>${text}`;
    this.toastsEl.appendChild(el);
    setTimeout(() => el.remove(), 6000);
    if (this.toastsEl.children.length > 3) this.toastsEl.firstElementChild?.remove();
  }

  /* discoveries and journal pages stop the page: centered banner, queued.
     ms === 0 marks a sticky banner — it waits for the reader's click.
     the queue holds while a modal owns the page, and resumes when it closes */
  private lawEl = document.getElementById('law-banner')!;
  private lawQueue: { html: string; ms: number; cls: string }[] = [];
  private lawShowing = false;
  private lawCurrent: { html: string; ms: number; cls: string } | null = null;
  private lawTimer = 0;

  law(title: string, text: string) {
    this.pushBanner(
      `<i>a law of the island — inked in the codex</i><b>${title}</b><span>${text}</span>`,
      2800, ''
    );
  }

  fragment(idx: number) {
    this.pushBanner(
      `<i>from the journal of expedition nº 6 · fragment ${roman(idx)}</i><span>${FRAGMENTS[idx]}</span>` +
        `<u class="turn">turn the page</u>`,
      0, 'journal sticky'
    );
  }

  /** a scripted moment: journal-styled, no roman numeral — the island speaking */
  moment(kicker: string, text: string) {
    this.pushBanner(`<i>${kicker}</i><span>${text}</span>`, 4800, 'journal');
  }

  private pushBanner(html: string, ms: number, cls: string) {
    this.lawQueue.push({ html, ms, cls });
    this.pumpLaw();
  }

  /** a modal owns the page while it's up — banners wait their turn */
  private get pageHeld(): boolean {
    return this.choiceOpen || this.introVisible || !this.endPanel.classList.contains('hidden');
  }

  private pumpLaw() {
    if (this.lawShowing || this.pageHeld) return;
    const next = this.lawQueue.shift();
    if (!next) return;
    this.lawShowing = true;
    this.lawCurrent = next;
    this.lawEl.innerHTML = next.html;
    this.lawEl.className = next.cls; // clears 'hidden'/'show', applies variant
    void (this.lawEl as HTMLElement).offsetWidth;
    this.lawEl.classList.add('show');
    if (next.ms > 0) this.lawTimer = window.setTimeout(() => this.hideBanner(), next.ms);
  }

  private hideBanner() {
    if (!this.lawShowing) return;
    window.clearTimeout(this.lawTimer);
    this.lawCurrent = null;
    this.lawEl.classList.remove('show');
    setTimeout(() => {
      this.lawEl.classList.add('hidden');
      this.lawShowing = false;
      this.pumpLaw();
    }, 400);
  }

  /** a modal interrupts mid-banner: put the banner back at the head, unread */
  private holdBanner() {
    if (!this.lawShowing || !this.lawCurrent) return;
    window.clearTimeout(this.lawTimer);
    this.lawQueue.unshift(this.lawCurrent);
    this.lawCurrent = null;
    this.lawEl.classList.remove('show');
    this.lawEl.classList.add('hidden');
    this.lawShowing = false;
  }

  /** a new expedition starts with a clean page */
  private clearBanners() {
    window.clearTimeout(this.lawTimer);
    this.lawQueue = [];
    this.lawCurrent = null;
    this.lawShowing = false;
    this.lawEl.classList.remove('show');
    this.lawEl.classList.add('hidden');
  }

  /* the cairn's cache: take one of two, or leave it be */
  onCardChoice: (pick: 0 | 1 | null) => void = () => {};
  private choicePanel = document.getElementById('choice-panel')!;
  private choiceCards = document.getElementById('choice-cards')!;
  private choice: [CardId, CardId] | null = null;

  get choiceOpen(): boolean {
    return this.choice !== null;
  }

  showCardChoice(a: CardId, b: CardId) {
    this.holdBanner(); // the cache takes the page; laws and pages return after
    this.choice = [a, b];
    this.choiceCards.innerHTML = '';
    [a, b].forEach((id, i) => {
      const def = CARDS[id];
      const el = document.createElement('div');
      el.className = 'choice-card';
      el.innerHTML = `${CARD_ICONS[id]}<div class="nm">${def.name}</div><div class="fx">${def.blurb}</div>`;
      el.addEventListener('click', () => this.pickChoice(i as 0 | 1));
      this.choiceCards.appendChild(el);
    });
    this.choicePanel.classList.remove('hidden');
  }

  pickChoice(pick: 0 | 1 | null) {
    if (this.choice === null) return;
    this.choice = null;
    this.choicePanel.classList.add('hidden');
    this.onCardChoice(pick);
    this.pumpLaw(); // anything the modal held (the law, the page) now gets its turn
  }

  /* the journal's margin: quiet notes on what the world did by itself */
  private mnotesEl = document.getElementById('mnotes')!;

  marginNote(text: string) {
    const el = document.createElement('div');
    el.className = 'mnote';
    el.textContent = text;
    this.mnotesEl.appendChild(el);
    setTimeout(() => el.remove(), 8800);
    while (this.mnotesEl.children.length > 3) this.mnotesEl.firstElementChild?.remove();
  }

  codexGlow() {
    this.codexEverMarked = true; // the button may wake now, if it was sleeping
    this.codexBtn.classList.add('glow');
  }

  /** called when the player waves the primer away */
  onHintDismiss: () => void = () => {};

  /** the last hint spoken — a new whisper announces itself, a repeated one stays quiet */
  private lastHint: string | null = null;

  hint(text: string | null, dismissable = false) {
    if (text) {
      const changed = text !== this.lastHint;
      this.lastHint = text;
      this.hintEl.textContent = text;
      if (dismissable) {
        const skip = document.createElement('button');
        skip.className = 'skip';
        skip.textContent = '✕';
        skip.title = 'enough — I have the way of it';
        skip.addEventListener('click', () => this.onHintDismiss());
        this.hintEl.appendChild(skip);
      }
      this.hintEl.classList.toggle('primer', dismissable);
      this.hintEl.classList.add('show');
      if (changed && dismissable) {
        this.hintEl.classList.remove('pop');
        void this.hintEl.offsetWidth;
        this.hintEl.classList.add('pop');
      }
    } else {
      this.lastHint = null;
      this.hintEl.classList.remove('show', 'primer', 'pop');
    }
  }

  private fillCodex() {
    const unlocked = loadCodex();
    const found = CODEX.filter((e) => unlocked.has(e.id)).length;
    this.codexSub.textContent =
      found === 0
        ? 'the pages are blank — the island will fill them'
        : found === CODEX.length
          ? 'every law of the island, learned and inked'
          : `what the guild has learned of the world's grammar — ${found} of ${CODEX.length} entries`;
    this.codexList.innerHTML = '';
    for (const entry of CODEX) {
      const li = document.createElement('li');
      if (unlocked.has(entry.id)) {
        li.innerHTML = `<b>${entry.title}</b>${entry.text}`;
      } else {
        li.className = 'locked';
        li.innerHTML = `<b>· · ·</b>something the island has not yet shown you`;
      }
      this.codexList.appendChild(li);
    }

    // the recovered journal of Nº 6, page by page
    const read = fragmentsRead();
    const journalSub = document.getElementById('journal-sub')!;
    const journalList = document.getElementById('journal-list')!;
    journalSub.textContent =
      read === 0
        ? 'the journal of expedition nº 6 — nothing yet recovered. their cairns keep it'
        : read >= FRAGMENTS.length
          ? 'the journal of expedition nº 6 — whole, at last'
          : `the journal of expedition nº 6 — ${read} of ${FRAGMENTS.length} pages recovered`;
    journalList.innerHTML = '';
    for (let i = 0; i < read && i < FRAGMENTS.length; i++) {
      const li = document.createElement('li');
      li.innerHTML = `<b>fragment ${roman(i)}</b>${FRAGMENTS[i]}`;
      journalList.appendChild(li);
    }
    if (read < FRAGMENTS.length) {
      const li = document.createElement('li');
      li.className = 'locked';
      li.innerHTML = `<b>· · ·</b>${FRAGMENTS.length - read} page${FRAGMENTS.length - read > 1 ? 's' : ''} the island still keeps`;
      journalList.appendChild(li);
    }
  }

  showEnd(s: RunState, best: number, isBest: boolean) {
    this.holdBanner(); // the tally takes the page; unread pages wait in the codex
    const title = document.getElementById('end-title')!;
    const flavor = document.getElementById('end-flavor')!;
    const tally = document.getElementById('end-tally')!;
    title.textContent = s.won ? 'The beacon is lit' : 'The expedition ends';
    const read = fragmentsRead();
    const journalLine = s.won
      ? read >= FRAGMENTS.length
        ? ' The journal of Nº 6 is whole — let the island keep their names; the chart keeps their work.'
        : read > 0
          ? ' Somewhere below, their cairns stand a little taller.'
          : ''
      : '';
    flavor.textContent = (s.won
      ? `On day ${s.day}, the summit. The island has a shape now — your ink gave it one.`
      : `The supplies ran out on day ${s.day}. The journal closes, half-charted. The island keeps its secrets a while longer.`) + journalLine;
    const rows: [string, string | number][] = [
      [`hexes charted`, s.charted],
      [`cairns surveyed × 25`, s.cairnsFound * 25],
      [`discoveries × 40`, s.discoveriesThisRun * 40],
      [`chain bonuses`, s.chainBonus],
    ];
    if (s.won) {
      rows.push([`the beacon`, 150]);
      rows.push([`supplies remaining × 2`, s.supplies * 2]);
    }
    const seals = sealsMet(s);
    const sealDots = s.contract.map((c) => (c.met ? '●' : '○')).join(' ');
    rows.push([`guild seals ${sealDots}`, `×${(1 + 0.25 * seals).toFixed(2)}`]);
    tally.innerHTML = '';
    // the ledger counts itself up, line by line
    const counting: { el: HTMLElement; final: number }[] = [];
    for (const [label, value] of rows) {
      const li = document.createElement('li');
      const l = document.createElement('span');
      l.textContent = label;
      const v = document.createElement('span');
      if (typeof value === 'number') {
        v.textContent = '0';
        counting.push({ el: v, final: value });
      } else {
        v.textContent = value;
      }
      li.append(l, v);
      tally.appendChild(li);
    }
    const total = document.createElement('li');
    total.className = 'total';
    const fin = finalScore(s);
    const totalLabel = document.createElement('span');
    totalLabel.textContent = 'score';
    const totalVal = document.createElement('span');
    totalVal.textContent = '0';
    total.append(totalLabel, totalVal);
    tally.appendChild(total);

    cancelAnimationFrame(this.tallyRaf);
    const t0 = performance.now();
    const suffix = isBest ? ' — a guild record' : ` (best ${best})`;
    const tick = (now: number) => {
      let running = false;
      counting.forEach((c, i) => {
        const t = Math.min(1, Math.max(0, (now - t0 - i * 110) / 380));
        c.el.textContent = String(Math.round(c.final * (1 - Math.pow(1 - t, 2))));
        if (t < 1) running = true;
      });
      const tt = Math.min(1, Math.max(0, (now - t0 - counting.length * 110) / 600));
      totalVal.textContent = tt < 1
        ? String(Math.round(fin * (1 - Math.pow(1 - tt, 2))))
        : `${fin}${suffix}`;
      if (tt < 1) running = true;
      if (running) this.tallyRaf = requestAnimationFrame(tick);
    };
    this.tallyRaf = requestAnimationFrame(tick);

    // the report: compact, journal-voiced, and spoiler-free — made to be pasted
    const beacon = s.contract.find((c) => c.kind === 'beacon');
    this.shareText = [
      `FIELDNOTES — ${this.dailyLabel ?? `expedition nº ${s.expeditionNo}`}`,
      s.won
        ? `the beacon is lit · day ${s.day}${beacon ? ` of ${beacon.n}` : ''}`
        : `the satchel ran dry · day ${s.day}`,
      `⬡ ${s.charted} new hexes · ⚑ ${s.cairnsFound} cairn${s.cairnsFound === 1 ? '' : 's'} · ✦ ${s.discoveriesThisRun} law${s.discoveriesThisRun === 1 ? '' : 's'}`,
      `seals ${sealDots} · score ${fin}`,
    ].join('\n');

    // the daily is one attempt — no charting it again
    (document.getElementById('btn-retry') as HTMLElement).style.display = this.dailyLabel ? 'none' : '';
    this.endPanel.classList.remove('hidden');
  }

  hideEnd() {
    cancelAnimationFrame(this.tallyRaf);
    this.endPanel.classList.add('hidden');
  }
}
