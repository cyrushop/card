// Run: node tests/engine.test.js   (synthetic data only)
const assert = require('assert');
const E = require('../app/engine.js');

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('ok -', name); };

const cards = {
  'OP08-001': { id: 'OP08-001', category: 'LEADER', colors: ['紅', '綠'] },
  'OP08-002': { id: 'OP08-002', category: 'CHARACTER', colors: ['紅'] },
  'OP08-003': { id: 'OP08-003', category: 'CHARACTER', colors: ['綠'] },
  'OP08-040': { id: 'OP08-040', category: 'CHARACTER', colors: ['藍'] },
  'OP09-010': { id: 'OP09-010', category: 'EVENT', color: '紅' },
};

t('normId / baseId', () => {
  assert.strictEqual(E.normId('op08-001'), 'OP08-001');
  assert.strictEqual(E.normId('4xOP08-001_P1'), 'OP08-001_p1');
  assert.strictEqual(E.normId('PRB01-005'), 'PRB01-005');
  assert.strictEqual(E.normId('P-033'), 'P-033');
  assert.strictEqual(E.normId('hello'), '');
  assert.strictEqual(E.baseId('OP08-001_p2'), 'OP08-001');
});

t('quickId shorthand', () => {
  assert.strictEqual(E.quickId('OP09-118', 'OP08'), 'OP09-118');
  assert.strictEqual(E.quickId('08-1', ''), 'OP08-001');
  assert.strictEqual(E.quickId('45', 'OP10'), 'OP10-045');
  assert.strictEqual(E.quickId('001p1', 'OP08'), 'OP08-001_p1');
  assert.strictEqual(E.quickId('7', 'EB02'), 'EB02-007');
  assert.strictEqual(E.quickId('7', ''), '');
});

t('parseDeckText: common formats', () => {
  const r = E.parseDeckText('1xOP08-001\n4 x OP08-002\n3 OP08-003\nOP09-010 x2\nOP08-002 1\nST01-012\nrubbish line');
  assert.deepStrictEqual(r.entries, [
    { id: 'OP08-001', count: 1 }, { id: 'OP08-002', count: 5 }, { id: 'OP08-003', count: 3 },
    { id: 'OP09-010', count: 2 }, { id: 'ST01-012', count: 1 },
  ]);
  assert.deepStrictEqual(r.unknown, ['rubbish line']);
});

t('parseDeckText: deckgen code and URL', () => {
  const a = E.parseDeckText('1nOP08-001a4nOP08-002a2nOP09-010');
  assert.deepStrictEqual(a.entries, [{ id: 'OP08-001', count: 1 }, { id: 'OP08-002', count: 4 }, { id: 'OP09-010', count: 2 }]);
  const b = E.parseDeckText('https://onepiecetopdecks.com/deckgen/?dn=Test&dg=1nOP08-001a4nOP08-002&au=x');
  assert.deepStrictEqual(b.entries, [{ id: 'OP08-001', count: 1 }, { id: 'OP08-002', count: 4 }]);
});

t('parseDeckText: parallels fold unless keepVariants', () => {
  assert.deepStrictEqual(E.parseDeckText('2xOP08-002_p1\n1xOP08-002').entries, [{ id: 'OP08-002', count: 3 }]);
  assert.deepStrictEqual(E.parseDeckText('2xOP08-002_p1\n1xOP08-002', { keepVariants: true }).entries,
    [{ id: 'OP08-002_p1', count: 2 }, { id: 'OP08-002', count: 1 }]);
});

t('deckToText / toDg put the leader first', () => {
  const entries = [{ id: 'OP08-002', count: 4 }, { id: 'OP08-001', count: 1 }];
  assert.strictEqual(E.deckToText(entries, cards), '1xOP08-001\n4xOP08-002');
  assert.strictEqual(E.toDg(entries, cards), '1nOP08-001a4nOP08-002');
});

