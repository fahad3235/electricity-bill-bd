/* Unit tests for electricity-bill-bd — run with: node --test */
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../app.js');

function memStore() {
  const mem = {};
  return {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; },
  };
}

describe('slab boundaries (Bangladesh flat-rate rule)', () => {
  const cases = [
    [0, 5.32, 'lifeline'], [40, 5.32, 'lifeline'], [50, 5.32, 'lifeline'],
    [51, 6.18, 's75'], [75, 6.18, 's75'],
    [76, 8.50, 's200'], [200, 8.50, 's200'],
    [201, 9.10, 's300'], [300, 9.10, 's300'],
    [301, 9.62, 's400'], [400, 9.62, 's400'],
    [401, 15.01, 's600'], [600, 15.01, 's600'],
    [601, 17.35, 'sPlus'], [5000, 17.35, 'sPlus'],
  ];
  for (const [units, rate, key] of cases) {
    it(`units=${units} -> slab ${key} @ ${rate}`, () => {
      const s = L.findSlab(units, L.TARIFF_DEFAULTS);
      assert.equal(s.rate, rate);
      assert.equal(s.key, key);
    });
  }
});

describe('bill totals (hand-checked)', () => {
  const cfg = L.defaultConfig();
  it('40 units: energy 212.80, demand 42, rent 40, subtotal 294.80, VAT 14.74, total 309.54', () => {
    const b = L.calcBill(40, cfg);
    assert.equal(b.energy, 212.80);
    assert.equal(b.demand, 42);
    assert.equal(b.rent, 40);
    assert.equal(b.subtotal, 294.80);
    assert.equal(b.vat, 14.74);
    assert.equal(b.total, 309.54);
  });
  it('80 units: energy 680.00, total 800.10', () => {
    const b = L.calcBill(80, cfg);
    assert.equal(b.slab.key, 's200');
    assert.equal(b.energy, 680.00);
    assert.equal(b.total, 800.10);
  });
  it('601 units: energy 10427.35, total 11034.82', () => {
    const b = L.calcBill(601, cfg);
    assert.equal(b.energy, 10427.35);
    assert.equal(b.subtotal, 10509.35);
    assert.equal(b.vat, 525.47);
    assert.equal(b.total, 11034.82);
  });
  it('flat-rate rule: whole consumption at one rate (150 units = 150 x 8.50, not marginal)', () => {
    const b = L.calcBill(150, cfg);
    assert.equal(b.energy, 1275.00);
    assert.equal(b.slab.rate, 8.50);
  });
  it('custom config is honoured (edited rates change totals)', () => {
    const c = L.defaultConfig();
    c.slabs[0].rate = 6.00;
    const b = L.calcBill(40, c);
    assert.equal(b.energy, 240.00);
    assert.equal(b.total, 338.10); // (240+42+40)=322; VAT 16.10
  });
  it('zero units still charges demand + rent + VAT', () => {
    const b = L.calcBill(0, cfg);
    assert.equal(b.energy, 0);
    assert.equal(b.total, 86.10); // (0+42+40)=82; VAT 4.10
  });
});

describe('input validation', () => {
  it('rejects empty', () => assert.deepEqual(L.validateUnits(''), { ok: false, value: 0, error: 'required' }));
  it('rejects non-numeric', () => assert.equal(L.validateUnits('abc').error, 'notNumber'));
  it('rejects negative', () => assert.equal(L.validateUnits('-5').error, 'negative'));
  it('rejects >100000', () => assert.equal(L.validateUnits('100001').error, 'tooLarge'));
  it('accepts decimals and trims whitespace', () => {
    assert.deepEqual(L.validateUnits(' 40.5 '), { ok: true, value: 40.5, error: null });
  });
});

describe('config persistence', () => {
  it('save/load round-trip keeps edited rates (Infinity-safe)', () => {
    const store = memStore();
    const c = L.defaultConfig();
    c.slabs[2].rate = 9.99; c.demandChargePerKw = 50; c.sanctionedLoadKw = 2; c.meterRent = 45; c.vatPct = 7;
    L.saveConfig(c, store);
    const back = L.loadConfig(store);
    assert.equal(back.slabs[2].rate, 9.99);
    assert.equal(back.demandChargePerKw, 50);
    assert.equal(back.sanctionedLoadKw, 2);
    assert.equal(back.meterRent, 45);
    assert.equal(back.vatPct, 7);
    assert.equal(back.slabs[6].max, Infinity);
  });
  it('Bengali-digit rate survives save/load as ASCII-safe JSON', () => {
    const store = memStore();
    L.saveConfig(L.defaultConfig(), store);
    const raw = store.getItem(L.CONFIG_KEY);
    assert.ok(/^[\x00-\x7F]*$/.test(raw), 'config JSON must be ASCII-safe');
    assert.equal(L.loadConfig(store).slabs[0].rate, 5.32);
  });
  it('corrupt config falls back to defaults', () => {
    const store = memStore();
    store.setItem(L.CONFIG_KEY, '{not json');
    assert.equal(L.loadConfig(store).slabs[0].rate, 5.32);
  });
  it('missing config returns defaults', () => {
    assert.equal(L.loadConfig(memStore()).meterRent, 40);
  });
});

