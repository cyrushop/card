/* OPCG collection app (UI). Logic lives in engine.js. */
(function () {
  'use strict';
  const E = window.OPCGEngine;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ------------------------------------------------------------ data
  const CARDS = (window.OPCG_CARDS && window.OPCG_CARDS.cards) || [];
  const META = (window.OPCG_DECKS && window.OPCG_DECKS.decks) || [];
  const PRICES = window.OPCG_PRICES || { prices: {} };
  const DEFAULT_RATE = 0.049; // JPY -> HKD (mid-Aug 2026); the price bot refreshes it
  const byId = {};
  for (const c of CARDS) {
    c.rarity = E.normRarity(c.rarity);
    for (const s of c.series || []) if (s) s.code = E.seriesCode(s);
    byId[c.id] = c;
  }
  for (const s of (window.OPCG_CARDS && window.OPCG_CARDS.series) || []) if (s) s.code = E.seriesCode(s);
  // What the last update found (shown for 14 days).
  const LAST_UPDATE = (window.OPCG_CARDS && window.OPCG_CARDS.lastUpdate) || {};
  const UPDATE_RECENT = LAST_UPDATE.at && (Date.now() - new Date(LAST_UPDATE.at).getTime()) < 14 * 864e5;
  const NEW_SERIES = new Set(UPDATE_RECENT ? (LAST_UPDATE.newSeries || []).map(x => x.code) : []);
  for (const id of (UPDATE_RECENT ? LAST_UPDATE.newCards || [] : [])) if (byId[id]) byId[id].isNew = true;
  const variantsOf = {};
  for (const c of CARDS) (variantsOf[E.baseId(c.id)] = variantsOf[E.baseId(c.id)] || []).push(c.id);

  const setRank = s => ({ OP: 0, EB: 1, PRB: 2, ST: 3, P: 4 }[s.replace(/\d+/g, '')] ?? 5);
  // Newest first (for drop-downs).
  function setSort(a, b) { return setRank(a) - setRank(b) || b.localeCompare(a, 'en', { numeric: true }); }
  const SETS = Array.from(new Set(CARDS.map(c => c.set || E.setOf(c.id)).filter(Boolean))).sort(setSort);

  // Oldest first (for the set browser, like a binder).
  const SET_CODES = Array.from(new Set(CARDS.flatMap(c => [E.setOf(c.id)].concat((c.series || []).map(x => x.code)))
    .filter(Boolean))).sort((a, b) => setRank(a) - setRank(b) || a.localeCompare(b, 'en', { numeric: true }));
  const SERIES_LABEL = {};
  for (const x of ((window.OPCG_CARDS && window.OPCG_CARDS.series) || [])) if (x.code && !SERIES_LABEL[x.code]) SERIES_LABEL[x.code] = x.label;
  const COLOR_HEX = { '紅': 'red', '红': 'red', Red: 'red', '綠': 'green', '绿': 'green', Green: 'green', '藍': 'blue', '蓝': 'blue', Blue: 'blue',
    '紫': 'purple', Purple: 'purple', '黑': 'black', Black: 'black', '黃': 'yellow', '黄': 'yellow', Yellow: 'yellow' };
  const COLORS = Array.from(new Set(CARDS.flatMap(c => E.cardColors(c)))).filter(Boolean);
  const CATS = { LEADER: '領航', CHARACTER: '角色', EVENT: '事件', STAGE: '場地' };
  const RARITIES = Array.from(new Set(CARDS.map(c => c.rarity).filter(Boolean)));

  // ----------------------------------------------------------- state
  const DEMO = !!window.OPCG_DEMO;
  // The demo keeps its own copy so it never reads or overwrites the real app's browser data on the same site.
  const LS_KEY = DEMO ? 'opcg-demo-state-v1' : 'opcg-state-v1';
  const serverMode = location.protocol.startsWith('http') && !DEMO;
  let state = blankState();
  let saveTimer = null;

  function blankState() {
    return { version: 1, owned: {}, decks: [], manualPrices: {}, openLog: [],
      settings: { includeParallels: false, quickSet: '', rate: '', factor: 1, valuableMin: 50,
        autoUpdate: { mode: 'manual', every: 'daily', cards: true, prices: true, decks: true } } };
  }
  function normalise(s) {
    const b = blankState();
    s = s && typeof s === 'object' ? s : {};
    return {
      version: 1,
      owned: s.owned && typeof s.owned === 'object' ? s.owned : {},
      decks: Array.isArray(s.decks) ? s.decks : [],
      manualPrices: s.manualPrices && typeof s.manualPrices === 'object' ? s.manualPrices : {},
      settings: Object.assign(b.settings, s.settings || {}),
      openLog: Array.isArray(s.openLog) ? s.openLog.slice(0, 200) : [],
      savedAt: s.savedAt,
      rev: s.rev,
    };
  }
  function readLocal() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { return null; }
  }
  async function fetchServerState() {
    const r = await fetch('/api/state', { cache: 'no-store' });
    if (r.status === 401) { location.reload(); throw new Error('login'); }
    const j = await r.json();
    if (!j.ok) throw new Error('server');
    return j.state;
  }
  async function load() {
    const local = readLocal();
    if (serverMode) {
      try {
        const srv = await fetchServerState();
        // The file on the computer is the master copy; the browser copy is only used if the file is empty.
        state = normalise(srv || local);
        if (!srv) state.rev = 0;
        setSaveLabel('已連接本機伺服器 · 資料儲存於 data/collection.json');
        return;
      } catch (e) { /* not running serve.py: fall back to the browser */ }
    }
    serverOk = false;
    state = normalise(local || (DEMO ? window.OPCG_DEMO_STATE : null));
    setSaveLabel(DEMO ? '示範版 · 修改只儲存於本機' : '資料儲存於瀏覽器（請記得在「設定」匯出備份）');
  }
  let saving = false, dirty = false, serverOk = serverMode;
  function save() {
    state.savedAt = new Date().toISOString();
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* storage full or blocked */ }
    if (!serverOk) return;
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 400);
  }
  // One request at a time, so each save carries the revision the server last gave us.
  async function flush() {
    if (saving || !dirty) return;
    saving = true; dirty = false;
    try {
      const r = await fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 409 && j.state) {
        state = normalise(j.state);
        try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
        dirty = false;
        toast('另一部裝置剛修改了資料，已載入最新版本，請重新進行最後一項修改');
        render();
      } else if (r.ok && j.ok) {
        state.rev = j.rev;
        try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
        setSaveLabel('已儲存 ' + new Date().toLocaleTimeString());
      } else {
        setSaveLabel('儲存失敗（伺服器）');
        dirty = true;
      }
    } catch (e) {
      setSaveLabel('儲存失敗：伺服器未啟動？資料仍保存在瀏覽器');
      dirty = true;
    } finally {
      saving = false;
      if (dirty) saveTimer = setTimeout(flush, 1500);
    }
  }
  // Coming back to the tab (e.g. on the phone): pick up changes made on the other device.
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !serverOk || dirty || saving) return;
    try {
      const srv = await fetchServerState();
      if (srv && (srv.rev || 0) > (state.rev || 0)) { state = normalise(srv); render(); toast('已同步最新資料'); }
    } catch (e) { /* offline */ }
  });
  function setSaveLabel(t) { $('#save-state').textContent = t; }

  /** In-page confirm / prompt. Resolves true/false, or the typed text / null when opts.input. */
  function ask(message, opts) {
    opts = opts || {};
    const dlg = $('#ask');
    $('#ask-msg').textContent = message;
    const input = $('#ask-input');
    input.hidden = !opts.input;
    input.value = opts.value == null ? '' : opts.value;
    input.type = opts.type || 'text';
    $('#ask-ok').textContent = opts.ok || '確定';
    $('#ask-ok').classList.toggle('danger', !!opts.danger);
    return new Promise(resolve => {
      let finished = false;
      // Resolve on a later task, so a follow-up ask() opens only after this key press / click is fully handled.
      // Otherwise the rest of the Enter key press lands on the next dialog's focused button and answers it.
      const done = v => {
        if (finished) return;
        finished = true;
        dlg.close();
        setTimeout(() => resolve(v), 0);
      };
      $('#ask-ok').onclick = () => done(opts.input ? input.value : true);
      $('#ask-cancel').onclick = () => done(opts.input ? null : false);
      dlg.oncancel = e => { e.preventDefault(); done(opts.input ? null : false); };
      input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); done(input.value); } };
      dlg.showModal();
      setTimeout(() => (opts.input ? input : $('#ask-ok')).focus(), 0);
    });
  }
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2200);
  }

  // ------------------------------------------------------- helpers
  const settings = () => state.settings;
  const available = excludeId => E.availableTotals(state, excludeId);
  const ownedOf = id => state.owned[id] || 0;
  function setOwned(id, n) {
    n = Math.max(0, n | 0);
    if (n) state.owned[id] = n; else delete state.owned[id];
    save();
  }
  function rate() { return Number(settings().rate) || PRICES.jpyToHkd || DEFAULT_RATE; }
  function pricer() {
    return E.makePricer({ manual: state.manualPrices, bot: PRICES.prices, rate: rate(), factor: Number(settings().factor) || 1 });
  }
  /** A collection-level total; masked when the viewer chose to hide totals. */
  function total(n) {
    return settings().hideTotal ? '<span class="masked" title="已隱藏">HK$ ••••</span>' : hk(n);
  }
  function eyeButton() {
    const hidden = !!settings().hideTotal;
    return `<button class="eye" data-hide="1" aria-pressed="${hidden}" title="${hidden ? '顯示總值' : '隱藏總值'}" aria-label="${hidden ? '顯示總值' : '隱藏總值'}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>${hidden ? '<path d="M4 4l16 16"/>' : ''}</svg></button>`;
  }
  function hk(n) {
    if (n == null || n === '' || isNaN(n)) return '—';
    const v = Math.round(Number(n) * 10) / 10;
    return (v < 0 ? '−' : '') + 'HK$' + Math.abs(v).toLocaleString();
  }
  function changeHtml(ch) {
    if (!ch || !ch.from) return '';
    const pct = (ch.to - ch.from) / ch.from * 100;
    if (Math.abs(pct) < 0.5) return '<span class="muted">±0%</span>';
    return `<span class="${pct > 0 ? 'ok' : 'bad'}" title="由 ${esc(ch.since)} ${hk(ch.from)}">${pct > 0 ? '▲' : '▼'}${Math.abs(pct).toFixed(0)}%</span>`;
  }
  function setManualPrice(id, value) {
    const today = new Date().toISOString().slice(0, 10);
    if (value === '' || value == null || isNaN(Number(value))) { delete state.manualPrices[id]; save(); return; }
    const m = state.manualPrices[id] || { history: [] };
    m.hkd = Number(value); m.at = today;
    m.history = (m.history || []).filter(h => h[0] !== today).concat([[today, m.hkd]]).slice(-180);
    state.manualPrices[id] = m;
    save();
  }
  function shopUrl(id) {
    const p = PRICES.prices[id];
    return (p && p.url) || 'https://yuyu-tei.jp/sell/opc/s/search?search_word=' + encodeURIComponent(E.baseId(id));
  }
  /** Badge after a card's rarity in lists: 異圖 / 重印. SP cards need none: their rarity already reads SP. */
  function altBadge(c) {
    const v = E.variantLabel(c);
    return v && v !== c.rarity ? ` <span class="badge">${v}</span>` : '';
  }
  function cardName(id) { const c = byId[id] || byId[E.baseId(id)]; return c ? c.name : ''; }
  function imgSrc(id) {
    const c = byId[id] || byId[E.baseId(id)];
    if (!c) return '';
    return c.localImage || c.image || '';
  }
  function imgTag(id, cls) {
    const c = byId[id] || byId[E.baseId(id)];
    const src = imgSrc(id);
    const remote = c && c.localImage && c.image ? c.image : '';
    if (!src) return `<span class="ph">${esc(id)}</span>`;
    // The card number shows only if the image fails (the error handler below reveals it). It used to sit
    // behind the image and showed through the dimmed picture of cards not owned yet.
    return `<img loading="lazy" referrerpolicy="no-referrer" alt="${esc(id + ' ' + (c ? c.name : ''))}" src="${esc(src)}"${remote ? ` data-remote="${esc(remote)}"` : ''} class="${cls || ''}"><span class="ph" hidden>${esc(id)}</span>`;
  }
  // Fall back to the official image when a local copy is missing; hide broken images.
  document.addEventListener('error', ev => {
    const img = ev.target;
    if (!(img instanceof HTMLImageElement)) return;
    if (img.dataset.remote && img.src !== img.dataset.remote) { img.src = img.dataset.remote; return; }
    img.style.display = 'none';
    const ph = img.nextElementSibling;
    if (ph && ph.classList.contains('ph')) ph.hidden = false;
  }, true);

  function dots(card) {
    return `<span class="dots">${E.cardColors(card || {}).map(c => `<i class="dot" title="${esc(c)}" style="background:var(--${COLOR_HEX[c] || 'muted'})"></i>`).join('')}</span>`;
  }
  /** Progress ring (SVG). */
  /** Short name for a series: its code (OP08), or for the few without one, its name (家庭牌組套裝). */
  function setName(code) {
    return /^X\d/.test(code) ? String(SERIES_LABEL[code] || code).replace(/【.*?】/g, '').trim() : code;
  }
  function ring(pct, size, label) {
    const r = size / 2 - 3, c = 2 * Math.PI * r, v = Math.max(0, Math.min(1, pct || 0));
    return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-label="${Math.round(v * 100)}%">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-bg"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-fg" stroke-dasharray="${(c * v).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
      ${label != null ? `<text x="50%" y="50%" dominant-baseline="central" text-anchor="middle">${esc(label)}</text>` : ''}</svg>`;
  }
  /** Small price-trend line from [[date, value], ...]. */
  function sparkline(history, w, h) {
    if (!history || history.length < 2) return '<span class="muted" style="font-size:12px">歷史資料不足，未能繪製走勢（BOT 每次更新會新增一點）</span>';
    w = w || 260; h = h || 56;
    const vals = history.map(x => Number(x[1]));
    const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
    const pts = vals.map((v, i) => `${(i / (vals.length - 1) * (w - 4) + 2).toFixed(1)},${(h - 4 - (v - min) / span * (h - 8)).toFixed(1)}`).join(' ');
    const up = vals[vals.length - 1] >= vals[0];
    return `<svg class="spark ${up ? 'up' : 'down'}" viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" role="img"
      aria-label="由 ${esc(history[0][0])} ${hk(vals[0])} 至 ${esc(history[history.length - 1][0])} ${hk(vals[vals.length - 1])}"><polyline points="${pts}"/></svg>
      <div class="spark-axis muted"><span>${esc(history[0][0])}</span><span>低 ${hk(min)} · 高 ${hk(max)}</span><span>${esc(history[history.length - 1][0])}</span></div>`;
  }
  /** Effect text with 【keyword】 brackets shown as chips. */
  const KW = [
    ['k-play', /登場時|攻擊時|被KO時|回合結束時|對方回合中|自己回合中|對方的攻擊時|On Play|When Attacking|On K\.?O\.?|Opponent's Turn|Your Turn|End of Your Turn/],
    ['k-act', /啟動|起動|主要|反擊|Activate|Main|Counter/],
    ['k-once', /每回合1次|1回合1次|Once Per Turn/],
    ['k-trig', /觸發|Trigger/],
    ['k-kw', /阻擋者|速攻|雙重攻擊|消滅|Blocker|Rush|Double Attack|Banish/],
    ['k-don', /咚|DON|ドン/],
  ];
  /** Effect text with 【keyword】 chips (colours by kind) and 《type》 names in bold. */
  function effectHtml(text) {
    return esc(text || '')
      .replace(/【([^】]{1,20})】/g, (m, k) => `<span class="kw ${(KW.find(x => x[1].test(k)) || ['k-other'])[0]}">${k}</span>`)
      .replace(/《([^》]{1,24})》/g, '<b class="ftype">《$1》</b>')
      .replace(/\n/g, '<br>');
  }
  function triggerHtml(t) {
    if (!t) return '';
    return /^\s*【(觸發|トリガー|Trigger)】/.test(t) ? effectHtml(t) : `<span class="kw k-trig">觸發</span> ${effectHtml(t)}`;
  }
  function costPower(c) {
    if (!c) return '';
    const bits = [];
    if (c.life != null) bits.push('生命 ' + c.life);
    else if (c.cost != null) bits.push('費 ' + c.cost);
    if (c.power) bits.push(c.power);
    if (c.counter) bits.push('反擊 ' + c.counter);
    return bits.join(' · ');
  }
  function barClass(p) { return p >= 0.999 ? '' : p >= 0.8 ? 'mid' : 'low'; }
  function uid() { return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function noDataNotice(what) {
    return `<div class="notice"><b>未有${what}資料。</b> 請在電腦執行 BOT：
      <pre>python3 bot/scrape_cards.py --images\npython3 bot/scrape_decks.py</pre>
      或執行 <code>python3 serve.py</code>，開啟 http://localhost:8765，在「設定」按「更新」。</div>`;
  }

  // ------------------------------------------------------------- tabs
  const TABS = ['home', 'collection', 'sets', 'open', 'meta', 'mine', 'value', 'settings'];
  const MORE = ['collection', 'value', 'meta', 'settings'];
  let current = 'home';
  function showTab(name) {
    if (name === 'more') { $('#sheet').hidden = !$('#sheet').hidden; return; }
    $('#sheet').hidden = true;
    current = name;
    $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
    $$('#bottom button').forEach(b => b.classList.toggle('on', b.dataset.tab === name || (b.dataset.tab === 'more' && MORE.includes(name))));
    $$('.tab').forEach(s => s.classList.toggle('on', s.id === 'tab-' + name));
    render();
    window.scrollTo(0, 0);
    try { localStorage.setItem('opcg-tab', name); } catch (e) { /* ignore */ }
  }
  for (const nav of ['#tabs', '#bottom', '#sheet']) {
    $(nav).addEventListener('click', e => {
      const b = e.target.closest('button');
      if (b) showTab(b.dataset.tab);
      else if (nav === '#sheet') $('#sheet').hidden = true;
    });
  }
  function render() {
    ({ home: renderHome, collection: renderCollection, sets: renderSets, open: renderOpen, meta: renderMeta,
      mine: renderMine, value: renderValue, settings: renderSettings })[current]();
  }

  const SEARCH_HELP = `<b>搜尋語法</b>（以空格或逗號分隔，可混合使用）
    <table class="help-table">
      <tr><td><code>OP08</code> <code>EB02</code></td><td>系列</td></tr>
      <tr><td><code>c5</code> <code>c3-5</code></td><td>費用（領航卡為生命值）</td></tr>
      <tr><td><code>p6000</code></td><td>力量值</td></tr>
      <tr><td><code>k1000</code></td><td>反擊值</td></tr>
      <tr><td><code>SR</code> <code>SEC</code> <code>L</code></td><td>稀有度</td></tr>
      <tr><td><code>紅</code> <code>red</code></td><td>顏色</td></tr>
      <tr><td><code>領航</code> <code>事件</code></td><td>類別</td></tr>
      <tr><td><code>有</code> <code>未有</code></td><td>已擁有／未擁有</td></tr>
      <tr><td><code>異圖</code></td><td>只顯示異圖、SP 及重印</td></tr>
      <tr><td><code>新</code></td><td>最近更新的新卡</td></tr>
      <tr><td>其他字詞</td><td>名稱、卡號、特徵、效果</td></tr>
    </table>例如：<code>路飛 OP08 c5 p6000</code>`;
  /** A small "?" button that shows its explanation only when tapped. */
  let helpSeq = 0;
  function help(html, label) {
    const id = 'help-' + (++helpSeq);
    const name = esc(label || '說明');
    return `<span class="help-wrap"><button type="button" class="help-btn" aria-expanded="false" aria-controls="${id}" aria-label="${name}" title="${name}">?</button><span class="help-pop" id="${id}" role="note" hidden>${html}</span></span>`;
  }
  function closeHelps(except) {
    $$('.help-btn[aria-expanded="true"]').forEach(b => {
      if (b === except) return;
      b.setAttribute('aria-expanded', 'false');
      const pop = document.getElementById(b.getAttribute('aria-controls'));
      if (pop) pop.hidden = true;
    });
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('.help-btn');
    if (!b) {
      const pop = e.target.closest('.help-pop');
      if (pop && e.target.closest('summary')) e.preventDefault(); // reading the help must not fold the panel
      if (!pop || !e.target.closest('a')) closeHelps(); // tapping the box (or anywhere else) closes it
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const pop = document.getElementById(b.getAttribute('aria-controls'));
    const open = b.getAttribute('aria-expanded') !== 'true';
    closeHelps(b);
    b.setAttribute('aria-expanded', String(open));
    pop.hidden = !open;
    if (open) { // keep the box on screen
      pop.style.transform = '';
      const r = pop.getBoundingClientRect(), pad = 12;
      const shift = r.right > innerWidth - pad ? innerWidth - pad - r.right : r.left < pad ? pad - r.left : 0;
      if (shift) pop.style.transform = `translateX(${shift}px)`;
    }
  }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeHelps(); });
  function openCollection(q) {
    cf.q = q || ''; cf.set = ''; cf.color = ''; cf.cat = ''; cf.rarity = ''; cf.owned = ''; cf.limit = 120;
    const el = $('#tab-collection');
    if (el.dataset.ready) for (const k of ['q', 'set', 'color', 'cat', 'rarity', 'owned']) $('#cf-' + k).value = cf[k];
    showTab('collection');
  }

  // ======================================================== COLLECTION
  const cf = { q: '', set: '', color: '', cat: '', rarity: '', owned: '', sort: 'id', limit: 120 };
  function collectionItems() {
    const ids = new Set(CARDS.map(c => c.id));
    for (const id of Object.keys(state.owned)) ids.add(id);
    const q = E.parseQuery(cf.q);
    const reserved = E.reservedTotals(state.decks);
    let list = Array.from(ids).map(id => byId[id] || { id, name: '', set: E.setOf(id), colors: [], unknown: true });
    list = list.filter(c => {
      if (cf.set && (c.set || E.setOf(c.id)) !== cf.set && !(c.series || []).some(s => s.code === cf.set)) return false;
      if (cf.color && !E.cardColors(c).includes(cf.color)) return false;
      if (cf.cat && c.category !== cf.cat) return false;
      if (cf.rarity && c.rarity !== cf.rarity) return false;
      if (cf.owned === 'have' && !ownedOf(c.id)) return false;
      if (cf.owned === 'none' && ownedOf(c.id)) return false;
      if (cf.owned === 'spare' && !(ownedOf(c.id) > 4)) return false;
      if (cf.owned === 'reserved' && !reserved[E.baseId(c.id)]) return false;
      return E.matchCard(c, q, ownedOf(c.id));
    });
    const cmpId = (a, b) => a.id.localeCompare(b.id, 'en', { numeric: true });
    if (cf.sort === 'owned') list.sort((a, b) => ownedOf(b.id) - ownedOf(a.id) || cmpId(a, b));
    else if (cf.sort === 'cost') list.sort((a, b) => (a.cost ?? -1) - (b.cost ?? -1) || cmpId(a, b));
    else if (cf.sort === 'price') { const pr = pricer(); const v = c => (pr(c.id) || { hkd: -1 }).hkd; list.sort((a, b) => v(b) - v(a) || cmpId(a, b)); }
    else list.sort(cmpId);
    return list;
  }
  function renderCollection() {
    const el = $('#tab-collection');
    if (!el.dataset.ready) {
      const opt = (v, l) => `<option value="${esc(v)}">${esc(l)}</option>`;
      el.innerHTML = `
        ${CARDS.length ? '' : noDataNotice('卡表')}
        <div class="toolbar">
          <input type="search" id="cf-q" placeholder="例如：路飛 OP08 c5 p6000 紅 SR 有">${help(SEARCH_HELP, '搜尋語法')}
          <button class="filter-toggle" id="cf-ft">篩選</button>
          <div class="filters">
          <select id="cf-set"><option value="">全部系列</option>${SETS.map(s => opt(s, s)).join('')}</select>
          <select id="cf-color"><option value="">全部顏色</option>${COLORS.map(c => opt(c, c)).join('')}</select>
          <select id="cf-cat"><option value="">全部類別</option>${Object.entries(CATS).map(([k, v]) => opt(k, v)).join('')}</select>
          <select id="cf-rarity"><option value="">全部稀有度</option>${RARITIES.map(r => opt(r, r)).join('')}</select>
          <select id="cf-owned"><option value="">全部</option><option value="have">已擁有</option><option value="none">未擁有</option><option value="spare">多於 4 張</option><option value="reserved">已預留給牌組</option></select>
          <select id="cf-sort"><option value="id">按編號</option><option value="owned">按數量</option><option value="cost">按費用</option><option value="price">按價格</option></select>
          </div>
        </div>
        <div class="stats" id="cf-stats"></div>
        <div class="grid" id="cf-grid"></div>
        <button class="more" id="cf-more">顯示更多</button>`;
      el.dataset.ready = '1';
      for (const k of ['q', 'set', 'color', 'cat', 'rarity', 'owned', 'sort']) {
        const input = $('#cf-' + k);
        input.value = cf[k];
        input.addEventListener(k === 'q' ? 'input' : 'change', () => { cf[k] = input.value; cf.limit = 120; drawGrid(); });
      }
      $('#cf-more').addEventListener('click', () => { cf.limit += 240; drawGrid(); });
      $('#cf-ft').addEventListener('click', () => el.querySelector('.toolbar').classList.toggle('show-filters'));
      $('#cf-grid').addEventListener('click', onGridClick);
    }
    drawGrid();
  }
  function drawGrid() {
    const list = collectionItems();
    const reserved = E.reservedTotals(state.decks);
    const totalCopies = Object.values(state.owned).reduce((s, n) => s + n, 0);
    const distinct = Object.keys(state.owned).length;
    $('#cf-stats').innerHTML = `<span>總共 <b>${totalCopies}</b> 張 · <b>${distinct}</b> 款</span>
      <span>符合篩選 <b>${list.length}</b> 款</span>
      <span>預留給已組建牌組 <b>${Object.values(reserved).reduce((s, n) => s + n, 0)}</b> 張</span>`;
    const price = pricer();
    $('#cf-grid').innerHTML = list.slice(0, cf.limit).map(c => tileHtml(c, reserved, price)).join('');
    $('#cf-more').style.display = list.length > cf.limit ? '' : 'none';
  }
  function tileHtml(c, reserved, price) {
    const n = ownedOf(c.id);
    const p = (price || pricer())(c.id);
    const r = c.id === E.baseId(c.id) ? reserved[c.id] || 0 : 0;
    return `<div class="tile${n ? ' has' : ''}" data-id="${esc(c.id)}">
      <div class="img" data-act="detail">${imgTag(c.id)}${n ? `<span class="own-badge">×${n}</span>` : ''}${E.variantLabel(c) ? `<span class="alt-badge">${E.variantLabel(c)}</span>` : ''}${c.isNew ? '<span class="new-badge">新</span>' : ''}</div>
      <div class="meta">${esc(c.id)} <span class="muted">${esc(c.rarity || '')}</span> ${dots(c)}</div>
      <div class="meta name" title="${esc(c.name)}">${esc(c.name || (c.unknown ? '（卡表沒有資料）' : ''))}</div>
      <div class="sub">${p ? `<b class="price">${hk(p.hkd)}</b> ${changeHtml(p.change)} ` : ''}${r ? `預留 ${r} · 可用 ${Math.max(0, n - r)}` : ''}</div>
      <div class="qty"><button data-act="dec" aria-label="減一">−</button><span class="n${n ? '' : ' zero'}">${n}</span><button data-act="inc" aria-label="加一">+</button></div>
    </div>`;
  }
  function onGridClick(e) {
    const btn = e.target.closest('[data-act]');
    const tile = e.target.closest('.tile');
    if (!btn || !tile) return;
    const id = tile.dataset.id;
    if (btn.dataset.act === 'detail') return showDetail(id);
    setOwned(id, ownedOf(id) + (btn.dataset.act === 'inc' ? 1 : -1));
    tile.outerHTML = tileHtml(byId[id] || { id, unknown: true }, E.reservedTotals(state.decks));
    const totalCopies = Object.values(state.owned).reduce((s, n) => s + n, 0);
    const b = $('#cf-stats b'); if (b) b.textContent = totalCopies;
  }

  function showDetail(id) {
    const c = byId[id] || { id };
    const base = E.baseId(id);
    const usedIn = state.decks.filter(d => d.status !== 'sold' && d.entries.some(e => e.id === base));
    const vars = Array.from(new Set([base].concat(variantsOf[base] || [], Object.keys(state.owned).filter(k => E.baseId(k) === base))))
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    const price = pricer();
    const p = price(id);
    const reserved = E.reservedTotals(state.decks)[base] || 0;
    const isLeader = E.normCategory(c.category) === 'LEADER';
    const tile = (k, v, extra) => v || v === 0 ? `<div class="stat"><span>${k}</span><b>${extra || esc(v)}</b></div>` : '';
    const setCode = E.setOf(id);
    // 普通 / 異圖 1 / 異圖 2 / SP / 重印: numbered only when one kind appears more than once.
    const kindOf = v => v === base ? '普通' : E.variantLabel(byId[v] || { id: v });
    const label = v => {
      const same = vars.filter(x => kindOf(x) === kindOf(v));
      return same.length > 1 ? `${kindOf(v)} ${same.indexOf(v) + 1}` : kindOf(v);
    };
    $('#modal-body').innerHTML = `<div class="cd">
      <div class="cd-left">
        <div class="cd-img">${imgSrc(id) ? `<img referrerpolicy="no-referrer" src="${esc(imgSrc(id))}" alt="${esc((c.name || '') + ' ' + id)}">` : `<span class="ph">${esc(id)}</span>`}</div>
        ${vars.length > 1 ? `<div class="alts">${vars.map(v => `<button class="alt${v === id ? ' on' : ''}" data-detail="${esc(v)}" title="${esc(v)}">
          <div class="thumb">${imgTag(v)}</div><span>${esc(label(v))}</span></button>`).join('')}</div>` : ''}
      </div>
      <div class="cd-right">
        <div class="chips">${c.category ? `<span class="chip">${esc(CATS[c.category] || c.categoryRaw || c.category)}</span>` : ''}<span class="chip">${esc(id)}</span>
          ${c.rarity ? `<span class="chip strong">${esc(c.rarity)}</span>` : ''}${setCode ? `<button class="chip link" data-goset="${esc(setCode)}">${esc(setCode)} ›</button>` : ''}</div>
        <h2>${esc(c.name || id)}</h2>
        ${c.feature ? `<div class="muted">${esc(c.feature)}</div>` : ''}
        <div class="stats-tiles">
          ${isLeader ? tile('生命值', c.life) : tile('費用', c.cost)}${tile('力量值', c.power)}${tile('反擊值', c.counter == null ? (c.category ? '-' : null) : c.counter)}
          ${tile('顏色', c.color, c.color ? dots(c) + ' ' + esc(c.color) : '')}${tile('屬性', c.attribute)}${tile('擴張記號', c.block)}
        </div>
        <div class="box">
          <div class="box-head"><span>價格${id === base ? '' : `（此${esc(kindOf(id))}）`}</span>
            <span>${p ? `<b class="big price">${hk(p.hkd)}</b> ${changeHtml(p.change)}` : '<span class="muted">未有價格</span>'}</span></div>
          ${p ? `<div class="muted small">${p.source === 'manual' ? `手動價 · ${esc(p.at || '')}` : `悠々亭 ¥${Number(p.jpy).toLocaleString()} × ${rate()}${Number(settings().factor) !== 1 ? ' × ' + esc(settings().factor) : ''} · ${esc(p.at || '')}${p.stock === 0 ? ' · 缺貨' : ''}`}</div>
            ${sparkline(p.history)}` : ''}
          <div class="toolbar" style="margin:8px 0 0">
            <input class="mp" data-mp="${esc(id)}" type="number" min="0" step="1" placeholder="手動價 HK$" value="${esc((state.manualPrices[id] || {}).hkd ?? '')}" style="width:130px">
            <a href="${esc(shopUrl(id))}" target="_blank" rel="noopener">悠々亭 ›</a></div>
        </div>
        <div class="box">
          <div class="box-head"><span>我的收藏</span><span class="muted">${vars.reduce((t, v) => t + ownedOf(v), 0)} 張${reserved ? ` · 預留 ${reserved}` : ''}</span></div>
          ${vars.map(v => { const vp = price(v); return `<div class="own-row${v === id ? ' on' : ''}">
            <span class="grow">${esc(label(v))} <span class="muted">${esc(v)}</span></span>
            <span class="muted small">${vp ? hk(vp.hkd) : ''}</span>
            <span class="cnt"><button class="small" data-d="${esc(v)}" data-n="-1" aria-label="減一">−</button><b>${ownedOf(v)}</b><button class="small primary" data-d="${esc(v)}" data-n="1" aria-label="加一">+</button></span>
          </div>`; }).join('')}
        </div>
        ${c.text || c.trigger ? `<div class="box effect">${effectHtml(c.text)}${c.trigger ? `<div style="margin-top:6px">${triggerHtml(c.trigger)}</div>` : ''}</div>` : ''}
        ${c.getInfo ? `<div class="muted small">獲取方法：${esc(c.getInfo)}</div>` : ''}
        ${!c.text && !CARDS.length ? '<div class="notice small">未有官方中文效果：請先執行卡表 BOT（asia-tc.onepiece-cardgame.com）。</div>' : ''}
        ${usedIn.length ? `<div class="box"><div class="box-head"><span>用於我的牌組</span></div>${usedIn.map(d => `<div class="own-row"><span class="grow">${esc(d.name)}</span><span class="muted small">${d.entries.find(e => e.id === base).count} 張 · ${statusLabel(d.status)}</span></div>`).join('')}</div>` : ''}
      </div></div>`;
    $('#modal-body').onchange = e => {
      const m = e.target.closest('[data-mp]');
      if (!m) return;
      setManualPrice(m.dataset.mp, m.value);
      showDetail(id);
      render();
    };
    $('#modal-body').onclick = e => {
      const g = e.target.closest('[data-goset]');
      if (g) { $('#modal').close(); sv.set = g.dataset.goset; showTab('sets'); return; }
      const b = e.target.closest('[data-d]');
      if (!b) return;
      setOwned(b.dataset.d, ownedOf(b.dataset.d) + Number(b.dataset.n));
      showDetail(id);
      if (current === 'collection') drawGrid();
      else if (current === 'sets' || current === 'home') render();
    };
    const dlg = $('#modal');
    if (!dlg.open) dlg.showModal();
  }

  function updateNoticeHtml() {
    if (!UPDATE_RECENT) return '';
    const ns = LAST_UPDATE.newSeries || [], nc = (LAST_UPDATE.newCards || []).length;
    const imgs = (LAST_UPDATE.newImages || 0) + (LAST_UPDATE.updatedImages || 0);
    if (!ns.length && !nc && !imgs) return '';
    return `<div class="notice update-notice"><b>最近更新（${esc(String(LAST_UPDATE.at).slice(0, 10))}）</b>：
      ${ns.length ? `新系列 ${ns.map(x => `<button class="chip link" data-set="${esc(x.code)}">${esc(x.code || x.label)}</button>`).join(' ')}；` : ''}
      ${nc ? `新卡 <button class="chip link" data-fresh="1">${nc} 張 ›</button>；` : ''}
      ${imgs ? `卡圖新增 ${LAST_UPDATE.newImages || 0} 張、更新 ${LAST_UPDATE.updatedImages || 0} 張` : ''}</div>`;
  }
  /** Run the card bot in update mode from the home page and show its progress there. */
  async function runUpdate(btn) {
    const box = $('#h-update');
    btn.disabled = true;
    box.hidden = false;
    box.textContent = '正在連接官方網站…';
    try {
      await fetch('/api/bot/update', { method: 'POST' });
    } catch (e) { box.textContent = '無法連接本機伺服器。請用 OPCG-Start.command 開啟本程式。'; btn.disabled = false; return; }
    const tick = async () => {
      let job;
      try { job = ((await (await fetch('/api/bot', { cache: 'no-store' })).json()).jobs || {}).update; } catch (e) { job = null; }
      if (!job) { setTimeout(tick, 1500); return; }
      const lines = (job.log || '').trim().split('\n').filter(Boolean);
      box.textContent = lines.slice(-1)[0] || '處理中…';
      if (job.running) { setTimeout(tick, 1500); return; }
      if (job.code === 0) {
        const res = lines.slice(lines.findIndex(l => l.startsWith('更新結果'))).join('　');
        box.textContent = res || '更新完成';
        toast('更新完成，正在重新載入…');
        setTimeout(() => location.reload(), 1800);
      } else {
        box.textContent = '更新失敗：' + (lines.slice(-1)[0] || '') + '　詳情見「設定」中的記錄。';
        btn.disabled = false;
      }
    };
    tick();
  }

  // =============================================================== HOME
  function renderHome() {
    const el = $('#tab-home');
    const price = pricer();
    const totalCopies = Object.values(state.owned).reduce((t, n) => t + n, 0);
    const value = E.collectionValue(state.owned, price);
    const mySets = SET_CODES.map(code => E.setProgress(CARDS, state.owned, code, false)).filter(x => x.total);
    const started = mySets.filter(x => x.have);
    const homeSets = mySets.slice().sort((a, b) => setSort(a.code, b.code)); // every series, newest first
    const allTotal = mySets.reduce((t, x) => t + x.total, 0);
    const recent = [];
    for (const x of state.openLog) if (!recent.includes(x.id)) { recent.push(x.id); if (recent.length >= 16) break; }
    const decks = state.decks.filter(d => d.status !== 'sold');
    const top = Object.keys(state.owned).map(id => ({ id, p: price(id) })).filter(x => x.p).sort((a, b) => b.p.hkd - a.p.hkd).slice(0, 12);
    const counts = st => state.decks.filter(d => d.status === st).length;
    el.innerHTML = `
      ${DEMO ? '<div class="demo-banner"><b>示範版</b>：卡圖、卡名、效果、價格及牌組均為示範資料（斯摩格 OP10-001 及 RG Luffy 卡表除外）。在此所作的修改只儲存於本機。正式版本請在電腦執行 <code>python3 serve.py</code>。</div>' : (CARDS.length ? '' : noDataNotice('卡表'))}
      <div class="hero-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
        <input type="search" id="h-q" placeholder="路飛 OP08, c5, p6000…" autocomplete="off" enterkeyhint="search">${help(SEARCH_HELP, '搜尋語法')}</div>
      <div id="h-results"></div>
      <div class="kpis">
        <div class="kpi" role="button" tabindex="0" data-go="collection"><span>我的卡</span><b>${totalCopies.toLocaleString()}</b><small>${Object.keys(state.owned).length} 款</small></div>
        <div class="kpi" role="button" tabindex="0" data-go="value"><span>總值 ${eyeButton()}</span><b class="price">${total(value.total)}</b><small>${value.unpriced ? value.unpriced + ' 張未有價格' : '全部已有價格'}</small></div>
        <div class="kpi" role="button" tabindex="0" data-go="sets"><span>系列收集</span><b>${allTotal ? Math.round(started.reduce((t, x) => t + x.have, 0) / allTotal * 100) : 0}%</b><small>${started.length}/${mySets.length} 個系列已有卡</small></div>
        <div class="kpi" role="button" tabindex="0" data-go="mine"><span>牌組</span><b>${counts('plan')} / ${counts('built')} / ${counts('sold')}</b><small>計劃中 / 已組好 / 已售出</small></div>
      </div>
      ${updateNoticeHtml()}
      <section class="home-sec"><div class="sec-head"><h2>全部系列 <span class="count">${mySets.length}</span></h2>
        <div class="actions">${serverOk ? '<button class="see" data-update="1">檢查新系列及卡圖</button>' : ''}<button class="see" data-go="sets">按類別查看 ›</button></div></div>
        <div id="h-update" class="muted small" hidden></div>
        ${homeSets.length ? `<div class="hscroll">${homeSets.map(x => `<button class="setcard${x.have ? '' : ' empty'}" data-set="${esc(x.code)}" title="${esc(SERIES_LABEL[x.code] || x.code)}">${NEW_SERIES.has(x.code) ? '<span class="new-badge">新</span>' : ''}${ring(x.pct, 54, Math.round(x.pct * 100) + '%')}
          <b>${esc(x.code)}</b><small>${x.have}/${x.total}</small></button>`).join('')}</div>` : '<p class="muted">未有卡表。執行卡表 BOT 後，所有系列都會在此顯示。</p>'}</section>
      ${recent.length ? `<section class="home-sec"><div class="sec-head"><h2>最近加入</h2><button class="see" data-go="open">開箱 ›</button></div>
        <div class="hscroll">${recent.map(id => `<button class="mini" data-detail="${esc(id)}"><div class="thumb">${imgTag(id)}</div><small>${esc(id)}</small></button>`).join('')}</div></section>` : ''}
      <section class="home-sec"><div class="sec-head"><h2>我的牌組 <span class="count">${decks.length}</span></h2><button class="see" data-go="mine">全部 ›</button></div>
        ${decks.length ? `<div class="hscroll">${decks.map(d => {
          const lead = E.leaderOf(d.entries, byId);
          const st = E.deckStatus(d.entries, available(d.id));
          return `<button class="deckcard" data-deck="${esc(d.id)}"><div class="grow"><b>${esc(d.name)}</b><small>${st.have}/${st.need} · ${statusLabel(d.status)}</small>
            <div class="bar ${barClass(st.pct)}"><i style="width:${(st.pct * 100).toFixed(0)}%"></i></div></div><div class="thumb">${imgTag(lead || '?')}</div></button>`;
        }).join('')}</div>` : '<p class="muted">未有牌組。請到「熱門牌組」選擇一副。</p>'}</section>
      ${top.length ? `<section class="home-sec"><div class="sec-head"><h2>最高價的卡</h2><button class="see" data-go="value">高價卡 ›</button></div>
        <div class="hscroll">${top.map(x => `<button class="mini" data-detail="${esc(x.id)}"><div class="thumb">${imgTag(x.id)}</div><small class="price">${hk(x.p.hkd)}</small></button>`).join('')}</div></section>` : ''}`;
    const input = $('#h-q');
    let timer;
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => homeResults(input.value), 120); });
    el.onkeydown = e => {
      const k = e.target.closest('.kpi');
      if (k && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); showTab(k.dataset.go); }
    };
    input.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || !input.value.trim()) return;
      if (/[?&]dg=/i.test(input.value)) importDecks(input.value); else openCollection(input.value);
    });
    el.onclick = e => {
      if (e.target.closest('[data-hide]')) return; // the eye button is handled globally
      const go = e.target.closest('[data-go]');
      if (go) return showTab(go.dataset.go);
      const st = e.target.closest('[data-set]');
      if (st) { sv.set = st.dataset.set; return showTab('sets'); }
      const dk = e.target.closest('[data-deck]');
      if (dk) { mineOpen[dk.dataset.deck] = true; return showTab('mine'); }
      const all = e.target.closest('[data-all]');
      if (all) openCollection(input.value);
      const up = e.target.closest('[data-update]');
      if (up) runUpdate(up);
      const fresh = e.target.closest('[data-fresh]');
      if (fresh) openCollection('新');
    };
  }
  function homeResults(text) {
    const box = $('#h-results');
    if (!text.trim()) { box.innerHTML = ''; return; }
    if (/[?&]dg=|^\s*\d+\s*x\s*(OP|ST|EB|PRB)/im.test(text)) {
      box.innerHTML = `<div class="panel"><h3>已識別牌組</h3>${importPreview(text)}
        <div class="actions" style="margin-top:8px"><button class="primary" data-import="1">匯入至「我的牌組」</button></div></div>`;
      box.querySelector('[data-import]').onclick = () => importDecks(text);
      return;
    }
    const q = E.parseQuery(text);
    const hits = CARDS.filter(c => E.matchCard(c, q, ownedOf(c.id)));
    const price = pricer();
    box.innerHTML = `<div class="sec-head"><h2>${hits.length} 個結果</h2>${hits.length > 24 ? `<button class="see" data-all="1">查看全部 ›</button>` : ''}</div>
      <div class="hscroll wrap">${hits.slice(0, 24).map(c => { const n = ownedOf(c.id), p = price(c.id); return `<button class="mini" data-detail="${esc(c.id)}">
        <div class="thumb">${imgTag(c.id)}${n ? `<span class="own-badge">×${n}</span>` : ''}</div><small>${esc(c.id)}</small>${p ? `<small class="price">${hk(p.hkd)}</small>` : ''}</button>`; }).join('')}</div>`;
  }

  // =============================================================== SETS
  const sv = { set: '', parallels: false, show: '', sort: 'id', mode: 'grid', rarity: '', bulkOpen: false,
    bulkRarity: 'C', bulkMode: 'add', bulkN: 1 };
  let lastBulk = null; // { set, prev, label } for undo
  try { sv.mode = localStorage.getItem('opcg-setmode') || 'grid'; } catch (e) { /* ignore */ }
  function renderSets() {
    const el = $('#tab-sets');
    if (!CARDS.length) { el.innerHTML = noDataNotice('卡表'); return; }
    return sv.set ? renderSetPage(el) : renderSetIndex(el);
  }
  function renderSetIndex(el) {
    // Only series that have cards with the current parallel setting. A card number from an old series can
    // appear only as a parallel reprint inside a newer one (e.g. OP01-016_p9 in EB05); such a "series"
    // is empty while parallels are hidden, and a category with nothing in it is left out too.
    const groups = {};
    for (const code of SET_CODES) {
      if (!E.setProgress(CARDS, state.owned, code, sv.parallels).total) continue;
      (groups[E.setGroup(code)] = groups[E.setGroup(code)] || []).push(code);
    }
    // Every category on one page, in the usual order: 補充包, 特殊補充包, 高級補充包, 起始牌組, 推廣卡, 其他.
    const order = E.SET_GROUPS.map(x => x[1]).concat('其他');
    const names = Object.keys(groups).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    el.innerHTML = `
      <label class="muted small"><input type="checkbox" id="sv-par"${sv.parallels ? ' checked' : ''}> 連同異圖及 SP 一併計算</label>
      ${names.map(g => {
        const prog = groups[g].map(code => E.setProgress(CARDS, state.owned, code, sv.parallels)).filter(x => x.total);
        const tot = prog.reduce((t, x) => t + x.total, 0), have = prog.reduce((t, x) => t + x.have, 0);
        return `<div class="panel"><div class="group-head">${ring(tot ? have / tot : 0, 46, Math.round(tot ? have / tot * 100 : 0) + '%')}<h2>${esc(g)}</h2>
          <span class="muted">${have}/${tot} 款</span></div>
          <div class="setgrid">${prog.map(x => `<button class="setdot" data-set="${esc(x.code)}" title="${esc(SERIES_LABEL[x.code] || x.code)}">${NEW_SERIES.has(x.code) ? '<span class="new-badge">新</span>' : ''}
            ${ring(x.pct, 58, /^X\d/.test(x.code) ? setName(x.code).slice(0, 4) : x.code.replace(/^(OP|EB|PRB|ST)/, '$1 '))}<small>${x.have}/${x.total}</small></button>`).join('')}</div></div>`;
      }).join('')}`;
    el.onclick = e => {
      const st = e.target.closest('[data-set]');
      if (st) { sv.set = st.dataset.set; renderSets(); window.scrollTo(0, 0); }
    };
    el.onchange = e => { if (e.target.id === 'sv-par') { sv.parallels = e.target.checked; renderSets(); } };
  }
  function setCards() {
    // Choosing SP / 異圖 / 重印 shows those versions even when "包括異圖及 SP" is off.
    const pickVersion = VERSION_KINDS.includes(sv.rarity);
    let list = CARDS.filter(c => E.inSet(c, sv.set) && (sv.parallels || pickVersion || c.id === E.baseId(c.id)));
    if (sv.rarity === 'SP') list = list.filter(c => c.rarity === 'SP');
    else if (pickVersion) list = list.filter(c => E.variantLabel(c) === sv.rarity);
    else if (sv.rarity) list = list.filter(c => (c.rarity || '') === sv.rarity);
    if (sv.show === 'have') list = list.filter(c => ownedOf(c.id));
    if (sv.show === 'none') list = list.filter(c => !ownedOf(c.id));
    const cmp = (a, b) => a.id.localeCompare(b.id, 'en', { numeric: true });
    if (sv.sort === 'price') { const pr = pricer(); const v = c => (pr(c.id) || { hkd: -1 }).hkd; list.sort((a, b) => v(b) - v(a) || cmp(a, b)); }
    else list.sort(cmp);
    return list;
  }
  const RAR_ORDER = ['L', 'C', 'UC', 'R', 'SR', 'SEC', 'SP', 'TR', 'P', '異圖', '重印'];
  const VERSION_KINDS = ['SP', '異圖', '重印'];
  function setSummaryHtml() {
    const x = E.setProgress(CARDS, state.owned, sv.set, sv.parallels);
    const rars = Object.keys(x.byRarity).sort((a, b) => (RAR_ORDER.indexOf(a) + 1 || 99) - (RAR_ORDER.indexOf(b) + 1 || 99));
    const value = E.collectionValue(Object.fromEntries(CARDS.filter(c => E.inSet(c, sv.set)).map(c => [c.id, ownedOf(c.id)])), pricer());
    return `<div class="set-head">
        <button class="back" data-back="1" aria-label="返回">‹</button>
        ${ring(x.pct, 64, Math.round(x.pct * 100) + '%')}
        <div class="grow"><h2>${esc(setName(sv.set))}</h2><div class="muted">${esc(SERIES_LABEL[sv.set] || E.setGroup(sv.set))}</div>
          <div class="small">${x.have}/${x.total} 款 · ${x.copies} 張 · 總值 <b class="price">${total(value.total)}</b> ${eyeButton()}</div></div>
      </div>
      <div class="rarity-row">${rars.map(r => `<div class="rar"><b>${x.byRarity[r].have}/${x.byRarity[r].total}</b><span>${esc(r)}</span></div>`).join('')}</div>`;
  }
  function batchRowHtml(c) {
    const n = ownedOf(c.id);
    return `<div class="brow${n ? ' has' : ''}" data-id="${esc(c.id)}">
      <div class="thumb" data-detail="${esc(c.id)}">${imgTag(c.id)}</div>
      <label class="grow" for="b-${esc(c.id)}"><b>${esc(c.id)}</b> <span class="muted">${esc(c.rarity || '')}</span>${altBadge(c)}
        <span class="bname">${esc(c.name || '')}</span></label>
      <input id="b-${esc(c.id)}" class="bnum" data-bid="${esc(c.id)}" value="${n || ''}" placeholder="0"
        inputmode="numeric" enterkeyhint="next" autocomplete="off" maxlength="3" aria-label="${esc(c.id)} 數量">
    </div>`;
  }
  /** Rarities present in the current series (normal versions), in the usual order. */
  function setRarities() {
    const have = new Set(CARDS.filter(c => E.inSet(c, sv.set) && c.id === E.baseId(c.id)).map(c => c.rarity || '').filter(Boolean));
    return Array.from(have).sort((a, b) => (RAR_ORDER.indexOf(a) + 1 || 99) - (RAR_ORDER.indexOf(b) + 1 || 99));
  }
  /** For the series filter: normal rarities, then SP / 異圖 / 重印 when the series has such versions. */
  function setFilterOptions() {
    const kinds = new Set(CARDS.filter(c => E.inSet(c, sv.set)).map(c => E.variantLabel(c)).filter(Boolean));
    const out = setRarities().concat(VERSION_KINDS.filter(k => kinds.has(k)));
    return Array.from(new Set(out)).sort((a, b) => (RAR_ORDER.indexOf(a) + 1 || 99) - (RAR_ORDER.indexOf(b) + 1 || 99));
  }
  function bulkIds(rarity) {
    return CARDS.filter(c => E.inSet(c, sv.set) && c.id === E.baseId(c.id) && (c.rarity || '') === rarity).map(c => c.id);
  }
  function bulkBarHtml() {
    const rars = setRarities();
    if (!rars.includes(sv.bulkRarity)) sv.bulkRarity = rars.includes('C') ? 'C' : (rars[0] || '');
    const undo = lastBulk && lastBulk.set === sv.set;
    return `<div class="bulk-bar" role="group" aria-label="按稀有度批量設定">
      <select id="bk-rarity" aria-label="稀有度">${rars.map(r => `<option${r === sv.bulkRarity ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select>
      <span class="small muted">共 ${bulkIds(sv.bulkRarity).length} 款</span>
      <select id="bk-mode" aria-label="方式"><option value="add"${sv.bulkMode === 'add' ? ' selected' : ''}>每款加</option><option value="set"${sv.bulkMode === 'set' ? ' selected' : ''}>每款設為</option></select>
      <input id="bk-n" type="number" min="0" max="99" step="1" value="${esc(sv.bulkN)}" inputmode="numeric" aria-label="張數" style="width:70px"> 張
      <button class="small primary" id="bk-apply">套用</button>
      ${undo ? `<button class="small" id="bk-undo">撤銷：${esc(lastBulk.label)}</button>` : ''}
      ${help('<b>開箱後點算普通卡（C）</b><br>1. 選「C」、「每款加」及你估計每款的張數，按「套用」。<br>2. 在上方稀有度選「C」，切換到「批量輸入」，逐張修正多出或不足的。<br>只會改動此系列的普通版，不影響異圖及 SP。按「撤銷」可還原上一次批量設定。', '批量設定說明')}
    </div>`;
  }
  async function applyBulk() {
    const ids = bulkIds(sv.bulkRarity);
    const n = Math.max(0, Math.floor(Number(sv.bulkN) || 0));
    if (!ids.length) { toast('此系列沒有這個稀有度的卡'); return; }
    if (sv.bulkMode === 'add' && n === 0) { toast('請輸入要加的張數'); return; }
    const label = `${sv.set} ${sv.bulkRarity} ${sv.bulkMode === 'add' ? '每款加 ' + n : '每款設為 ' + n} 張`;
    const ok = await ask(`把 ${sv.set} 的 ${sv.bulkRarity}（共 ${ids.length} 款）${sv.bulkMode === 'add' ? `每款加 ${n} 張` : `每款設為 ${n} 張`}？`, { ok: '套用' });
    if (!ok) return;
    const res = E.bulkSet(state.owned, ids, sv.bulkMode, n);
    state.owned = res.owned;
    lastBulk = { set: sv.set, prev: res.prev, label };
    save();
    toast(`已更新 ${ids.length} 款；如有錯可按「撤銷」`);
    renderSets();
  }
  function renderSetPage(el) {
    const batch = sv.mode === 'batch';
    el.innerHTML = `
      <div id="sp-summary">${setSummaryHtml()}</div>
      <div class="toolbar">
        <div class="seg" role="group" aria-label="顯示方式">
          <button data-mode="grid" class="${batch ? '' : 'on'}">卡圖</button><button data-mode="batch" class="${batch ? 'on' : ''}">批量輸入</button></div>
        ${help('<b>批量輸入</b><br>每張卡一個數字欄。輸入數量後按 <kbd>Enter</kbd> / <kbd>Tab</kbd> / <kbd>↓</kbd> 移至下一張，按 <kbd>↑</kbd> 返回上一張。留空即為 0，每次輸入均即時儲存。', '批量輸入說明')}
        <label class="small"><input type="checkbox" id="sp-par"${sv.parallels ? ' checked' : ''}> 包括異圖及 SP</label>
        <select id="sp-rarity" aria-label="稀有度"><option value="">全部稀有度</option>${setFilterOptions().map(r => `<option${r === sv.rarity ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select>
        <select id="sp-show"><option value="">全部</option><option value="have">已擁有</option><option value="none">未擁有（缺卡）</option></select>
        <select id="sp-sort"><option value="id">按編號</option><option value="price">按價格</option></select>
        <button class="small" id="sp-copy">複製缺卡清單</button>
        <button class="small${sv.bulkOpen ? ' primary' : ''}" id="sp-bulk-toggle" aria-expanded="${sv.bulkOpen}">按稀有度批量設定</button>
      </div>
      ${sv.bulkOpen ? bulkBarHtml() : ''}
      ${batch ? `<div class="batch" id="sp-batch">${setCards().map(batchRowHtml).join('')}</div>`
        : '<div class="grid" id="sp-grid"></div>'}`;
    $('#sp-show').value = sv.show; $('#sp-sort').value = sv.sort;
    if (!batch) {
      const reserved = E.reservedTotals(state.decks), price = pricer();
      $('#sp-grid').innerHTML = setCards().map(c => tileHtml(c, reserved, price)).join('');
    } else {
      const inputs = () => $$('.bnum', el);
      const move = (from, step) => {
        const all = inputs(), i = all.indexOf(from), next = all[i + step];
        if (next) { next.focus(); next.select(); next.scrollIntoView({ block: 'nearest' }); }
      };
      let sumTimer;
      const commit = input => {
        const clean = input.value.replace(/[^\d]/g, '').slice(0, 3);
        if (clean !== input.value) input.value = clean;
        const id = input.dataset.bid, n = clean === '' ? 0 : Number(clean);
        if (n === ownedOf(id)) return;
        setOwned(id, n);
        input.closest('.brow').classList.toggle('has', n > 0);
        clearTimeout(sumTimer);
        sumTimer = setTimeout(() => { $('#sp-summary').innerHTML = setSummaryHtml(); }, 250);
      };
      $('#sp-batch').addEventListener('input', e => { if (e.target.dataset.bid) commit(e.target); });
      $('#sp-batch').addEventListener('focusin', e => { if (e.target.dataset.bid) e.target.select(); });
      $('#sp-batch').addEventListener('keydown', e => {
        if (!e.target.dataset.bid) return;
        if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); move(e.target, 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); move(e.target, -1); }
      });
      const first = inputs()[0];
      if (first && matchMedia('(pointer: fine)').matches) first.focus();
    }
    el.onclick = e => {
      if (e.target.closest('[data-back]')) { sv.set = ''; sv.rarity = ''; return renderSets(); }
      const m = e.target.closest('[data-mode]');
      if (m) { sv.mode = m.dataset.mode; try { localStorage.setItem('opcg-setmode', sv.mode); } catch (err) { /* ignore */ } return renderSets(); }
      if (e.target.closest('#sp-bulk-toggle')) { sv.bulkOpen = !sv.bulkOpen; return renderSets(); }
      if (e.target.closest('#bk-apply')) return applyBulk();
      if (e.target.closest('#bk-undo') && lastBulk) {
        state.owned = E.undoBulk(state.owned, lastBulk.prev);
        toast('已撤銷：' + lastBulk.label);
        lastBulk = null; save(); return renderSets();
      }
      if (e.target.closest('#sp-copy')) {
        const miss = CARDS.filter(c => E.inSet(c, sv.set) && (sv.parallels || c.id === E.baseId(c.id)) && !ownedOf(c.id));
        return copyText(miss.map(c => `${c.id} ${c.rarity || ''} ${c.name || ''}`).join('\n'));
      }
      const btn = e.target.closest('[data-act]'), tile = e.target.closest('.tile');
      if (!btn || !tile) return;
      const id = tile.dataset.id;
      if (btn.dataset.act === 'detail') return showDetail(id);
      setOwned(id, ownedOf(id) + (btn.dataset.act === 'inc' ? 1 : -1));
      tile.outerHTML = tileHtml(byId[id] || { id }, E.reservedTotals(state.decks));
      $('#sp-summary').innerHTML = setSummaryHtml();
    };
    el.onkeydown = e => {
      if (e.target.id === 'bk-n' && e.key === 'Enter') { e.preventDefault(); sv.bulkN = e.target.value; applyBulk(); }
    };
    el.onchange = e => {
      if (e.target.dataset.bid) return;
      if (e.target.id === 'bk-rarity') { sv.bulkRarity = e.target.value; return renderSets(); }
      if (e.target.id === 'bk-mode') { sv.bulkMode = e.target.value; return; }
      if (e.target.id === 'bk-n') { sv.bulkN = e.target.value; return; }
      if (e.target.id === 'sp-rarity') sv.rarity = e.target.value;
      if (e.target.id === 'sp-par') sv.parallels = e.target.checked;
      if (e.target.id === 'sp-show') sv.show = e.target.value;
      if (e.target.id === 'sp-sort') sv.sort = e.target.value;
      renderSets();
    };
  }

  // ============================================================== OPEN
  function renderOpen() {
    const el = $('#tab-open');
    const set = settings().quickSet || SETS.find(s => /^OP/.test(s)) || '';
    el.innerHTML = `
      <div class="cols">
        <div class="panel quick">
          <h2>開箱快速輸入 ${help('輸入卡號後按 Enter，即加一張：<br><code>OP08-001</code>、<code>08-001</code>，或只輸入 <code>1</code>（使用預設系列）。<br>異圖或 SP：<code>001p1</code>。輸入錯了可在下方按「撤銷」。', '開箱說明')}</h2>
          <div class="toolbar">
            <label>預設系列 <select id="q-set"><option value="">（無）</option>${SETS.map(s => `<option${s === set ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
          </div>
          <input id="q-input" autocomplete="off" inputmode="text" placeholder="例如 045 或 OP09-118">
          <div id="q-preview" class="muted" style="min-height:22px;margin-top:6px"></div>
          <ul class="log" id="q-log"></ul>
        </div>
        <div class="panel">
          <h2>一次加入多張 ${help('每行一款：<code>OP08-001 x2</code>、<code>3 OP09-045</code>、<code>OP08-118_p1</code>。<br>異圖及 SP 會分開記錄。', '格式說明')}</h2>
          <textarea id="bulk" placeholder="OP08-001 x2&#10;OP08-045 x3"></textarea>
          <div class="actions" style="margin-top:8px"><button class="primary" id="bulk-add">加入卡庫</button><button id="bulk-sub">從卡庫扣除</button></div>
        </div>
      </div>`;
    const input = $('#q-input');
    const setSel = $('#q-set');
    setSel.addEventListener('change', () => { settings().quickSet = setSel.value; save(); });
    const preview = () => {
      const id = E.quickId(input.value, setSel.value);
      $('#q-preview').innerHTML = id ? `${esc(id)} ${esc(cardName(id))} <span class="${byId[id] ? 'ok' : 'warn'}">${byId[id] ? '' : (CARDS.length ? '（卡表中找不到，仍可加入）' : '')}</span> · 現有 ${ownedOf(id)} 張` : '';
    };
    input.addEventListener('input', preview);
    input.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const id = E.quickId(input.value, setSel.value);
      if (!id) { toast('無法辨識此卡號'); return; }
      setOwned(id, ownedOf(id) + 1);
      state.openLog.unshift({ id, at: Date.now() });
      state.openLog = state.openLog.slice(0, 200);
      save();
      input.value = ''; preview(); drawLog();
    });
    $('#q-log').addEventListener('click', e => {
      const b = e.target.closest('[data-undo]');
      if (!b) return;
      const i = Number(b.dataset.undo);
      const item = state.openLog[i];
      if (!item) return;
      setOwned(item.id, ownedOf(item.id) - 1);
      state.openLog.splice(i, 1); save(); drawLog();
    });
    const bulk = sign => {
      const { entries, unknown } = E.parseDeckText($('#bulk').value, { keepVariants: true });
      for (const e of entries) setOwned(e.id, ownedOf(e.id) + sign * e.count);
      toast(`${sign > 0 ? '加入' : '減去'} ${entries.reduce((s, e) => s + e.count, 0)} 張` + (unknown.length ? `，${unknown.length} 行無法辨識` : ''));
      if (!unknown.length) $('#bulk').value = ''; else $('#bulk').value = unknown.join('\n');
    };
    $('#bulk-add').addEventListener('click', () => bulk(1));
    $('#bulk-sub').addEventListener('click', () => bulk(-1));
    drawLog();
    setTimeout(() => input.focus(), 0);
  }
  function drawLog() {
    const today = new Date().toDateString();
    const todayCount = state.openLog.filter(x => new Date(x.at).toDateString() === today).length;
    $('#q-log').innerHTML = `<li class="muted">今日已加入 ${todayCount} 張</li>` + state.openLog.slice(0, 60).map((x, i) =>
      `<li><div class="thumb">${imgTag(x.id)}</div><div class="grow"><b>${esc(x.id)}</b> ${esc(cardName(x.id))}<br><span class="muted">現有 ${ownedOf(x.id)} 張 · ${new Date(x.at).toLocaleTimeString()}</span></div><button class="small" data-undo="${i}">撤銷</button></li>`).join('');
  }

  // ============================================================== META
  const mf = { q: '', color: '', sort: 'pct', limit: 60, open: {} };
  function renderMeta() {
    const el = $('#tab-meta');
    if (!META.length) {
      el.innerHTML = noDataNotice('熱門牌組') + importPanelHtml();
      bindImport($('#tab-meta'));
      return;
    }
    const src = window.OPCG_DECKS;
    el.innerHTML = `
      <div class="toolbar">
        <input type="search" id="mf-q" placeholder="搜尋 牌組 / 領航 / 作者 / 比賽">
        <select id="mf-color"><option value="">全部顏色</option>${COLORS.map(c => `<option>${esc(c)}</option>`).join('')}</select>
        ${fxButton()}
        <select id="mf-sort"><option value="pct">最齊卡優先</option><option value="missing">缺卡最少優先</option><option value="fill">補卡最便宜優先</option><option value="value">市值最高優先</option><option value="date">最新優先</option></select>
      </div>
      <div class="stats"><span>${META.length} 副牌組 · 來源 <a href="${esc(src.source)}" target="_blank" rel="noopener">${esc(src.source)}</a> · 更新 ${esc((src.scrapedAt || '').slice(0, 10))}</span></div>
      <div class="decks" id="mf-list"></div>
      <button class="more" id="mf-more">顯示更多</button>
      ${importPanelHtml(false)}`;
    for (const k of ['q', 'color', 'sort']) {
      const input = $('#mf-' + k);
      input.value = mf[k];
      input.addEventListener(k === 'q' ? 'input' : 'change', () => { mf[k] = input.value; mf.limit = 60; drawMeta(); });
    }
    $('#mf-more').addEventListener('click', () => { mf.limit += 60; drawMeta(); });
    $('#mf-list').addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const d = META.find(x => x.id === b.dataset.id);
      if (b.dataset.act === 'toggle') { mf.open[d.id] = !mf.open[d.id]; drawMeta(); }
      if (b.dataset.act === 'copy') addMyDeck(d.name || '熱門牌組', d.entries, { from: d.url, meta: d.id, author: d.author, date: d.date,
        placement: d.placement, event: d.event, eventType: d.eventType, country: d.country });
      if (b.dataset.act === 'text') copyText(E.deckToText(d.entries, byId));
    });
    bindImport($('#tab-meta'));
    drawMeta();
  }
  function drawMeta() {
    const avail = available();
    const price = pricer();
    const q = mf.q.trim().toLowerCase();
    let list = META.map(d => {
      const lead = d.leader || E.leaderOf(d.entries, byId);
      const main = d.entries.filter(e => e.id !== lead);
      const st = E.deckStatus(d.entries, avail);
      return Object.assign({}, d, { lead, st, mainCount: main.reduce((s, e) => s + e.count, 0),
        cost: E.deckCost(d.entries, price), fill: E.missingCost(st.rows, price) });
    }).filter(d => {
      if (mf.color && !E.cardColors(byId[d.lead] || {}).includes(mf.color)) return false;
      if (!q) return true;
      return [d.name, d.author, d.event, d.context, d.page, d.lead, cardName(d.lead)].some(x => String(x || '').toLowerCase().includes(q));
    });
    if (mf.sort === 'pct') list.sort((a, b) => b.st.pct - a.st.pct || a.st.missing - b.st.missing);
    if (mf.sort === 'missing') list.sort((a, b) => a.st.missing - b.st.missing);
    if (mf.sort === 'date') list.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    if (mf.sort === 'fill') list.sort((a, b) => a.fill.cost - b.fill.cost || a.st.missing - b.st.missing);
    if (mf.sort === 'value') list.sort((a, b) => b.cost.cost - a.cost.cost);
    $('#mf-list').innerHTML = list.slice(0, mf.limit).map(d => metaDeckHtml(d)).join('') || '<p class="muted">沒有符合的牌組</p>';
    $('#mf-more').style.display = list.length > mf.limit ? '' : 'none';
  }
  function metaDeckHtml(d) {
    const leadCard = byId[d.lead];
    const info = [d.placement, d.event, d.eventType && d.eventType !== d.event ? d.eventType : '', d.country, d.author && 'by ' + d.author, d.date].filter(Boolean).join(' · ');
    return `<div class="deck${mf.open[d.id] ? ' wide' : ''}">
      <div class="head"><div class="thumb">${imgTag(d.lead)}</div>
        <div class="grow"><div class="title">${esc(d.name || cardName(d.lead) || d.lead)}</div>
          <div class="muted">${esc(d.lead)} ${esc(leadCard ? leadCard.name : '')} ${dots(leadCard)}</div>
          <div class="muted" style="font-size:12px">${esc(info || d.context || d.page)}</div></div></div>
      <div class="bar ${barClass(d.st.pct)}"><i style="width:${(d.st.pct * 100).toFixed(0)}%"></i></div>
      <div>${d.st.have}/${d.st.need} 張 · ${d.st.missing ? `<span class="bad">欠 ${d.st.missing} 張</span>` : '<span class="ok">卡已齊，可以組建！</span>'}</div>
      ${costLine(d.cost, d.st.missing ? d.fill : null)}
      ${mf.open[d.id] ? rowsHtml(d.st.rows) : ''}
      <div class="actions"><button class="small" data-act="toggle" data-id="${esc(d.id)}">${mf.open[d.id] ? '收起' : '查看卡表'}</button>
        <button class="small primary" data-act="copy" data-id="${esc(d.id)}">加入我的牌組</button>
        <button class="small" data-act="text" data-id="${esc(d.id)}">複製文字</button>
        <a class="small muted" href="${esc(d.url)}" target="_blank" rel="noopener">來源</a></div>
    </div>`;
  }
  function costLine(cost, fill) {
    if (cost.cost === 0 && cost.unknown.length) return '<div class="muted small">未有價格</div>';
    const unk = cost.unknown.length ? ` <span class="muted">（${cost.unknown.length} 款未有價格）</span>` : '';
    return `<div class="muted" style="font-size:13px">市值 <b class="price">${hk(cost.cost)}</b>${unk}${fill ? ` · 補齊要 <b class="price">${hk(fill.cost)}</b>${fill.unknown ? ` +${fill.unknown} 張未有價格` : ''}` : ''}</div>`;
  }
  function rowsHtml(rows, editable) {
    const price = pricer();
    const sorted = rows.slice().sort((a, b) => {
      const ca = byId[a.id] || {}, cb = byId[b.id] || {};
      const la = ca.category === 'LEADER' ? 0 : 1, lb = cb.category === 'LEADER' ? 0 : 1;
      return la - lb || (ca.cost ?? 99) - (cb.cost ?? 99) || a.id.localeCompare(b.id);
    });
    const fx = !!settings().showEffects;
    return `<div class="rows${fx ? ' fx' : ''}">${sorted.map(r => `<div class="row${r.missing ? ' miss' : ''}">
      <div class="thumb" data-detail="${esc(r.id)}">${imgTag(r.id)}</div>
      <div class="grow"><b>${esc(r.id)}</b> ${esc(cardName(r.id))} <span class="muted small">${esc(costPower(byId[r.id]))}</span>
        ${fx ? `<div class="row-fx">${byId[r.id] && byId[r.id].text ? effectHtml(byId[r.id].text) : '<span class="muted">未有效果資料</span>'}${byId[r.id] && byId[r.id].trigger ? `<div>${triggerHtml(byId[r.id].trigger)}</div>` : ''}</div>` : ''}</div>
      <span class="muted rowprice">${(p => p ? hk(p.hkd) : '')(price(r.id))}</span>
      <span class="muted" title="可用（已扣除其他已組建牌組）">有 ${r.free}</span>
      ${editable ? `<span class="cnt"><button class="small" data-e="${esc(r.id)}" data-n="-1">−</button><b class="need">${r.need}</b><button class="small" data-e="${esc(r.id)}" data-n="1">+</button></span>`
        : `<b class="need">×${r.need}</b>`}
    </div>`).join('')}</div>`;
  }
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-detail]');
    if (t) return showDetail(t.dataset.detail);
    const fx = e.target.closest('[data-fx]');
    if (fx) { settings().showEffects = !settings().showEffects; save(); render(); }
    const hide = e.target.closest('[data-hide]');
    if (hide) { e.stopPropagation(); settings().hideTotal = !settings().hideTotal; save(); render(); }
  });
  function fxButton() {
    return `<button class="small${settings().showEffects ? ' primary' : ''}" data-fx="1">${settings().showEffects ? '隱藏中文效果' : '顯示中文效果'}</button>`;
  }
  function deckInfo(d) {
    const bits = [d.placement, d.event, d.eventType && d.eventType !== d.event ? d.eventType : '', d.country, d.author && 'by ' + d.author, d.date].filter(Boolean);
    const link = d.from || d.url;
    return bits.length || link ? `<div class="muted small">${esc(bits.join(' · '))}${link && /^https?:/.test(link) ? ` · <a href="${esc(link)}" target="_blank" rel="noopener">原牌組 ›</a>` : ''}</div>` : '';
  }
  function importPanelHtml(open) {
    return `<details class="panel import"${open ? ' open' : ''}><summary><b>＋ 貼上牌組連結或牌組清單</b> ${help('在 onepiecetopdecks 選好牌組後，複製其 <b>deckgen 連結</b>（可一次貼上多條，每行一條）或「Decklist in text」（<code>4xOP08-002</code>）並貼上。<br>牌組名稱、作者、名次、比賽及日期會自動讀入。', '匯入說明')}</summary>
      <textarea class="imp-text" aria-label="牌組連結或牌組清單" placeholder="https://onepiecetopdecks.com/deck-list/.../deckgen/?dn=...&amp;dg=1nOP13-001a4nOP13-016...&#10;或&#10;1xOP13-001&#10;4xOP13-016&#10;..."></textarea>
      <div class="imp-preview muted small"></div>
      <div class="actions" style="margin-top:8px"><input class="imp-name" placeholder="牌組名稱（可留空）" aria-label="牌組名稱" style="flex:1;min-width:0"><button class="primary imp-go">匯入</button></div></details>`;
  }
  function importDecks(text, nameOverride) {
    const found = E.parseDeckImports(text).filter(d => d.entries.length);
    if (!found.length) { toast('找不到卡號'); return 0; }
    const ids = [];
    for (const d of found) {
      const lead = E.leaderOf(d.entries, byId);
      const name = (found.length === 1 && nameOverride) || d.meta.name || cardName(lead) || lead || '新牌組';
      const meta = Object.assign({}, d.meta); delete meta.name;
      if (meta.url) { meta.from = meta.url; delete meta.url; }
      const deck = Object.assign({ id: uid(), name, entries: d.entries, status: 'plan', price: '', createdAt: new Date().toISOString() }, meta);
      state.decks.unshift(deck);
      ids.push(deck.id);
    }
    if (ids.length === 1) mineOpen[ids[0]] = true;
    mineImportOpen = false;
    save();
    const skipped = found.reduce((t, d) => t + d.unknown.filter(u => !/^decklist/i.test(u)).length, 0);
    toast(`已匯入 ${ids.length} 副牌組` + (skipped ? `，${skipped} 行無法辨識，已略過` : ''));
    if (current !== 'mine') showTab('mine'); else render();
    return ids.length;
  }
  function importPreview(text) {
    const found = E.parseDeckImports(text).filter(d => d.entries.length);
    const avail = available();
    return found.map(d => {
      const st = E.deckStatus(d.entries, avail);
      const lead = E.leaderOf(d.entries, byId);
      return `<div>${esc(d.meta.name || cardName(lead) || lead)} · ${esc(lead)} · ${st.need} 張 · 已有 ${st.have} · <span class="${st.missing ? 'bad' : 'ok'}">欠 ${st.missing}</span></div>`;
    }).join('');
  }
  function bindImport(root) {
    const go = $('.imp-go', root);
    if (!go) return;
    $('.imp-text', root).addEventListener('input', e => { $('.imp-preview', root).innerHTML = importPreview(e.target.value); });
    go.addEventListener('click', () => importDecks($('.imp-text', root).value, $('.imp-name', root).value.trim()));
  }

  // ================================================================ MINE
  const STATUS = { plan: '計劃中', built: '已組好（已預留卡）', sold: '已售出' };
  const statusLabel = s => STATUS[s] || s;
  const mineOpen = {};
  let mineFilter = 'active';
  let mineImportOpen = true;
  function addMyDeck(name, entries, extra) {
    const d = Object.assign({ id: uid(), name, entries: entries.map(e => ({ id: e.id, count: e.count })), status: 'plan', price: '', createdAt: new Date().toISOString() }, extra);
    state.decks.unshift(d);
    mineOpen[d.id] = true;
    save();
    toast('已加入「我的牌組」');
    if (current !== 'mine') showTab('mine'); else render();
  }
  function renderMine() {
    const el = $('#tab-mine');
    const sold = state.decks.filter(d => d.status === 'sold');
    const income = sold.reduce((s, d) => s + (Number(d.soldPrice) || 0), 0);
    const profit = sold.reduce((s, d) => s + (d.soldPrice !== '' && d.costAtSale != null ? Number(d.soldPrice) - d.costAtSale : 0), 0);
    const plan = state.decks.filter(d => d.status === 'plan');
    const shop = E.shoppingList(plan, available());
    el.innerHTML = `
      <div class="toolbar">
        <button id="new-deck">＋ 空白牌組</button>
        ${fxButton()}
        <select id="mine-filter"><option value="active">計劃中 + 已組好</option><option value="plan">計劃中</option><option value="built">已組好</option><option value="sold">已售出</option><option value="all">全部</option></select>
      </div>
      ${importPanelHtml(!state.decks.length || mineImportOpen)}
      <div class="stats"><span>計劃中 <b>${plan.length}</b></span><span>已組好 <b>${state.decks.filter(d => d.status === 'built').length}</b></span>
        <span>已售出 <b>${sold.length}</b> 副 · 收入 <b>${hk(income)}</b> · 相對市值 <b class="${profit >= 0 ? 'ok' : 'bad'}">${profit >= 0 ? '+' : ''}${hk(profit)}</b></span></div>
      <div class="decks" id="mine-list"></div>
      ${plan.length ? `<div class="panel" style="margin-top:16px"><h3>補卡清單（所有「計劃中」牌組合併計算）</h3>
        ${shop.length ? `<table class="list"><tr><th>卡</th><th>需要</th><th>可用</th><th>尚欠</th></tr>${shop.map(r => `<tr><td><b>${esc(r.id)}</b> ${esc(cardName(r.id))}</td><td>${r.need}</td><td>${r.free}</td><td class="bad">${r.missing}</td></tr>`).join('')}</table>
        <div class="actions" style="margin-top:8px"><button class="small" id="copy-shop">複製清單</button></div>` : '<p class="ok">所有計劃中的牌組均已齊卡！</p>'}</div>` : ''}`;
    $('#mine-filter').value = mineFilter;
    $('#mine-filter').addEventListener('change', e => { mineFilter = e.target.value; drawMine(); });
    $('#new-deck').addEventListener('click', () => addMyDeck('新牌組', [], {}));
    const cs = $('#copy-shop');
    if (cs) cs.addEventListener('click', () => copyText(shop.map(r => `${r.missing}x${r.id} ${cardName(r.id)}`).join('\n')));
    $('#mine-list').addEventListener('click', onMineClick);
    $('#mine-list').addEventListener('change', onMineChange);
    $('#mine-list').addEventListener('input', onMineInput);
    bindImport(el);
    $('.import', el).addEventListener('toggle', e => { mineImportOpen = e.target.open; });
    drawMine();
  }
  function drawMine() {
    const list = state.decks.filter(d => mineFilter === 'all' || d.status === mineFilter || (mineFilter === 'active' && d.status !== 'sold'));
    $('#mine-list').innerHTML = list.map(myDeckHtml).join('') || '<p class="muted">未有牌組。請到「熱門牌組」選擇一副，或按「空白牌組」。</p>';
  }
  function myDeckHtml(d) {
    const avail = available(d.id);
    const st = E.deckStatus(d.entries, avail);
    const price = pricer();
    const cost = E.deckCost(d.entries, price);
    const ask = d.status === 'sold' ? d.soldPrice : d.price;
    const base = d.status === 'sold' && d.costAtSale != null ? d.costAtSale : cost.cost;
    const profit = ask === '' || ask == null ? null : Number(ask) - base;
    const lead = E.leaderOf(d.entries, byId);
    const issues = E.validateDeck(d.entries, byId);
    const open = !!mineOpen[d.id];
    const sold = d.status === 'sold';
    return `<div class="deck${open ? ' wide' : ''}" data-id="${esc(d.id)}">
      <div class="head"><div class="thumb">${imgTag(lead || 'LEADER')}</div>
        <div class="grow">
          <div class="title">${open && !sold ? `<input data-f="name" value="${esc(d.name)}">` : esc(d.name)}</div>
          <div class="muted">${esc(lead)} ${esc(cardName(lead))} ${dots(byId[lead])}</div>
          ${deckInfo(d)}
          <span class="badge ${d.status}">${statusLabel(d.status)}</span>
          ${sold ? `<span class="muted"> ${esc((d.soldAt || '').slice(0, 10))} · 售價 ${hk(d.soldPrice)}</span>` : ''}
        </div></div>
      <div class="money">
        ${!sold && cost.unknown.length === d.entries.length ? '<span>市值 <span class="muted">未有價格（請執行價格 BOT 或輸入手動價格）</span></span>' : `
        <span>市值${sold ? '（售出時）' : ''} <b class="price">${hk(base)}</b>${!sold && cost.unknown.length ? ` <span class="muted">（${cost.unknown.length} 款未有價格）</span>` : ''}</span>
        ${!sold && st.missing ? `<span>補齊要 <b class="price">${hk(E.missingCost(st.rows, price).cost)}</b></span>` : ''}`}
        ${profit != null ? `<span>${sold ? '盈虧' : '預計盈虧'} <b class="${profit >= 0 ? 'ok' : 'bad'}">${profit >= 0 ? '+' : ''}${hk(profit)}</b></span>` : ''}
      </div>
      ${sold ? '' : `<div class="bar ${barClass(st.pct)}"><i style="width:${(st.pct * 100).toFixed(0)}%"></i></div>
      <div>${st.have}/${st.need} 張 · ${st.missing ? `<span class="bad">欠 ${st.missing} 張</span>` : '<span class="ok">卡已齊</span>'}</div>`}
      ${issues.length && !sold ? `<ul class="issues">${issues.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
      ${open ? `
        ${!sold ? `<div class="toolbar" style="margin:0"><label>售價 HK$ <input data-f="price" type="number" min="0" step="1" value="${esc(d.price)}" style="width:110px"></label>
          <button class="small" data-act="askmarket">以市值作售價</button></div>` : ''}
        ${rowsHtml(st.rows, !sold)}
        ${!sold ? `<div class="picker"><input data-f="search" placeholder="加卡：輸入卡號或名稱" style="width:100%"><div class="results"></div></div>` : ''}
        <textarea data-f="notes" placeholder="備註（買家、交收…）" style="min-height:50px">${esc(d.notes || '')}</textarea>` : ''}
      <div class="actions">
        <button class="small" data-act="toggle">${open ? '收起' : '開啟／編輯'}</button>
        ${d.status === 'plan' ? '<button class="small primary" data-act="build">組好（預留卡）</button>' : ''}
        ${d.status === 'built' ? '<button class="small" data-act="unbuild">拆散</button>' : ''}
        ${!sold ? '<button class="small primary" data-act="sell">售出</button>' : '<button class="small" data-act="unsell">撤銷售出</button>'}
        <button class="small" data-act="text">複製文字</button>
        <button class="small" data-act="dup">複製此牌組</button>
        <button class="small" data-act="del">刪除</button>
      </div></div>`;
  }
  function deckOf(el) { const box = el.closest('.deck'); return box && state.decks.find(d => d.id === box.dataset.id); }
  function redrawDeck(d) {
    const box = $(`.deck[data-id="${CSS.escape(d.id)}"]`, $('#mine-list'));
    if (box) box.outerHTML = myDeckHtml(d);
  }
  async function onMineClick(e) {
    const d = deckOf(e.target);
    if (!d) return;
    const edit = e.target.closest('[data-e]');
    if (edit) {
      const id = edit.dataset.e;
      const entry = d.entries.find(x => x.id === id);
      const n = (entry ? entry.count : 0) + Number(edit.dataset.n);
      if (entry && n <= 0) d.entries = d.entries.filter(x => x.id !== id);
      else if (entry) entry.count = n;
      else if (n > 0) d.entries.push({ id, count: n });
      const search = edit.closest('.picker') && edit.closest('.picker').querySelector('input');
      const q = search ? search.value : '';
      save(); redrawDeck(d);
      if (q) { // keep the search results open while adding several cards
        const box = $(`.deck[data-id="${CSS.escape(d.id)}"] .picker input`, $('#mine-list'));
        if (box) { box.value = q; box.dispatchEvent(new Event('input', { bubbles: true })); }
      }
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'toggle') { mineOpen[d.id] = !mineOpen[d.id]; redrawDeck(d); }
    if (act === 'build') {
      const st = E.deckStatus(d.entries, available(d.id));
      if (st.missing && !(await ask(`尚欠 ${st.missing} 張，仍要標記為「已組好」嗎？`))) return;
      d.status = 'built'; d.builtAt = new Date().toISOString(); save(); renderMine();
    }
    if (act === 'unbuild') { d.status = 'plan'; save(); renderMine(); }
    if (act === 'askmarket') { d.price = Math.ceil(E.deckCost(d.entries, pricer()).cost); save(); redrawDeck(d); }
    if (act === 'sell') {
      const price = await ask('售出價格（HK$）？可留空。', { input: true, value: d.price || '', type: 'number', ok: '售出' });
      if (price === null) return;
      const before = Object.assign({}, state.owned);
      const res = E.sellDeck(state.owned, d.entries, settings().includeParallels);
      if (res.shortfall.length && !(await ask('卡庫中以下卡數量不足：\n' + res.shortfall.map(s => `${s.id} 欠 ${s.count}`).join('\n') + '\n仍要售出嗎？（按現有數量扣除）'))) return;
      state.owned = res.owned;
      d.removed = {};
      for (const id of Object.keys(before)) { const diff = before[id] - (res.owned[id] || 0); if (diff) d.removed[id] = diff; }
      d.costAtSale = E.deckCost(d.entries, pricer()).cost;
      d.status = 'sold'; d.soldAt = new Date().toISOString(); d.soldPrice = price === '' ? '' : Number(price);
      save(); renderMine(); toast('已從卡庫扣除');
    }
    if (act === 'unsell') {
      if (!(await ask('撤銷售出：把售出時扣除的卡加回卡庫？'))) return;
      for (const [id, n] of Object.entries(d.removed || {})) state.owned[id] = (state.owned[id] || 0) + n;
      d.status = 'plan'; delete d.removed; delete d.soldAt; delete d.costAtSale; save(); renderMine();
    }
    if (act === 'text') copyText(E.deckToText(d.entries, byId));
    if (act === 'dup') addMyDeck(d.name + ' (2)', d.entries, { notes: '' });
    if (act === 'del') {
      if (!(await ask(`刪除「${d.name}」？卡庫數量不會改變。`, { ok: '刪除', danger: true }))) return;
      state.decks = state.decks.filter(x => x !== d); save(); renderMine();
    }
  }
  function onMineChange(e) {
    const d = deckOf(e.target); const f = e.target.dataset.f;
    if (!d || !f || f === 'search') return;
    d[f] = f === 'price' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value;
    save();
    if (f === 'price' || f === 'name') redrawDeck(d);
  }
  function onMineInput(e) {
    if (e.target.dataset.f !== 'search') return;
    const d = deckOf(e.target);
    const q = e.target.value.trim().toLowerCase();
    const box = e.target.parentElement.querySelector('.results');
    if (q.length < 2) { box.innerHTML = ''; return; }
    const lead = E.leaderOf(d.entries, byId);
    const lc = lead && byId[lead] ? E.cardColors(byId[lead]) : [];
    const avail = available(d.id);
    const hits = CARDS.filter(c => c.id === E.baseId(c.id) && (c.id.toLowerCase().includes(q) || (c.name || '').toLowerCase().includes(q)))
      .sort((a, b) => {
        const fit = c => (!lc.length || E.cardColors(c).some(x => lc.includes(x))) ? 0 : 1;
        return fit(a) - fit(b) || a.id.localeCompare(b.id);
      }).slice(0, 12);
    const direct = E.normId(q);
    if (!hits.length && direct) hits.push({ id: E.baseId(direct), name: '' });
    box.innerHTML = hits.map(c => `<div class="row"><div class="thumb">${imgTag(c.id)}</div><div class="grow"><b>${esc(c.id)}</b> ${esc(c.name)} ${dots(c)}</div>
      <span class="muted">有 ${Math.max(0, avail[c.id] || 0)}</span><button class="small" data-e="${esc(c.id)}" data-n="1">+1</button><button class="small" data-e="${esc(c.id)}" data-n="4">+4</button></div>`).join('');
  }

  // ============================================================== VALUE
  const vf = { q: '', scope: 'mine', sort: 'total', limit: 150 };
  function valueRows() {
    const price = pricer();
    const min = Number(settings().valuableMin) || 0;
    const reserved = E.reservedTotals(state.decks);
    const ids = new Set(Object.keys(state.owned));
    if (vf.scope === 'all') { for (const id of Object.keys(PRICES.prices)) ids.add(id); for (const id of Object.keys(state.manualPrices)) ids.add(id); }
    const q = vf.q.trim().toLowerCase();
    let rows = [];
    for (const id of ids) {
      const p = price(id);
      const n = ownedOf(id);
      if (!p || p.hkd < min) continue;
      if (vf.scope === 'mine' && !n) continue;
      const c = byId[id] || {};
      if (q && !(id.toLowerCase().includes(q) || (c.name || '').toLowerCase().includes(q))) continue;
      const pct = p.change && p.change.from ? (p.change.to - p.change.from) / p.change.from : 0;
      rows.push({ id, c, n, p, total: p.hkd * n, pct, reserved: id === E.baseId(id) ? reserved[id] || 0 : 0 });
    }
    const by = { total: (a, b) => b.total - a.total, unit: (a, b) => b.p.hkd - a.p.hkd, up: (a, b) => b.pct - a.pct, down: (a, b) => a.pct - b.pct, id: (a, b) => a.id.localeCompare(b.id) }[vf.sort];
    rows.sort((a, b) => by(a, b) || a.id.localeCompare(b.id));
    return rows;
  }
  function renderValue() {
    const el = $('#tab-value');
    const price = pricer();
    const v = E.collectionValue(state.owned, price);
    const hasBot = Object.keys(PRICES.prices || {}).length > 0;
    el.innerHTML = `
      ${hasBot ? '' : `<div class="notice"><b>未有自動價格。</b> 請執行價格 BOT（悠々亭日版售價 × 匯率）：<pre>python3 bot/scrape_prices.py</pre>或在「設定」按「更新價格」。即使沒有 BOT，亦可在下方或卡的詳細頁自行輸入價格。</div>`}
      <div class="stats">
        <span>卡庫總值 <b class="price">${total(v.total)}</b> ${eyeButton()}</span>
        <span>有價格 <b>${v.priced}</b> 張 · 未有價格 <b>${v.unpriced}</b> 張</span>
        <span id="vf-sum"></span>
        <span>價格 ${PRICES.fetchedAt ? '更新於 ' + esc(PRICES.fetchedAt.slice(0, 10)) : '未更新'} · 1 JPY = ${rate()} HKD${Number(settings().factor) !== 1 ? ' · 係數 ×' + esc(settings().factor) : ''}</span>
      </div>
      <div class="toolbar">
        <input type="search" id="vf-q" placeholder="搜尋 卡號 / 名稱">
        <label>HK$ <input id="vf-min" type="number" min="0" step="10" style="width:90px"> 或以上</label>
        <select id="vf-scope"><option value="mine">已擁有</option><option value="all">所有有價格的卡</option></select>
        <select id="vf-sort"><option value="total">總值最高優先</option><option value="unit">單價最高優先</option><option value="up">升幅最大優先</option><option value="down">跌幅最大優先</option><option value="id">按編號</option></select>
        <button id="vf-csv" class="small">匯出 CSV</button>
      </div>
      <div class="vlist" id="vf-list"></div>
      <button class="more" id="vf-more">顯示更多</button>`;
    $('#vf-min').value = settings().valuableMin;
    $('#vf-min').addEventListener('change', e => { settings().valuableMin = Number(e.target.value) || 0; save(); drawValue(); });
    for (const k of ['q', 'scope', 'sort']) {
      const input = $('#vf-' + k);
      input.value = vf[k];
      input.addEventListener(k === 'q' ? 'input' : 'change', () => { vf[k] = input.value; vf.limit = 150; drawValue(); });
    }
    $('#vf-more').addEventListener('click', () => { vf.limit += 150; drawValue(); });
    $('#vf-csv').addEventListener('click', () => {
      const rows = [['id', 'name', 'rarity', 'count', 'unit_hkd', 'total_hkd', 'source', 'jpy', 'price_date']].concat(valueRows().map(r =>
        [r.id, r.c.name || '', r.c.rarity || '', r.n, r.p.hkd, Math.round(r.total * 10) / 10, r.p.source, r.p.jpy ?? '', r.p.at || '']));
      download('opcg-valuable.csv', '﻿' + rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
    });
    const list = $('#vf-list');
    list.addEventListener('change', e => {
      const m = e.target.closest('[data-mp]');
      if (!m) return;
      setManualPrice(m.dataset.mp, m.value);
      drawValue();
    });
    list.addEventListener('click', e => {
      const b = e.target.closest('[data-clear]');
      if (b) { setManualPrice(b.dataset.clear, ''); drawValue(); }
    });
    drawValue();
  }
  function drawValue() {
    const rows = valueRows();
    const sum = rows.reduce((s, r) => s + r.total, 0);
    $('#vf-sum').innerHTML = `此處 <b>${rows.length}</b> 款 · 總值 <b class="price">${total(sum)}</b>`;
    $('#vf-list').innerHTML = rows.slice(0, vf.limit).map(r => `<div class="vrow">
      <div class="thumb" data-detail="${esc(r.id)}">${imgTag(r.id)}</div>
      <div class="grow">
        <div><b>${esc(r.id)}</b> <span class="muted">${esc(r.c.rarity || '')}</span> ${esc(r.c.name || '')}${altBadge(r.c)}</div>
        <div class="muted" style="font-size:12px">${r.p.source === 'manual' ? `手動（${esc(r.p.at || '')}）<button class="small" data-clear="${esc(r.id)}">改回自動價格</button>` : `悠々亭 ¥${Number(r.p.jpy).toLocaleString()}${r.p.stock === 0 ? ' · 缺貨' : ''} · ${esc(r.p.at || '')}`}
          · <a href="${esc(shopUrl(r.id))}" target="_blank" rel="noopener">悠々亭</a>${r.reserved ? ` · 預留 ${r.reserved}` : ''}</div>
      </div>
      <div class="vnum"><div class="muted">單價</div><b class="price">${hk(r.p.hkd)}</b> ${changeHtml(r.p.change)}</div>
      <div class="vnum"><div class="muted">× ${r.n}</div><b class="price">${hk(r.total)}</b></div>
      <div class="vnum"><input data-mp="${esc(r.id)}" type="number" min="0" step="1" placeholder="改價" aria-label="手動價 HK$" style="width:84px"></div>
    </div>`).join('') || '<p class="muted">沒有符合的卡。請降低價格門檻，或選擇「所有有價格的卡」。</p>';
    $('#vf-more').style.display = rows.length > vf.limit ? '' : 'none';
  }

  // ============================================================ SETTINGS
  function autoSetting() {
    const a = settings().autoUpdate || {};
    return { mode: a.mode === 'auto' ? 'auto' : 'manual', every: a.every === 'weekly' ? 'weekly' : 'daily',
      cards: a.cards !== false, prices: a.prices !== false, decks: a.decks !== false };
  }
  const AUTO_LABEL = { cards: '卡表及卡圖（新系列、新卡、新卡圖）', prices: '價格', decks: '熱門牌組' };
  let autoInfo = null; // { cloud, status } from the server
  function autoPanelHtml() {
    const a = autoSetting();
    const auto = a.mode === 'auto';
    // Warnings stay visible; plain explanations go behind the "?" button.
    const where = !serverOk ? '<p class="warn small">自動更新需要以本機伺服器（OPCG-Start.command）或網上版本執行；目前的設定會保存，待之後生效。</p>' : '';
    const whenText = autoInfo && autoInfo.cloud ? '網上版本：Google Cloud 每日凌晨 4 時（香港時間）檢查一次，到期的項目會自動更新，無須開啟本頁。'
      : '電腦版本：程式開啟期間每 30 分鐘檢查一次，到期的項目會自動更新；程式關閉時不會更新。';
    const tasks = (autoInfo && autoInfo.status && autoInfo.status.tasks) || {};
    const when = t => t ? new Date(t * 1000).toLocaleString('zh-HK', { hour12: false }) : '';
    const last = Object.keys(AUTO_LABEL).filter(k => tasks[k]).map(k => {
      const r = tasks[k];
      return `<li><b>${esc(AUTO_LABEL[k].split('（')[0])}</b>：${esc(when(r.at))} · ${r.code === 0 ? '<span class="ok">成功</span>' : `<span class="bad">失敗（代碼 ${esc(r.code)}）</span>`}
        ${(r.summary || []).length ? `<br><span class="muted small">${esc(r.summary.join('　'))}</span>` : ''}</li>`;
    }).join('');
    return `
      <div class="toolbar" style="margin:0"><div class="seg" role="radiogroup" aria-label="更新方式">
        <button role="radio" aria-checked="${!auto}" data-automode="manual" class="${auto ? '' : 'on'}">手動</button><button role="radio" aria-checked="${auto}" data-automode="auto" class="${auto ? 'on' : ''}">自動</button>
      </div>${help('<b>手動</b>：只在你按「檢查新系列及卡圖」等按鈕時更新。<br><b>自動</b>：按所選項目及頻率定期更新。<br>' + whenText, '更新方式說明')}</div>

      <fieldset class="auto-opts"${auto ? '' : ' disabled'}>
        <legend class="small muted">自動更新的項目</legend>
        ${Object.keys(AUTO_LABEL).map(k => `<label class="small"><input type="checkbox" data-autotask="${k}"${a[k] ? ' checked' : ''}> ${esc(AUTO_LABEL[k])}</label>`).join('')}
        <label class="small">頻率 <select id="auto-every"><option value="daily"${a.every === 'daily' ? ' selected' : ''}>每日</option><option value="weekly"${a.every === 'weekly' ? ' selected' : ''}>每週</option></select></label>
      </fieldset>
      ${where}
      ${serverOk ? '<div class="actions"><button class="small" data-bot="auto">立即執行一次</button></div>' : ''}
      ${last ? `<h3 style="margin-top:12px">最近一次更新</h3><ul class="auto-last">${last}</ul>` : ''}`;
  }
  function bindAutoPanel() {
    const panel = $('#auto-panel');
    if (!panel) return;
    const set = patch => {
      settings().autoUpdate = Object.assign(autoSetting(), patch);
      save();
      panel.innerHTML = '<h2>更新方式</h2>' + autoPanelHtml();
      if (serverOk) $$('[data-bot]', panel).forEach(bindBotButton);
    };
    panel.onclick = e => {
      const m = e.target.closest('[data-automode]');
      if (m) { set({ mode: m.dataset.automode }); toast(m.dataset.automode === 'auto' ? '已改為自動更新' : '已改為手動更新'); }
    };
    panel.onchange = e => {
      const t = e.target.closest('[data-autotask]');
      if (t) set({ [t.dataset.autotask]: t.checked });
      if (e.target.id === 'auto-every') set({ every: e.target.value });
    };
    if (serverOk && !autoInfo) {
      fetch('/api/auto', { cache: 'no-store' }).then(r => r.json()).then(j => {
        autoInfo = j;
        if (current === 'settings') { panel.innerHTML = '<h2>更新方式</h2>' + autoPanelHtml(); $$('[data-bot]', panel).forEach(bindBotButton); }
      }).catch(() => { /* older server without /api/auto */ });
    }
  }
  function bindBotButton(b) {
    if (b.dataset.bound) return;
    b.dataset.bound = '1';
    b.addEventListener('click', async () => {
      await fetch('/api/bot/' + b.dataset.bot, { method: 'POST' });
      if (b.dataset.bot === 'auto') autoInfo = null;
      pollBot(b.dataset.bot);
    });
  }
  function renderSettings() {
    const el = $('#tab-settings');
    const cs = window.OPCG_CARDS, ds = window.OPCG_DECKS;
    el.innerHTML = `
      <div class="cols">
        <div class="panel"><h2>資料</h2>
          <p>卡表：${cs ? `<b>${CARDS.length}</b> 張 · ${esc((cs.series || []).length)} 個系列 · 更新 ${esc((cs.scrapedAt || '').slice(0, 16).replace('T', ' '))}` : '<span class="warn">未有</span>'}</p>
          <p>熱門牌組：${ds ? `<b>${META.length}</b> 副 · 更新 ${esc((ds.scrapedAt || '').slice(0, 16).replace('T', ' '))}` : '<span class="warn">未有</span>'}</p>
          <p>價格：${PRICES.fetchedAt ? `<b>${Object.keys(PRICES.prices).length}</b> 款 · 更新 ${esc(PRICES.fetchedAt.slice(0, 16).replace('T', ' '))}` : '<span class="warn">未有</span>'} · 手動價 <b>${Object.keys(state.manualPrices).length}</b> 款</p>
          <div id="bot-box">${serverOk ? `
            <div class="actions"><button class="primary" data-bot="update">檢查新系列及卡圖</button><button data-bot="cards">只更新卡表（不下載卡圖）</button><button data-bot="decks">更新牌組清單</button><button data-bot="prices">更新價格</button>
              ${help('「檢查新系列及卡圖」會重新讀取官方卡表，找出新系列及新卡，並只下載新增或已更換的卡圖。<br>第一次下載全部卡圖約需 30–60 分鐘，之後通常只需數分鐘。', 'BOT 說明')}</div>
            <pre id="bot-log" class="muted" style="max-height:260px;overflow:auto"></pre>` : noDataNotice('伺服器').replace('未有伺服器資料。', 'BOT 需要在電腦上執行。')}</div>
        </div>
        <div class="panel" id="auto-panel"><h2>更新方式</h2>${autoPanelHtml()}</div>
        <div class="panel"><h2>設定</h2>
          <label><input type="checkbox" id="set-par"${settings().includeParallels ? ' checked' : ''}> 計算牌組時計入異圖及 SP</label>
          ${help('勾選後，計算牌組是否齊卡時會一併計入異圖及 SP。售出牌組時會先扣除普通版。', '異圖說明')}
          <h3 style="margin-top:16px">價格 ${help('自動價格 = 悠々亭日版售價（JPY）× 匯率 × 係數。<br>港版／亞洲中文版的行情通常與日版不同，可用係數調整（例如 0.8）。<br>手動價格永遠優先。<br>匯率留空即使用 BOT 最近取得的匯率（' + esc(PRICES.jpyToHkd || DEFAULT_RATE + '，預設值') + '）。', '價格計算說明')}</h3>
          <div class="toolbar">
            <label>1 JPY = <input id="set-rate" type="number" step="0.0001" min="0" style="width:100px" placeholder="${esc(PRICES.jpyToHkd || DEFAULT_RATE)}"> HKD</label>
            <label>係數 × <input id="set-factor" type="number" step="0.05" min="0" style="width:80px"></label>
          </div>
          <h3 style="margin-top:16px">備份</h3>
          <div class="actions"><button id="exp">匯出備份（JSON）</button><label class="small"><input type="file" id="imp" accept=".json,application/json" hidden><span class="small" style="border:1px solid var(--line);border-radius:8px;padding:6px 12px;cursor:pointer">匯入備份</span></label>
            <button id="exp-csv">匯出卡庫 CSV</button></div>
          <h3 style="margin-top:16px">外觀</h3>
          <select id="theme"><option value="">跟系統</option><option value="light">淺色</option><option value="dark">深色</option></select>
          <h3 style="margin-top:16px">清除</h3>
          <button id="wipe" class="small">清除所有卡庫及牌組資料</button>
        </div>
      </div>`;
    $('#set-par').addEventListener('change', e => { settings().includeParallels = e.target.checked; save(); });
    $('#set-rate').value = settings().rate || '';
    $('#set-rate').addEventListener('change', e => { settings().rate = e.target.value === '' ? '' : Number(e.target.value); save(); toast('已更新匯率'); });
    $('#set-factor').value = settings().factor ?? 1;
    $('#set-factor').addEventListener('change', e => { settings().factor = e.target.value === '' ? 1 : Number(e.target.value); save(); toast('已更新係數'); });
    $('#exp').addEventListener('click', () => download('opcg-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(state, null, 1), 'application/json'));
    $('#exp-csv').addEventListener('click', () => {
      const price = pricer();
      const rows = [['id', 'name', 'rarity', 'set', 'count', 'unit_hkd']].concat(Object.keys(state.owned).sort().map(id => {
        const c = byId[id] || {}; const p = price(id);
        return [id, c.name || '', c.rarity || '', c.set || E.setOf(id), state.owned[id], p ? p.hkd : ''];
      }));
      download('opcg-collection.csv', '﻿' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
    });
    $('#imp').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const s = JSON.parse(await f.text());
        if (!s || typeof s.owned !== 'object') throw new Error('not a backup');
        if (!(await ask('以此備份取代現有資料？', { ok: '取代' }))) return;
        state = normalise(s); save(); toast('已匯入備份'); renderSettings();
      } catch (err) { toast('這不是有效的備份檔'); }
    });
    const theme = $('#theme');
    theme.value = document.documentElement.dataset.theme || '';
    theme.addEventListener('change', () => {
      if (theme.value) document.documentElement.dataset.theme = theme.value; else delete document.documentElement.dataset.theme;
      try { localStorage.setItem('opcg-theme', theme.value); } catch (e) { /* ignore */ }
    });
    $('#wipe').addEventListener('click', async () => {
      if (!(await ask('確定要清除所有卡庫及牌組資料？建議先匯出備份。', { ok: '清除', danger: true }))) return;
      state = blankState(); save(); toast('已清除'); renderSettings();
    });
    bindAutoPanel();
    if (serverOk) {
      $$('[data-bot]').forEach(bindBotButton);
      pollBot();
    }
  }
  async function pollBot(name) {
    clearTimeout(pollBot.t);
    let j;
    try { j = await (await fetch('/api/bot', { cache: 'no-store' })).json(); } catch (e) { return; }
    const jobs = j.jobs || {};
    const key = name || Object.keys(jobs).sort((a, b) => (jobs[b].started || 0) - (jobs[a].started || 0))[0];
    const job = key && jobs[key];
    const log = $('#bot-log');
    if (!log || !job) return;
    log.textContent = job.log || '…';
    log.scrollTop = log.scrollHeight;
    $$('[data-bot]').forEach(b => { b.disabled = Object.values(jobs).some(x => x.running); });
    if (job.running) pollBot.t = setTimeout(() => pollBot(key), 1500);
    else if (name && job.code === 0) { toast('完成，正在重新載入…'); setTimeout(() => location.reload(), 1200); }
    else if (name && job.code) toast('BOT 執行失敗，請查看記錄');
  }

  function download(name, text, type) {
    if (DEMO) { toast('示範版不能下載檔案；請使用電腦上的正式版本'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function copyText(text) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
      .then(() => toast('已複製'))
      .catch(() => { $('#modal-body').innerHTML = `<h3>請複製以下文字</h3><textarea style="min-height:300px">${esc(text)}</textarea>`; $('#modal').showModal(); });
  }

  // ---------------------------------------------------------------- boot
  try { const t = localStorage.getItem('opcg-theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* ignore */ }
  load().then(() => {
    let tab = 'home';
    try { tab = localStorage.getItem('opcg-tab') || tab; } catch (e) { /* ignore */ }
    showTab(TABS.includes(tab) ? tab : 'home');
  });
})();