t('available = owned - reserved by other built decks; parallels optional', () => {
  const state = {
    owned: { 'OP08-002': 5, 'OP08-002_p1': 1, 'OP08-003': 2 },
    decks: [
      { id: 'a', status: 'built', entries: [{ id: 'OP08-002', count: 4 }] },
      { id: 'b', status: 'plan', entries: [{ id: 'OP08-003', count: 4 }] },
      { id: 'c', status: 'sold', entries: [{ id: 'OP08-002', count: 4 }] },
    ],
    settings: { includeParallels: false },
  };
  assert.deepStrictEqual(E.availableTotals(state), { 'OP08-002': 1, 'OP08-003': 2 });
  assert.deepStrictEqual(E.availableTotals(state, 'a'), { 'OP08-002': 5, 'OP08-003': 2 });
  state.settings.includeParallels = true;
  assert.strictEqual(E.availableTotals(state)['OP08-002'], 2);
});

t('deckStatus counts missing cards', () => {
  const st = E.deckStatus([{ id: 'OP08-001', count: 1 }, { id: 'OP08-002', count: 4 }], { 'OP08-001': 1, 'OP08-002': 2 });
  assert.strictEqual(st.need, 5); assert.strictEqual(st.have, 3); assert.strictEqual(st.missing, 2);
  assert.strictEqual(st.rows[1].missing, 2);
  const neg = E.deckStatus([{ id: 'OP08-002', count: 2 }], { 'OP08-002': -3 });
  assert.strictEqual(neg.have, 0);
});

t('validateDeck rules', () => {
  const ok = [{ id: 'OP08-001', count: 1 }, { id: 'OP08-002', count: 4 }, { id: 'OP08-003', count: 4 }];
  for (let i = 100; i < 121; i++) cards['OP08-' + i] = { id: 'OP08-' + i, category: 'CHARACTER', colors: ['紅'] };
  for (let i = 100; i < 121; i++) ok.push({ id: 'OP08-' + i, count: i < 110 ? 2 : 2 });
  // 8 + 42 = 50
  assert.deepStrictEqual(E.validateDeck(ok, cards), []);
  const bad = ok.concat([{ id: 'OP08-040', count: 5 }]);
  const issues = E.validateDeck(bad, cards);
  assert.ok(issues.some(i => i.includes('55')), issues.join('|'));
  assert.ok(issues.some(i => i.includes('超過 4')));
  assert.ok(issues.some(i => i.includes('顏色')));
  assert.ok(E.validateDeck([{ id: 'OP08-002', count: 4 }], cards).some(i => i.includes('領航')));
});

t('sellDeck removes base cards first, parallels only when allowed', () => {
  const owned = { 'OP08-002': 2, 'OP08-002_p1': 3, 'OP08-003': 1 };
  const deck = [{ id: 'OP08-002', count: 4 }, { id: 'OP08-003', count: 2 }];
  const a = E.sellDeck(owned, deck, false);
  assert.deepStrictEqual(a.owned, { 'OP08-002_p1': 3 });
  assert.deepStrictEqual(a.shortfall, [{ id: 'OP08-002', count: 2 }, { id: 'OP08-003', count: 1 }]);
  const b = E.sellDeck(owned, deck, true);
  assert.deepStrictEqual(b.owned, { 'OP08-002_p1': 1 });
  assert.deepStrictEqual(owned, { 'OP08-002': 2, 'OP08-002_p1': 3, 'OP08-003': 1 }, 'input untouched');
});

t('shoppingList adds up competing decks', () => {
  const list = E.shoppingList([
    { entries: [{ id: 'OP08-002', count: 4 }] },
    { entries: [{ id: 'OP08-002', count: 4 }, { id: 'OP08-003', count: 1 }] },
  ], { 'OP08-002': 5, 'OP08-003': 3 });
  assert.deepStrictEqual(list, [{ id: 'OP08-002', need: 8, free: 5, missing: 3 }]);
});