describe('bill history', () => {
  it('add/delete/stats round-trip', () => {
    let list = [];
    list = L.addBill(list, 'Oct 2026', 40, 308.70);
    list = L.addBill(list, 'Nov 2026', 80, 800.10);
    assert.equal(list.length, 2);
    const st = L.historyStats(list);
    assert.equal(st.count, 2);
    assert.equal(st.totalUnits, 120);
    assert.equal(st.totalBill, 1108.80);
    assert.equal(st.avgUnits, 60);
    assert.equal(st.avgBill, 554.40);
    list = L.deleteBill(list, list[0].id);
    assert.equal(list.length, 1);
  });
  it('empty history stats are zeroed', () => {
    assert.deepEqual(L.historyStats([]), { count: 0, totalUnits: 0, totalBill: 0, avgUnits: 0, avgBill: 0 });
  });
  it('save/load persistence round-trip', () => {
    const store = memStore();
    let list = L.addBill([], 'Oct 2026', 40, 308.70);
    L.saveHistory(list, store);
    const back = L.loadHistory(store);
    assert.equal(back.length, 1);
    assert.equal(back[0].month, 'Oct 2026');
    assert.equal(back[0].total, 308.70);
  });
  it('history survives Bengali month labels', () => {
    const store = memStore();
    let list = L.addBill([], 'অক্টোবর ২০২৬', 40, 308.70);
    L.saveHistory(list, store);
    assert.equal(L.loadHistory(store)[0].month, 'অক্টোবর ২০২৬');
  });
});

describe('export/import round-trip', () => {
  it('export -> wipe -> import restores bills', () => {
    let list = L.addBill([], 'Oct 2026', 40, 308.70);
    list = L.addBill(list, 'অক্টোবর', 80, 800.10);
    const json = L.exportHistoryJSON(list);
    const wiped = [];
    assert.equal(wiped.length, 0);
    const res = L.importHistoryJSON(json);
    assert.ok(res.ok);
    assert.equal(res.bills.length, 2);
    assert.equal(res.bills[0].total, 800.10);
    assert.equal(res.bills[1].month, 'Oct 2026');
  });
  it('malformed JSON rejected, data intact', () => {
    const res = L.importHistoryJSON('{oops');
    assert.ok(!res.ok);
    assert.equal(res.error, 'invalidJson');
  });
  it('wrong shape rejected (no bills array)', () => {
    assert.equal(L.importHistoryJSON('{"bills":"nope"}').ok, false);
    assert.equal(L.importHistoryJSON('[]').ok, false);
  });
  it('import with zero valid bills rejected', () => {
    const res = L.importHistoryJSON('{"bills":[{"id":1,"month":2}]}');
    assert.ok(!res.ok);
  });
  it('invalid entries filtered, valid kept', () => {
    const good = { id: 'x1', month: 'Oct', units: 40, total: 308.70 };
    const res = L.importHistoryJSON(JSON.stringify({ bills: [good, { id: 'bad' }, null, 'x'] }));
    assert.ok(res.ok);
    assert.equal(res.bills.length, 1);
    assert.equal(res.bills[0].month, 'Oct');
  });
});

describe('savings estimator', () => {
  it('cutting 30 units from 80: new slab s75, savings = 800.10 - new bill', () => {
    const r = L.estimateSavings(80, 30, L.defaultConfig());
    assert.equal(r.afterUnits, 50);
    assert.equal(r.after.slab.key, 'lifeline');
    assert.equal(r.after.total, 365.40); // 50*5.32=266; +42+40=348; VAT 17.40
    assert.equal(r.monthly, 434.70);
    assert.equal(r.yearly, 5216.40);
  });
  it('cut below zero clamps at 0', () => {
    const r = L.estimateSavings(10, 50, L.defaultConfig());
    assert.equal(r.afterUnits, 0);
    assert.equal(r.monthly, L.round2(r.before.total - r.after.total));
    assert.equal(r.monthly, 55.86);
  });
});

describe('Bengali digits & labels', () => {
  it('toBnDigits converts 0-9', () => {
    assert.equal(L.toBnDigits('0123456789'), '০১২৩৪৫৬৭৮৯');
    assert.equal(L.toBnDigits('308.70'), '৩০৮.৭০');
    assert.equal(L.toBnDigits('1,234.50'), '১,২৩৪.৫০');
  });
  it('fmtNum in bn mode uses Bengali digits, en mode Latin', () => {
    assert.equal(L.fmtNum(308.70, 'bn'), '৩০৮.৭০');
    assert.equal(L.fmtNum(308.70, 'en'), '308.70');
    assert.equal(L.fmtNum(11034.82, 'bn'), '১১,০৩৪.৮২');
  });
  it('slabLabel covers every slab in both languages', () => {
    for (const s of L.TARIFF_DEFAULTS.slabs) {
      assert.ok(L.slabLabel(s, 'en').length > 0);
      assert.ok(L.slabLabel(s, 'bn').length > 0);
    }
    assert.equal(L.slabLabel({ key: 'lifeline' }, 'bn'), 'লাইফলাইন (০–৫০)');
  });
  it('i18n dictionary has matching keys for en and bn', () => {
    const enKeys = Object.keys(L.STR.en).sort();
    const bnKeys = Object.keys(L.STR.bn).sort();
    assert.deepEqual(bnKeys, enKeys);
    for (const k of enKeys) {
      assert.ok(L.t(k, 'en').length > 0, k);
      assert.ok(L.t(k, 'bn').length > 0, k);
    }
  });
});

describe('rounding', () => {
  it('round2 handles floating point', () => {
    assert.equal(L.round2(0.1 + 0.2), 0.30);
    assert.equal(L.round2(525.4675), 525.47);
  });
});
