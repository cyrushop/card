/* OPCG collection engine: pure functions, no DOM. Used by app.js and the tests. */
(function (root) {
  'use strict';

  // DON-001 ...: DON!! cards (numbered by the app, from Yuyu-tei's list; the official list has none).
  const CARD_RE = /((?:OP|ST|EB|PRB)\d{2}|DON|P)-(\d{3})(?:_?([pr]\d+))?/i;

  /** 'op08-001_P1' -> 'OP08-001_p1'. Returns '' when no card number is found. */
  function normId(s) {
    const m = CARD_RE.exec(String(s || ''));
    if (!m) return '';
    return m[1].toUpperCase() + '-' + m[2] + (m[3] ? '_' + m[3].toLowerCase() : '');
  }

  /** Card number without the parallel / reprint suffix. */
  function baseId(id) {
    return String(id || '').split('_')[0];
  }

  /** Rarity as the app shows it: the official list writes SP cards as "SP卡". */
  function normRarity(r) {
    const s = String(r || '').trim();
    return /^SP/i.test(s) ? 'SP' : s;
  }

  /**
   * Short name for a card's version: '' for the normal card, 'SP' for an SP card,
   * '重印' for a same-picture reprint (_r1), '異圖' for any other alternate art (_p1).
   */
  function variantLabel(card) {
    const id = typeof card === 'string' ? card : (card || {}).id;
    if (id === baseId(id)) return '';
    if (/_r\d+$/i.test(id)) return '重印';
    return normRarity((card || {}).rarity) === 'SP' ? 'SP' : '異圖';
  }

  /** Card id from the quick-add box: "OP08-001", "08-001" (OP set), "001" or "1" with a default set, "001p1". */
  function quickId(input, defaultSet) {
    let s = String(input || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!s) return '';
    const full = normId(s);
    if (full) return full;
    let m = /^(\d{2})-(\d{1,3})(?:_?(P\d+|R\d+))?$/.exec(s);
    if (m) return 'OP' + m[1] + '-' + m[2].padStart(3, '0') + (m[3] ? '_' + m[3].toLowerCase() : '');
    m = /^(\d{1,3})(?:_?(P\d+|R\d+))?$/.exec(s);
    if (m && defaultSet) return defaultSet.toUpperCase() + '-' + m[1].padStart(3, '0') + (m[2] ? '_' + m[2].toLowerCase() : '');
    return '';
  }

  /**
   * Parse a pasted deck list. Accepts "4xOP08-002", "4 x OP08-002", "4 OP08-002",
   * "OP08-002 x4", "OP08-002 4", a bare card number (count 1), and the
   * onepiecetopdecks deck-builder code "1nOP08-001a4nOP08-002" (also inside a URL).
   * Parallels are folded into the base card number unless opts.keepVariants.
   */
  function parseDeckText(text, opts) {
    const keepVariants = !!(opts && opts.keepVariants);
    const src = String(text || '');
    const order = [];
    const counts = {};
    const unknown = [];
    const add = (id, n) => {
      const b = keepVariants ? normId(id) : baseId(normId(id));
      if (!b || !(n > 0)) return;
      if (!(b in counts)) { counts[b] = 0; order.push(b); }
      counts[b] += n;
    };

    const dg = /(?:^|[?&\s])dg=([^&\s]+)/i.exec(src);
    const dgBody = dg ? decodeURIComponent(dg[1]) : (/^\s*(\d+n[A-Z0-9\-_]+a?)+\s*$/i.test(src) ? src : '');
    if (dgBody) {
      const re = /(\d+)n((?:(?:OP|ST|EB|PRB)\d{2}|P)-\d{3}(?:_[pr]\d+)?)/gi;
      let m;
      while ((m = re.exec(dgBody))) add(m[2], parseInt(m[1], 10));
      return { entries: order.map(id => ({ id, count: counts[id] })), unknown };
    }

    for (const raw of src.split(/\r?\n|;/)) {
      const line = raw.trim();
      if (!line || /^(\/\/|#)/.test(line)) continue;
      const m = CARD_RE.exec(line);
      if (!m) { unknown.push(line); continue; }
      const before = line.slice(0, m.index);
      const after = line.slice(m.index + m[0].length);
      let n = 1;
      let c = /(\d{1,2})\s*[x×*]?\s*$/i.exec(before);
      if (c) n = parseInt(c[1], 10);
      else if ((c = /^\s*[x×*]\s*(\d{1,2})\b/i.exec(after)) || (c = /^\s+(\d{1,2})\s*$/.exec(after))) n = parseInt(c[1], 10);
      add(m[0], n);
    }
    return { entries: order.map(id => ({ id, count: counts[id] })), unknown };
  }

  /** '11/1/2026' (M/D/YYYY) or '2026-11-01' -> '2026-11-01'. Anything else is returned as is. */
  function isoDate(s) {
    const t = String(s || '').trim();
    let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
    if (m) return m[3] + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0');
    m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(t);
    if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
    return t;
  }

  /** Deck details from an onepiecetopdecks deckgen link (dn, au, date, pl, tn, hs, cn). */
  function deckMetaFromUrl(text) {
    const m = /https?:\/\/\S*?[?&]dg=\S+/i.exec(String(text || ''));
    if (!m) return null;
    let url;
    try { url = new URL(m[0]); } catch (e) { return null; }
    const q = k => (url.searchParams.get(k) || '').trim();
    return {
      name: q('dn'), author: q('au'), date: isoDate(q('date')), placement: q('pl'),
      event: q('hs'), eventType: q('tn'), country: q('cn'), url: url.href,
    };
  }

  /**
   * One paste can hold several deckgen links (one per line) or one text list.
   * Returns [{ meta, entries, unknown }].
   */
  function parseDeckImports(text) {
    const src = String(text || '');
    const links = src.split(/\s+/).filter(t => /[?&]dg=/i.test(t));
    if (links.length > 1 || (links.length === 1 && !/\n\s*\d+\s*x/i.test(src))) {
      return links.map(l => Object.assign({ meta: deckMetaFromUrl(l) || {} }, parseDeckText(l)));
    }
    return [Object.assign({ meta: deckMetaFromUrl(src) || {} }, parseDeckText(links.length ? src.replace(/\S*[?&]dg=\S+/i, '') : src))];
  }

  /** Entries -> "1xOP08-001" lines (leader first when known). */
  function deckToText(entries, cardsById) {
    const lead = leaderOf(entries, cardsById);
    const sorted = entries.slice().sort((a, b) =>
      (a.id === lead ? -1 : b.id === lead ? 1 : a.id.localeCompare(b.id)));
    return sorted.map(e => e.count + 'x' + e.id).join('\n');
  }

  function toDg(entries, cardsById) {
    return deckToText(entries, cardsById).split('\n').map(l => l.replace('x', 'n')).join('a');
  }

  const CATEGORY_WORDS = [
    ['LEADER', ['LEADER', '領航', '領袖', '隊長']],
    ['CHARACTER', ['CHARACTER', '角色']],
    ['EVENT', ['EVENT', '事件']],
    ['STAGE', ['STAGE', '場地', '舞台']],
    ['DON', ['DON']],
  ];
  function normCategory(raw) {
    const up = String(raw || '').toUpperCase();
    for (const [key, words] of CATEGORY_WORDS) if (words.some(w => up.includes(w))) return key;
    return up;
  }

  /** The leader of a deck: a card whose category is LEADER, else the first count-1 entry. */
  function leaderOf(entries, cardsById) {
    if (!entries || !entries.length) return '';
    if (cardsById) {
      const l = entries.find(e => cardsById[e.id] && normCategory(cardsById[e.id].category) === 'LEADER');
      if (l) return l.id;
    }
    return entries[0].count === 1 ? entries[0].id : '';
  }

  /** Copies owned per base card number. Parallels count only when includeParallels is on. */
  // ------------------------------------------------------------ ∞ copies
  /**
   * "∞" = "I have plenty of this card, don't make me count" (common cards after opening boxes).
   * Stored as a large number so every "do I have enough?" check just works; anything from
   * INF_FROM up counts as ∞ (taking a few for a sold deck leaves it ∞).
   */
  const INF = 9999;
  const INF_FROM = 9000;
  function isInf(n) { return Number(n) >= INF_FROM; }
  /** Copies ∞ stands for in totals and values: a playset of 4 (the real number is not counted). */
  const INF_COPIES = 4;
  /** Copies to use in totals and values: ∞ counts as a playset of 4. */
  function countable(n) { return isInf(n) ? INF_COPIES : Math.max(0, Number(n) || 0); }
  function fmtQty(n) { return isInf(n) ? '∞' : String(Math.max(0, Number(n) || 0)); }
  /** Typed count: "3", "", "∞", "inf", "*" or "i". null when it is not a count. */
  function parseQty(text) {
    const t = String(text == null ? '' : text).trim().toLowerCase();
    if (t === '') return 0;
    if (['∞', 'inf', '*', 'i'].includes(t)) return INF;
    if (!/^\d+$/.test(t)) return null;
    const n = Number(t);
    return n >= INF_FROM ? INF : n;
  }
  /** Total copies in a collection, ∞ counted as 1. */
  function totalCopies(owned) {
    return Object.values(owned || {}).reduce((t, n) => t + countable(n), 0);
  }

  function ownedTotals(owned, includeParallels) {
    const out = {};
    for (const [id, n] of Object.entries(owned || {})) {
      if (!(n > 0)) continue;
      const b = baseId(id);
      if (id !== b && !includeParallels) continue;
      out[b] = (out[b] || 0) + n;
    }
    return out;
  }

  /** Copies held by decks marked "built" (not yet sold), per base card number. */
  function reservedTotals(decks, excludeId) {
    const out = {};
    for (const d of decks || []) {
      if (d.status !== 'built' || d.id === excludeId) continue;
      for (const e of d.entries) out[e.id] = (out[e.id] || 0) + e.count;
    }
    return out;
  }

  /** Free copies per base card = owned - reserved by built decks (other than excludeId). */
  function availableTotals(state, excludeId) {
    const owned = ownedTotals(state.owned, state.settings && state.settings.includeParallels);
    const reserved = reservedTotals(state.decks, excludeId);
    const out = {};
    for (const id of new Set([...Object.keys(owned), ...Object.keys(reserved)])) {
      out[id] = (owned[id] || 0) - (reserved[id] || 0);
    }
    return out;
  }

  /** How much of a deck the free cards cover. */
  function deckStatus(entries, available) {
    let need = 0, have = 0;
    const rows = entries.map(e => {
      const free = Math.max(0, available[e.id] || 0);
      const h = Math.min(e.count, free);
      need += e.count; have += h;
      return { id: e.id, need: e.count, have: h, missing: e.count - h, free };
    });
    return { rows, need, have, missing: need - have, pct: need ? have / need : 0 };
  }

  /** Rule check: 1 leader, 50 cards, max 4 per card number, colours match the leader. */
  function validateDeck(entries, cardsById) {
    const issues = [];
    const leaders = entries.filter(e => cardsById[e.id] && normCategory(cardsById[e.id].category) === 'LEADER');
    const leaderId = leaderOf(entries, cardsById);
    if (leaders.length === 0 && !leaderId) issues.push('未有領航卡（Leader）');
    if (leaders.length > 1 || (leaders.length === 1 && leaders[0].count > 1)) issues.push('領航卡只可有 1 張');
    const main = entries.filter(e => e.id !== leaderId);
    const total = main.reduce((s, e) => s + e.count, 0);
    if (total !== 50) issues.push('主牌組須為 50 張，現有 ' + total + ' 張');
    for (const e of main) if (e.count > 4) issues.push(e.id + ' 超過 4 張（' + e.count + '）');
    const lc = leaderId && cardsById[leaderId] ? cardColors(cardsById[leaderId]) : [];
    if (lc.length) {
      for (const e of main) {
        const c = cardsById[e.id];
        if (!c) continue;
        const cc = cardColors(c);
        if (cc.length && !cc.some(x => lc.includes(x))) issues.push(e.id + ' 的顏色（' + cc.join('/') + '）與領航卡不符');
      }
    }
    const unknown = entries.filter(e => !cardsById[e.id]).map(e => e.id);
    if (unknown.length && Object.keys(cardsById).length) issues.push('卡表中沒有以下卡：' + unknown.join(', '));
    return issues;
  }

  function cardColors(card) {
    if (Array.isArray(card.colors) && card.colors.length) return card.colors;
    return String(card.color || '').split(/[\/／、,\s]+/).filter(Boolean);
  }

  /**
   * Remove a sold deck's cards from the collection. Base cards go first; parallels
   * are only used when includeParallels is on. Returns the new owned map and any
   * cards that were short.
   */
  function sellDeck(owned, entries, includeParallels) {
    const next = Object.assign({}, owned);
    const shortfall = [];
    for (const e of entries) {
      let left = e.count;
      const ids = [e.id].concat(includeParallels
        ? Object.keys(next).filter(k => k !== e.id && baseId(k) === e.id).sort() : []);
      for (const id of ids) {
        if (isInf(next[id])) { left = 0; break; } // plenty: nothing to count down
        const take = Math.min(left, next[id] || 0);
        if (take > 0) {
          next[id] -= take; left -= take;
          if (!next[id]) delete next[id];
        }
        if (!left) break;
      }
      if (left) shortfall.push({ id: e.id, count: left });
    }
    return { owned: next, shortfall };
  }

  /** Cards still to buy / pull to finish several decks together (they compete for the same free copies). */
  function shoppingList(deckList, available) {
    const need = {};
    for (const d of deckList) for (const e of d.entries) need[e.id] = (need[e.id] || 0) + e.count;
    return Object.keys(need).sort()
      .map(id => ({ id, need: need[id], free: Math.max(0, available[id] || 0), missing: need[id] - Math.max(0, available[id] || 0) }))
      .filter(r => r.missing > 0);
  }

  // ------------------------------------------------------------ prices
  const round = n => Math.round(n * 10) / 10;

  /** Price change from a [[date, value], ...] history: latest vs the last point at least `days` older. */
  function historyChange(history, days) {
    if (!history || history.length < 2) return null;
    const [lastDate, last] = history[history.length - 1];
    const cutoff = new Date(new Date(lastDate).getTime() - (days || 7) * 864e5).toISOString().slice(0, 10);
    let prev = null;
    for (const h of history) if (h[0] <= cutoff) prev = h;
    if (!prev) prev = history[0];
    if (prev[0] === lastDate) return null;
    return { from: prev[1], to: last, since: prev[0] };
  }

  /**
   * Price lookup. A manual price (HKD) wins over the bot price (JPY x rate x factor).
   * opts: { manual: {id: {hkd, at, history}}, bot: {id: {jpy, history, url, stock}}, rate, factor }
   * Returns id -> { hkd, source: 'manual'|'bot', jpy, url, stock, at, change: {from, to, since} } or null.
   */
  function makePricer(opts) {
    const manual = opts.manual || {}, bot = opts.bot || {};
    const k = (opts.rate || 0) * (opts.factor == null ? 1 : opts.factor);
    return function price(id) {
      const m = manual[id];
      const b = bot[id];
      if (m && m.hkd != null && m.hkd !== '') {
        const ch = historyChange(m.history);
        return { hkd: Number(m.hkd), source: 'manual', at: m.at, url: b && b.url, jpy: b && b.jpy, change: ch,
          history: (m.history || []).map(h => [h[0], Number(h[1])]) };
      }
      if (b && b.jpy != null && k > 0) {
        const ch = historyChange(b.history);
        const last = b.history && b.history.length ? b.history[b.history.length - 1][0] : '';
        return { hkd: round(b.jpy * k), source: 'bot', jpy: b.jpy, url: b.url, stock: b.stock, at: last,
          change: ch && { from: round(ch.from * k), to: round(ch.to * k), since: ch.since },
          history: (b.history || []).map(h => [h[0], round(h[1] * k)]) };
      }
      return null;
    };
  }

  /** Market cost of a deck (normal versions). Cards without a price are listed in `unknown`. */
  function deckCost(entries, price) {
    let cost = 0;
    const unknown = [];
    for (const e of entries) {
      const p = price(baseId(e.id));
      if (p) cost += p.hkd * e.count; else unknown.push(e.id);
    }
    return { cost: round(cost), unknown };
  }

  /** Cost of the cards a deck is still missing. rows from deckStatus. */
  function missingCost(rows, price) {
    let cost = 0, unknown = 0;
    for (const r of rows) {
      if (!r.missing) continue;
      const p = price(r.id);
      if (p) cost += p.hkd * r.missing; else unknown += r.missing;
    }
    return { cost: round(cost), unknown };
  }

  /** Value of the whole collection; parallels use their own price. */
  /**
   * Value of a collection. altTotal counts SEC, 異圖 and SP cards (_p ids, plus any card
   * alwaysCount(id) picks, which the app uses for SEC): shop prices of normal
   * cards and same-picture reprints (_r) are far above what they really sell for, so a total of
   * every card overstates what the collection is worth. bigTotal counts every card (normal or not)
   * whose unit price is at least minUnit HKD, e.g. normal SR / SEC cards but no cheap commons, plus
   * any card alwaysCount(id) picks whatever its price (the app passes every SEC card).
   * A count of ∞ is valued as a playset of 4. Graded cards (PSA / CGC / BGS) with a price are added to
   * every total: they are worth what their grade sells for, whatever the card.
   */
  function collectionValue(owned, price, minUnit, alwaysCount, graded) {
    const min = Number(minUnit) || 50;
    let total = 0, priced = 0, unpriced = 0, altTotal = 0, altCopies = 0, bigTotal = 0, bigCopies = 0;
    let gradedTotal = 0, gradedCount = 0, gradedUnpriced = 0;
    for (const g of graded || []) {
      gradedCount++;
      const v = Number(g.price);
      if (g.price === '' || g.price == null || !(v >= 0)) { gradedUnpriced++; continue; }
      gradedTotal += v;
    }
    for (const [id, raw] of Object.entries(owned || {})) {
      const n = countable(raw);
      if (!(n > 0)) continue;
      const p = price(id);
      if (p) { total += p.hkd * n; priced += n; } else unpriced += n;
      if (/_p\d+$/i.test(id) || (alwaysCount && alwaysCount(id))) { altCopies += n; if (p) altTotal += p.hkd * n; }
      if (p && (p.hkd >= min || (alwaysCount && alwaysCount(id)))) { bigTotal += p.hkd * n; bigCopies += n; }
    }
    return {
      total: round(total + gradedTotal), priced, unpriced,
      altTotal: round(altTotal + gradedTotal), altCopies: altCopies + gradedCount,
      bigTotal: round(bigTotal + gradedTotal), bigCopies: bigCopies + gradedCount, minUnit: min,
      gradedTotal: round(gradedTotal), gradedCount, gradedUnpriced,
    };
  }

  // ------------------------------------------------------------ search
  const COLOR_WORDS = {
    '紅': '紅', '红': '紅', red: '紅', '綠': '綠', '绿': '綠', green: '綠', '藍': '藍', '蓝': '藍', blue: '藍',
    '紫': '紫', purple: '紫', '黑': '黑', black: '黑', '黃': '黃', '黄': '黃', yellow: '黃',
  };
  const CAT_WORDS = {
    leader: 'LEADER', '領航': 'LEADER', character: 'CHARACTER', chara: 'CHARACTER', '角色': 'CHARACTER',
    event: 'EVENT', '事件': 'EVENT', stage: 'STAGE', '場地': 'STAGE',
  };
  const RARITY_WORDS = ['L', 'C', 'UC', 'R', 'SR', 'SEC', 'SP', 'TR', 'P'];

  function range(s) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(s);
    if (!m) return null;
    return [Number(m[1]), m[2] ? Number(m[2]) : Number(m[1])];
  }

  /**
   * Smart search: "Luffy OP17, c5, p6000".
   *   OP17 / EB02 / PRB01 / ST21  set          c5, c3-5      cost (or life for leaders)
   *   p6000, p5000-7000           power        k1000         counter
   *   SR / SEC / L / UC ...       rarity       紅 / red ...  colour
   *   leader / 領航 / event ...   category     有 / 未有     owned or not
   *   異圖 / 平行 / alt           other versions (異圖, SP, 重印)   anything else: name, number, type or effect text
   */
  function parseQuery(q) {
    const out = { text: [], sets: [], rarities: [], colors: [], cats: [], cost: null, power: null, counter: null, owned: null, alt: null, fresh: null };
    for (const raw of String(q || '').split(/[\s,，、]+/)) {
      const t = raw.trim();
      if (!t) continue;
      const low = t.toLowerCase();
      const up = t.toUpperCase().replace(/^(OP|ST|EB|PRB)-?(\d{1,2})$/, (m, a, b) => a + b.padStart(2, '0'));
      let m;
      if (/^(OP|ST|EB|PRB)\d{2}$/.test(up) || /^DON(!!)?$/.test(up)) out.sets.push(up.replace('!!', ''));
      else if (normId(t) && normId(t).length >= t.length - 1) out.text.push(normId(t).toLowerCase());
      else if ((m = /^c(\d+(?:-\d+)?)$/i.exec(t)) && range(m[1])) out.cost = range(m[1]);
      else if ((m = /^p(\d{3,5}(?:-\d{3,5})?)$/i.exec(t)) && range(m[1])) out.power = range(m[1]);
      else if ((m = /^k(\d{1,4}(?:-\d{1,4})?)$/i.exec(t)) && range(m[1])) out.counter = range(m[1]);
      else if (RARITY_WORDS.includes(up)) out.rarities.push(up);
      else if (COLOR_WORDS[low]) out.colors.push(COLOR_WORDS[low]);
      else if (CAT_WORDS[low]) out.cats.push(CAT_WORDS[low]);
      else if (['有', 'have', 'owned'].includes(low)) out.owned = true;
      else if (['未有', 'missing', '!have', 'need'].includes(low)) out.owned = false;
      else if (['異圖', '异图', '平行', 'alt', 'parallel'].includes(low)) out.alt = true;
      else if (['新', 'new'].includes(low)) out.fresh = true;
      else out.text.push(low);
    }
    return out;
  }

  function inRange(v, r) { return v != null && v >= r[0] && v <= r[1]; }

  /** Does a card match a parsed query? ownedCount is how many copies the user has of this exact id. */
  function matchCard(card, q, ownedCount) {
    if (q.sets.length && !q.sets.some(s => setOf(card.id) === s || card.set === s || (card.series || []).some(x => x.code === s))) return false;
    if (q.rarities.length && !q.rarities.includes(normRarity(card.rarity).toUpperCase())) return false;
    if (q.colors.length && !q.colors.every(c => cardColors(card).includes(c))) return false;
    if (q.cats.length && !q.cats.includes(normCategory(card.category))) return false;
    if (q.cost && !inRange(card.cost != null ? card.cost : card.life, q.cost)) return false;
    if (q.power && !inRange(card.power, q.power)) return false;
    if (q.counter && !inRange(card.counter || 0, q.counter)) return false;
    if (q.owned === true && !(ownedCount > 0)) return false;
    if (q.owned === false && ownedCount > 0) return false;
    if (q.alt && card.id === baseId(card.id)) return false;
    if (q.fresh && !card.isNew) return false;
    if (q.text.length) {
      const hay = [card.id, card.name, card.feature, card.text, card.trigger, card.attribute].join(' ').toLowerCase();
      if (!q.text.every(t => hay.includes(t))) return false;
    }
    return true;
  }

  // -------------------------------------------------------------- sets
  const SET_GROUPS = [
    ['OP', '補充包'], ['EB', '特殊補充包'], ['PRB', '高級補充包'], ['ST', '起始牌組'], ['P', '推廣卡'], ['DON', 'DON!!卡'],
  ];
  function setGroup(code) {
    const prefix = String(code || '').replace(/\d+$/, '');
    const g = SET_GROUPS.find(x => x[0] === prefix);
    return g ? g[1] : '其他';
  }

  /** Is a card part of a set (its own number, or listed in that series on the official site)? */
  function inSet(card, code) {
    // A 異圖 / SP / 重印 belongs only to the series it was released in (the official list names it),
    // e.g. EB01-009_r1 is a PRB02 card and is not shown under EB01. Normal versions keep their number's
    // series as well as any series that lists them.
    if (card.id !== baseId(card.id) && (card.series || []).length) return card.series.some(s => seriesCode(s) === code);
    return setOf(card.id) === code || (card.series || []).some(s => s.code === code);
  }

  /** Series a card was released in: for a 異圖 / SP / 重印 the one the official list names, else its number's. */
  function releasedIn(card) {
    if (card.id !== baseId(card.id)) {
      const codes = (card.series || []).map(seriesCode).filter(Boolean);
      if (codes.length) return codes[0];
    }
    return setOf(card.id);
  }

  /**
   * Collection progress for one set. Normal cards count by card number; parallels
   * are a separate bucket and only count towards the total when includeParallels.
   */
  function setProgress(cards, owned, code, includeParallels) {
    const byRarity = {};
    let total = 0, have = 0, copies = 0;
    for (const c of cards) {
      if (!inSet(c, code)) continue;
      const alt = c.id !== baseId(c.id);
      if (alt && !includeParallels) continue;
      const key = alt ? variantLabel(c) : (normRarity(c.rarity) || '?');
      const n = owned[c.id] || 0;
      byRarity[key] = byRarity[key] || { total: 0, have: 0 };
      byRarity[key].total++; total++;
      copies += countable(n);
      if (n > 0) { byRarity[key].have++; have++; }
    }
    return { code, total, have, copies, pct: total ? have / total : 0, byRarity };
  }

  /**
   * Bulk change for many cards at once (e.g. every C card of a series after opening a box).
   * mode 'add': add n to each; mode 'set': set each to n. Never below 0.
   * Returns the new owned map and `prev` (id -> old count, 0 when absent) for undo.
   */
  function bulkSet(owned, ids, mode, n) {
    const next = Object.assign({}, owned);
    const prev = {};
    n = isInf(n) ? INF : Math.max(0, Math.floor(Number(n) || 0));
    for (const id of ids) {
      const old = next[id] || 0;
      const val = mode === 'set' ? n : (isInf(old) || isInf(n) ? INF : old + n);
      prev[id] = old;
      if (val > 0) next[id] = val; else delete next[id];
    }
    return { owned: next, prev };
  }

  /**
   * Add n sealed boxes of a product (a starter deck) whose contents are `recipe` (card id -> copies in
   * one box); a negative n takes boxes away, e.g. after adding one too many. ∞ stays ∞, and no count
   * goes below 0: `short` lists the cards that had fewer than were taken away.
   * Returns { owned, prev, kinds, copies, short }; `prev` is for undoBulk.
   */
  function addBoxes(owned, recipe, n) {
    n = Math.trunc(Number(n) || 0);
    const next = Object.assign({}, owned);
    const prev = {}, short = [];
    let kinds = 0, copies = 0;
    for (const [id, per] of Object.entries(recipe || {})) {
      const k = Math.floor(Number(per) || 0);
      if (k <= 0 || !n) continue;
      const old = next[id] || 0;
      prev[id] = old;
      kinds++;
      copies += k * n;
      if (isInf(old)) continue;
      let val = old + k * n;
      if (val < 0) { short.push(id); val = 0; }
      if (val > 0) next[id] = val; else delete next[id];
    }
    return { owned: next, prev, kinds, copies, short };
  }

  /** Box contents from a pasted list ("4xST29-002", "ST29-001 1" ...), versions kept apart: id -> copies. */
  function recipeFromText(text) {
    const out = {};
    for (const e of parseDeckText(text, { keepVariants: true }).entries) out[e.id] = e.count;
    return out;
  }

  /** Copies in one box. */
  function recipeTotal(recipe) {
    return Object.values(recipe || {}).reduce((t, k) => t + Math.max(0, Math.floor(Number(k) || 0)), 0);
  }

  /** Undo a bulkSet: put back the counts it replaced. */
  function undoBulk(owned, prev) {
    const next = Object.assign({}, owned);
    for (const [id, old] of Object.entries(prev || {})) {
      if (old > 0) next[id] = old; else delete next[id];
    }
    return next;
  }

  /** Set code of a card: 'OP08-001' -> 'OP08', 'P-001' -> 'P'. */
  function setOf(id) {
    return String(id || '').split('-')[0].toUpperCase();
  }

  /**
   * Code of an official series. A few have none on the site (推廣卡, 家庭牌組套裝, 限定商品收錄卡牌):
   * 推廣卡 joins the P cards, the others get 'X' + the site's series number so they stay apart.
   */
  function seriesCode(s) {
    s = s || {};
    if (s.code) return s.code;
    if (/推廣|プロモ|promo/i.test(s.label || '')) return 'P';
    return s.value ? 'X' + s.value : '';
  }

  // ------------------------------------------------------------ graded cards
  /** Grading companies and the grades they give, best first. */
  const GRADERS = {
    PSA: ['10', '9', '8', '7', '6', '5', '4', '3', '2', '1'],
    BGS: ['10 Black Label', '10 Pristine', '9.5', '9', '8.5', '8', '7.5', '7', '6'],
    CGC: ['10 Pristine', '10', '9.5', '9', '8.5', '8', '7.5', '7', '6'],
  };
  function gradeOptions(company) { return GRADERS[company] || []; }
  /**
   * Where to look up what a graded copy sells for: sold eBay listings and PriceCharting, searched
   * by card number and grade (e.g. "OP01-120 PSA 10"). Prices there are in USD.
   */
  function gradedSearchUrls(id, company, grade) {
    const q = `${baseId(id)} ${company} ${grade}`.trim();
    const enc = encodeURIComponent(q).replace(/%20/g, '+');
    return {
      query: q,
      ebay: `https://www.ebay.com/sch/i.html?_nkw=${enc}&LH_Sold=1&LH_Complete=1`,
      pricecharting: `https://www.pricecharting.com/search-products?q=${enc}&type=prices`,
    };
  }

  const api = {
    normId, baseId, normRarity, variantLabel, seriesCode, INF, INF_COPIES, isInf, countable, fmtQty, parseQty, totalCopies,
    GRADERS, gradeOptions, gradedSearchUrls, quickId, parseDeckText, deckToText, toDg, normCategory, leaderOf,
    ownedTotals, reservedTotals, availableTotals, deckStatus, validateDeck, cardColors,
    sellDeck, shoppingList, setOf, historyChange, makePricer, deckCost, missingCost, collectionValue,
    parseQuery, matchCard, SET_GROUPS, setGroup, inSet, releasedIn, setProgress, bulkSet, undoBulk, addBoxes, recipeFromText, recipeTotal, isoDate, deckMetaFromUrl, parseDeckImports,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OPCGEngine = api;
})(typeof self !== 'undefined' ? self : this);