t('prices: manual beats bot, JPY x rate x factor, change over 7 days', () => {
  const price = E.makePricer({
    manual: { 'OP08-002': { hkd: 30, at: '2026-11-01', history: [['2026-10-01', 20], ['2026-11-01', 30]] } },
    bot: {
      'OP08-002': { jpy: 1000, history: [['2026-11-03', 1000]] },
      'OP08-003': { jpy: 2000, url: 'u', history: [['2026-10-20', 1000], ['2026-10-30', 1500], ['2026-11-03', 2000]] },
    },
    rate: 0.05, factor: 0.8,
  });
  assert.strictEqual(price('OP08-002').hkd, 30);
  assert.strictEqual(price('OP08-002').source, 'manual');
  assert.deepStrictEqual(price('OP08-002').change, { from: 20, to: 30, since: '2026-10-01' });
  const p3 = price('OP08-003');
  assert.strictEqual(p3.hkd, 80); assert.strictEqual(p3.source, 'bot');
  assert.deepStrictEqual(p3.change, { from: 40, to: 80, since: '2026-10-20' });
  assert.strictEqual(price('OP08-999'), null);
  assert.strictEqual(E.makePricer({ bot: { a: { jpy: 1 } }, rate: 0 })('a'), null);
});

t('deck cost, missing cost, collection value', () => {
  const price = E.makePricer({ bot: { 'OP08-001': { jpy: 200 }, 'OP08-002': { jpy: 100 }, 'OP08-002_p1': { jpy: 5000 } }, rate: 0.05 });
  const entries = [{ id: 'OP08-001', count: 1 }, { id: 'OP08-002', count: 4 }, { id: 'OP08-003', count: 2 }];
  assert.deepStrictEqual(E.deckCost(entries, price), { cost: 30, unknown: ['OP08-003'] });
  const st = E.deckStatus(entries, { 'OP08-001': 1, 'OP08-002': 1 });
  assert.deepStrictEqual(E.missingCost(st.rows, price), { cost: 15, unknown: 2 });
  assert.deepStrictEqual(E.collectionValue({ 'OP08-002': 3, 'OP08-002_p1': 1, 'OP08-009': 2 }, price),
    { total: 265, priced: 4, unpriced: 2, altTotal: 250, altCopies: 1 });
  // 異圖 / SP only: normal cards and same-picture reprints (_r) are left out.
  const v = E.collectionValue({ 'OP08-002': 10, 'OP08-002_r1': 2, 'OP08-002_p1': 2 }, E.makePricer({ bot: { 'OP08-002': { jpy: 100 }, 'OP08-002_r1': { jpy: 100 }, 'OP08-002_p1': { jpy: 5000 } }, rate: 0.05 }));
  assert.deepStrictEqual([v.total, v.altTotal, v.altCopies], [560, 500, 2]);
});

t('smart search query', () => {
  const q = E.parseQuery('Luffy OP17, c5, p6000 紅 SR');
  assert.deepStrictEqual(q.text, ['luffy']);
  assert.deepStrictEqual(q.sets, ['OP17']);
  assert.deepStrictEqual(q.cost, [5, 5]);
  assert.deepStrictEqual(q.power, [6000, 6000]);
  assert.deepStrictEqual(q.colors, ['紅']);
  assert.deepStrictEqual(q.rarities, ['SR']);
  const q2 = E.parseQuery('op-8 c3-5 k1000 leader 未有 平行 op08-001');
  assert.deepStrictEqual(q2.sets, ['OP08']);
  assert.deepStrictEqual(q2.cost, [3, 5]);
  assert.deepStrictEqual(q2.counter, [1000, 1000]);
  assert.deepStrictEqual(q2.cats, ['LEADER']);
  assert.strictEqual(q2.owned, false); assert.strictEqual(q2.alt, true);
  assert.deepStrictEqual(q2.text, ['op08-001']);

  const luffy = { id: 'OP17-010', name: 'Monkey.D.Luffy', cost: 5, power: 6000, colors: ['紅'], rarity: 'SR', category: 'CHARACTER', feature: '草帽一夥' };
  assert.ok(E.matchCard(luffy, q, 0));
  assert.ok(!E.matchCard(Object.assign({}, luffy, { cost: 4 }), q, 0));
  assert.ok(E.matchCard(luffy, E.parseQuery('草帽 有'), 2));
  assert.ok(!E.matchCard(luffy, E.parseQuery('草帽 有'), 0));
  const leader = { id: 'OP08-001', name: 'x', life: 5, category: 'LEADER', colors: ['紅', '綠'] };
  assert.ok(E.matchCard(leader, E.parseQuery('c5 leader 紅 綠'), 0), 'leader cost filter uses life');
  assert.ok(!E.matchCard(leader, E.parseQuery('平行'), 0));
  assert.ok(E.matchCard({ id: 'OP08-001_p1', name: 'x' }, E.parseQuery('平行'), 0));
});

t('set groups and progress', () => {
  assert.strictEqual(E.setGroup('OP17'), '補充包');
  assert.strictEqual(E.setGroup('PRB01'), '高級補充包');
  assert.strictEqual(E.setGroup('P'), '推廣卡');
  const cs = [
    { id: 'OP08-001', rarity: 'L' }, { id: 'OP08-002', rarity: 'SR' }, { id: 'OP08-003', rarity: 'SR' },
    { id: 'OP08-002_p1', rarity: 'SR' }, { id: 'OP01-016', rarity: 'R', series: [{ code: 'PRB01' }] },
  ];
  const owned = { 'OP08-002': 3, 'OP08-002_p1': 1 };
  const a = E.setProgress(cs, owned, 'OP08', false);
  assert.deepStrictEqual([a.total, a.have, a.copies], [3, 1, 3]);
  assert.deepStrictEqual(a.byRarity, { L: { total: 1, have: 0 }, SR: { total: 2, have: 1 } });
  const b = E.setProgress(cs, owned, 'OP08', true);
  assert.deepStrictEqual([b.total, b.have], [4, 2]);
  assert.deepStrictEqual(b.byRarity['異圖'], { total: 1, have: 1 });
  assert.strictEqual(E.setProgress(cs, owned, 'PRB01', false).total, 1, 'reprint counts in its series');
  // Series the official site lists without a code.
  assert.strictEqual(E.seriesCode({ value: '554110', code: 'OP10', label: 'x' }), 'OP10');
  assert.strictEqual(E.seriesCode({ value: '554901', code: '', label: '推廣卡' }), 'P');
  assert.strictEqual(E.seriesCode({ value: '554701', code: '', label: '家庭牌組套裝' }), 'X554701');
  assert.strictEqual(E.setGroup('X554701'), '其他');
});

t('pricer returns history in HKD', () => {
  const price = E.makePricer({ bot: { a: { jpy: 200, history: [['2026-11-01', 100], ['2026-11-03', 200]] } }, rate: 0.05 });
  assert.deepStrictEqual(price('a').history, [['2026-11-01', 5], ['2026-11-03', 10]]);
});

const URL1 = 'https://onepiecetopdecks.com/deck-list/japan-eb05op18-deck-list-heroines-and-the-dominance-of-god/deckgen/?dn=RG%20Luffy&date=11/1/2026&cn=JP&au=Shishi&pl=2nd%20(7-1)&tn=ShopEvent&hs=DragonTail%20Cup&dg=1nOP13-001a4nOP13-016a4nST30-004a2nPRB02-003a4nEB05-001a4nOP07-022a3nOP06-033a4nEB01-013a4nOP14-031a4nOP12-023a4nST32-002a4nOP13-031a3nOP17-022a2nOP01-055a2nOP08-036a2nOP10-040&cs=213';
const TEXT1 = `Decklist in text:
1xOP13-001
4xOP13-016
4xST30-004
2xPRB02-003
4xEB05-001
4xOP07-022
3xOP06-033
4xEB01-013
4xOP14-031
4xOP12-023
4xST32-002
4xOP13-031
3xOP17-022
2xOP01-055
2xOP08-036
2xOP10-040`;

t('real onepiecetopdecks deckgen link (RG Luffy)', () => {
  const [d] = E.parseDeckImports(URL1);
  assert.deepStrictEqual(d.meta, {
    name: 'RG Luffy', author: 'Shishi', date: '2026-11-01', placement: '2nd (7-1)',
    event: 'DragonTail Cup', eventType: 'ShopEvent', country: 'JP', url: d.meta.url,
  });
  assert.strictEqual(d.entries.length, 16);
  assert.deepStrictEqual(d.entries[0], { id: 'OP13-001', count: 1 });
  assert.deepStrictEqual(d.entries[3], { id: 'PRB02-003', count: 2 });
  assert.strictEqual(d.entries.reduce((s, e) => s + e.count, 0), 51);
});

t('real text list gives the same deck; link + text together', () => {
  const [a] = E.parseDeckImports(URL1);
  const [b] = E.parseDeckImports(TEXT1);
  assert.deepStrictEqual(b.entries, a.entries);
  assert.deepStrictEqual(b.unknown, ['Decklist in text:']);
  assert.deepStrictEqual(b.meta, {});
  const both = E.parseDeckImports(URL1 + '\n\n' + TEXT1);
  assert.strictEqual(both.length, 1);
  assert.strictEqual(both[0].meta.name, 'RG Luffy');
  assert.deepStrictEqual(both[0].entries, a.entries);
});

t('several links in one paste make several decks', () => {
  const two = E.parseDeckImports(URL1 + '\n' + URL1.replace('dn=RG%20Luffy', 'dn=Copy'));
  assert.deepStrictEqual(two.map(d => d.meta.name), ['RG Luffy', 'Copy']);
  assert.strictEqual(E.isoDate('3/9/2026'), '2026-03-09');
});

t('bulk set by rarity, with undo', () => {
  const owned = { 'OP10-004': 1, 'OP10-005': 3, 'OP10-099': 2 };
  const ids = ['OP10-004', 'OP10-005', 'OP10-006'];
  const a = E.bulkSet(owned, ids, 'add', 2);
  assert.deepStrictEqual(a.owned, { 'OP10-004': 3, 'OP10-005': 5, 'OP10-006': 2, 'OP10-099': 2 });
  assert.deepStrictEqual(a.prev, { 'OP10-004': 1, 'OP10-005': 3, 'OP10-006': 0 });
  assert.deepStrictEqual(E.undoBulk(a.owned, a.prev), owned);
  const b = E.bulkSet(owned, ids, 'set', 0);
  assert.deepStrictEqual(b.owned, { 'OP10-099': 2 });
  assert.deepStrictEqual(E.undoBulk(b.owned, b.prev), owned);
  assert.deepStrictEqual(E.bulkSet(owned, ['OP10-004'], 'set', '-3').owned['OP10-004'], undefined, 'never below 0');
  assert.deepStrictEqual(owned, { 'OP10-004': 1, 'OP10-005': 3, 'OP10-099': 2 }, 'input untouched');
});

t('version labels: 異圖, SP and 重印', () => {
  assert.strictEqual(E.normRarity('SP卡'), 'SP');
  assert.strictEqual(E.normRarity('SR'), 'SR');
  assert.strictEqual(E.variantLabel({ id: 'OP09-004', rarity: 'SR' }), '');
  assert.strictEqual(E.variantLabel({ id: 'OP09-004_p1', rarity: 'SR' }), '異圖');
  assert.strictEqual(E.variantLabel({ id: 'OP09-004_p3', rarity: 'SP卡' }), 'SP');
  assert.strictEqual(E.variantLabel({ id: 'OP06-047_r1', rarity: 'R' }), '重印');
  // The official list writes "SP卡": searching SP must still find it, and 異圖 finds every version.
  const sp = { id: 'OP09-004_p3', name: 'x', rarity: 'SP卡' };
  assert.ok(E.matchCard(sp, E.parseQuery('SP'), 0));
  assert.ok(E.matchCard(sp, E.parseQuery('異圖'), 0));
  assert.ok(!E.matchCard({ id: 'OP09-004', name: 'x', rarity: 'SR' }, E.parseQuery('異圖'), 0));
  const prog = E.setProgress([{ id: 'OP09-004', rarity: 'SR' }, { id: 'OP09-004_p1', rarity: 'SR' }, sp], {}, 'OP09', true);
  assert.deepStrictEqual(Object.keys(prog.byRarity).sort(), ['SP', 'SR', '異圖']);
});

console.log(`\n${passed} tests passed`);
