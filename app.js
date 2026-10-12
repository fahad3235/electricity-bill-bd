/* Electricity Bill BD — offline bilingual BD residential electricity bill calculator.
 * Pure calculation/i18n/data logic is DOM-free so node --test can import this file.
 * Browser UI boot is guarded by typeof document !== 'undefined'.
 */
'use strict';

/* ------------------------------------------------------------------ */
/* Tariff configuration                                                */
/* ------------------------------------------------------------------ */

/* Default tariff config. DISCLAIMER: default rates from mid-2026 press
 * coverage of the BERC tariff revision; edit to match your Disco bill;
 * estimate only, not your official bill. */
const TARIFF_DEFAULTS = {
  slabs: [
    { min: 0,   max: 50,       rate: 5.32,  key: 'lifeline' },
    { min: 51,  max: 75,       rate: 6.18,  key: 's75' },
    { min: 76,  max: 200,      rate: 8.50,  key: 's200' },
    { min: 201, max: 300,      rate: 9.10,  key: 's300' },
    { min: 301, max: 400,      rate: 9.62,  key: 's400' },
    { min: 401, max: 600,      rate: 15.01, key: 's600' },
    { min: 601, max: Infinity, rate: 17.35, key: 'sPlus' },
  ],
  demandChargePerKw: 42,
  sanctionedLoadKw: 1,
  meterRent: 40,
  vatPct: 5,
};

const CONFIG_KEY = 'ebb-tariff-config-v1';
const HISTORY_KEY = 'ebb-bill-history-v1';
const LANG_KEY = 'ebb-lang-v1';

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function getStore() {
  if (typeof localStorage !== 'undefined') return localStorage;
  const mem = {};
  return {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; },
  };
}

/* Return a deep copy of defaults, with Infinity restored after JSON round-trips. */
function defaultConfig() {
  return {
    slabs: TARIFF_DEFAULTS.slabs.map((s) => ({ ...s })),
    demandChargePerKw: TARIFF_DEFAULTS.demandChargePerKw,
    sanctionedLoadKw: TARIFF_DEFAULTS.sanctionedLoadKw,
    meterRent: TARIFF_DEFAULTS.meterRent,
    vatPct: TARIFF_DEFAULTS.vatPct,
  };
}

function sanitizeConfig(raw) {
  const d = defaultConfig();
  if (!raw || typeof raw !== 'object') return d;
  const cfg = {
    slabs: d.slabs,
    demandChargePerKw: d.demandChargePerKw,
    sanctionedLoadKw: d.sanctionedLoadKw,
    meterRent: d.meterRent,
    vatPct: d.vatPct,
  };
  if (Array.isArray(raw.slabs) && raw.slabs.length === d.slabs.length) {
    cfg.slabs = raw.slabs.map((s, i) => ({
      min: d.slabs[i].min,
      max: d.slabs[i].max,
      key: d.slabs[i].key,
      rate: numOr(s && s.rate, d.slabs[i].rate),
    }));
  }
  cfg.demandChargePerKw = numOr(raw.demandChargePerKw, d.demandChargePerKw);
  cfg.sanctionedLoadKw = numOr(raw.sanctionedLoadKw, d.sanctionedLoadKw);
  cfg.meterRent = numOr(raw.meterRent, d.meterRent);
  cfg.vatPct = numOr(raw.vatPct, d.vatPct);
  return cfg;
}

function numOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function loadConfig(store) {
  store = store || getStore();
  try {
    const raw = store.getItem(CONFIG_KEY);
    if (!raw) return defaultConfig();
    return sanitizeConfig(JSON.parse(raw));
  } catch (e) {
    return defaultConfig();
  }
}

function saveConfig(cfg, store) {
  store = store || getStore();
  const slim = { ...cfg, slabs: cfg.slabs.map((s) => ({ rate: s.rate })) };
  store.setItem(CONFIG_KEY, JSON.stringify(slim));
}

/* ------------------------------------------------------------------ */
/* Bill calculation — Bangladesh rule: the WHOLE consumption is billed */
/* at the single flat rate of the slab it falls into (NOT marginal     */
/* blocks). Lifeline applies to <= 50 units.                           */
/* ------------------------------------------------------------------ */

function findSlab(units, cfg) {
  cfg = cfg || TARIFF_DEFAULTS;
  for (const s of cfg.slabs) {
    if (units >= s.min && units <= s.max) return s;
  }
  return cfg.slabs[cfg.slabs.length - 1];
}

function calcBill(units, cfg) {
  cfg = cfg || defaultConfig();
  const slab = findSlab(units, cfg);
  const energy = round2(units * slab.rate);
  const demand = round2(cfg.demandChargePerKw * cfg.sanctionedLoadKw);
  const rent = round2(cfg.meterRent);
  const subtotal = round2(energy + demand + rent);
  const vat = round2((subtotal * cfg.vatPct) / 100);
  const total = round2(subtotal + vat);
  return { units, slab, energy, demand, rent, subtotal, vat, total };
}

function validateUnits(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (text === '') return { ok: false, value: 0, error: 'required' };
  const n = Number(text);
  if (!Number.isFinite(n)) return { ok: false, value: 0, error: 'notNumber' };
  if (n < 0) return { ok: false, value: 0, error: 'negative' };
  if (n > 100000) return { ok: false, value: 0, error: 'tooLarge' };
  return { ok: true, value: n, error: null };
}

/* ------------------------------------------------------------------ */
/* Bill history                                                        */
/* ------------------------------------------------------------------ */

function loadHistory(store) {
  store = store || getStore();
  try {
    const raw = store.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(validBillEntry) : [];
  } catch (e) {
    return [];
  }
}

function saveHistory(list, store) {
  store = store || getStore();
  store.setItem(HISTORY_KEY, JSON.stringify(list));
}

function makeId() {
  return 'b' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}

function addBill(list, month, units, total) {
  const entry = { id: makeId(), month: String(month).slice(0, 40), units: round2(units), total: round2(total), savedAt: new Date().toISOString() };
  return [entry].concat(list);
}

function deleteBill(list, id) {
  return list.filter((b) => b.id !== id);
}

function validBillEntry(b) {
  return b && typeof b === 'object' &&
    typeof b.id === 'string' && b.id.length > 0 &&
    typeof b.month === 'string' &&
    Number.isFinite(Number(b.units)) && Number(b.units) >= 0 &&
    Number.isFinite(Number(b.total)) && Number(b.total) >= 0;
}

function historyStats(list) {
  const n = list.length;
  if (n === 0) return { count: 0, totalUnits: 0, totalBill: 0, avgUnits: 0, avgBill: 0 };
  const totalUnits = round2(list.reduce((a, b) => a + Number(b.units), 0));
  const totalBill = round2(list.reduce((a, b) => a + Number(b.total), 0));
  return { count: n, totalUnits, totalBill, avgUnits: round2(totalUnits / n), avgBill: round2(totalBill / n) };
}

function exportHistoryJSON(list) {
  return JSON.stringify({ app: 'electricity-bill-bd', version: 1, exportedAt: new Date().toISOString(), bills: list }, null, 2);
}

/* Returns { ok:true, bills } or { ok:false, error } — existing list is
 * never mutated here; the caller only replaces on ok:true. */
function importHistoryJSON(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: 'invalidJson' };
  }
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.bills)) {
    return { ok: false, error: 'badShape' };
  }
  const bills = obj.bills.filter(validBillEntry);
  if (obj.bills.length > 0 && bills.length === 0) return { ok: false, error: 'noValidBills' };
  return { ok: true, bills };
}

/* ------------------------------------------------------------------ */
/* Savings estimator: cut X units off a baseline bill                  */
/* ------------------------------------------------------------------ */

function estimateSavings(baseUnits, cutUnits, cfg) {
  cfg = cfg || defaultConfig();
  const before = calcBill(baseUnits, cfg);
  const afterUnits = Math.max(0, round2(baseUnits - cutUnits));
  const after = calcBill(afterUnits, cfg);
  const monthly = round2(before.total - after.total);
  const yearly = round2(monthly * 12);
  return { before, after, afterUnits, monthly, yearly };
}

/* ------------------------------------------------------------------ */
/* i18n                                                                */
/* ------------------------------------------------------------------ */

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

function toBnDigits(input) {
  return String(input).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
}

function fmtNum(n, lang) {
  const s = Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return lang === 'bn' ? toBnDigits(s) : s;
}

function fmtInt(n, lang) {
  const s = Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
  return lang === 'bn' ? toBnDigits(s) : s;
}

function slabLabel(slab, lang) {
  const names = {
    en: { lifeline: 'Lifeline (0–50)', s75: '0–75', s200: '76–200', s300: '201–300', s400: '301–400', s600: '401–600', sPlus: '601+' },
    bn: { lifeline: 'লাইফলাইন (০–৫০)', s75: '০–৭৫', s200: '৭৬–২০০', s300: '২০১–৩০০', s400: '৩০১–৪০০', s600: '৪০১–৬০০', sPlus: '৬০১+' },
  };
  return (names[lang] || names.en)[slab.key] || slab.key;
}

const STR = {
  en: {
    appTitle: 'Electricity Bill BD',
    tagline: 'Bangladesh residential electricity bill calculator',
    calcTitle: 'Bill calculator',
    unitsLabel: 'Monthly units (kWh)',
    unitsHint: 'Enter the units consumed this month',
    calcBtn: 'Calculate bill',
    saveBtn: 'Save this bill',
    monthLabel: 'Month label',
    monthHint: 'e.g. Oct 2026',
    appliedSlab: 'Applied slab',
    ratePerUnit: 'Rate per unit',
    energyCharge: 'Energy charge',
    demandCharge: 'Demand charge',
    meterRent: 'Meter rent',
    vatRow: 'VAT',
    totalBill: 'Total bill',
    configTitle: 'Rate configuration',
    configHint: 'Edit any rate — saved automatically on your device.',
    slabRates: 'Slab rates (৳/unit)',
    demandPerKw: 'Demand charge (৳/kW)',
    loadKw: 'Sanctioned load (kW)',
    rentLabel: 'Meter rent (৳)',
    vatLabel: 'VAT (%)',
    resetDefaults: 'Reset to defaults',
    savedMsg: 'Settings saved.',
    historyTitle: 'Bill history',
    historyEmpty: 'No bills saved yet. Calculate a bill above and save it to track your usage.',
    colMonth: 'Month',
    colUnits: 'Units',
    colTotal: 'Total (৳)',
    colDel: '',
    delLabel: 'Delete',
    totalUnits: 'Total units',
    totalAmount: 'Total amount',
    avgUnits: 'Average units',
    avgBill: 'Average bill',
    exportBtn: 'Export JSON',
    importBtn: 'Import JSON',
    wipeBtn: 'Wipe all',
    wipeConfirm: 'Delete ALL saved bills? This cannot be undone.',
    importOk: 'Import successful.',
    importErr: 'Import failed: file is not valid bill data. Your existing bills are unchanged.',
    savingsTitle: 'Savings estimator',
    savingsHint: 'See how cutting usage lowers your bill.',
    cutLabel: 'Cut units by (kWh)',
    baseLabel: 'Baseline',
    baseCurrent: 'Current calculation',
    estimateBtn: 'Estimate savings',
    newSlab: 'New slab',
    newBill: 'Projected bill',
    monthlySave: 'Monthly savings',
    yearlySave: 'Yearly savings',
    needCalcFirst: 'Calculate a bill first to use the savings estimator.',
    billSaved: 'Bill saved to history.',
    disclaimer: 'Estimate only — not your official bill. Default rates from mid-2026 press coverage of the BERC tariff revision; edit to match your Disco bill.',
    errRequired: 'Please enter your monthly units.',
    errNotNumber: 'Please enter a valid number.',
    errNegative: 'Units cannot be negative.',
    errTooLarge: 'Units look too large (max 100,000).',
    footerNote: 'Fully offline — all data stays in your browser (localStorage).',
    slabRule: 'Bangladesh billing rule: your whole consumption is billed at the single flat rate of the slab it falls into — not block-by-block.',
  },
  bn: {
    appTitle: 'বিদ্যুৎ বিল বিডি',
    tagline: 'বাংলাদেশ আবাসিক বিদ্যুৎ বিল ক্যালকুলেটর',
    calcTitle: 'বিল ক্যালকুলেটর',
    unitsLabel: 'মাসিক ইউনিট (kWh)',
    unitsHint: 'এই মাসে ব্যবহৃত ইউনিট লিখুন',
    calcBtn: 'বিল হিসাব করুন',
    saveBtn: 'এই বিল সংরক্ষণ করুন',
    monthLabel: 'মাসের নাম',
    monthHint: 'যেমন: অক্টোবর ২০২৬',
    appliedSlab: 'প্রযোজ্য স্ল্যাব',
    ratePerUnit: 'প্রতি ইউনিট রেট',
    energyCharge: 'এনার্জি চার্জ',
    demandCharge: 'ডিমান্ড চার্জ',
    meterRent: 'মিটার ভাড়া',
    vatRow: 'ভ্যাট',
    totalBill: 'মোট বিল',
    configTitle: 'রেট সেটিংস',
    configHint: 'যেকোনো রেট পরিবর্তন করুন — আপনার ডিভাইসে স্বয়ংক্রিয়ভাবে সংরক্ষিত হবে।',
    slabRates: 'স্ল্যাব রেট (৳/ইউনিট)',
    demandPerKw: 'ডিমান্ড চার্জ (৳/kW)',
    loadKw: 'অনুমোদিত লোড (kW)',
    rentLabel: 'মিটার ভাড়া (৳)',
    vatLabel: 'ভ্যাট (%)',
    resetDefaults: 'ডিফল্টে ফিরুন',
    savedMsg: 'সেটিংস সংরক্ষিত হয়েছে।',
    historyTitle: 'বিলের ইতিহাস',
    historyEmpty: 'এখনও কোনো বিল সংরক্ষিত হয়নি। উপরে বিল হিসাব করে সংরক্ষণ করুন।',
    colMonth: 'মাস',
    colUnits: 'ইউনিট',
    colTotal: 'মোট (৳)',
    colDel: '',
    delLabel: 'মুছুন',
    totalUnits: 'মোট ইউনিট',
    totalAmount: 'মোট টাকা',
    avgUnits: 'গড় ইউনিট',
    avgBill: 'গড় বিল',
    exportBtn: 'JSON এক্সপোর্ট',
    importBtn: 'JSON ইমপোর্ট',
    wipeBtn: 'সব মুছুন',
    wipeConfirm: 'সব সংরক্ষিত বিল মুছে ফেলবেন? এটি ফেরত যাবে না।',
    importOk: 'ইমপোর্ট সফল হয়েছে।',
    importErr: 'ইমপোর্ট ব্যর্থ: ফাইলটি বৈধ বিল ডেটা নয়। আপনার আগের বিলগুলো অপরিবর্তিত আছে।',
    savingsTitle: 'সাশ্রয় হিসাব',
    savingsHint: 'ব্যবহার কমালে বিল কত কমবে দেখুন।',
    cutLabel: 'কত ইউনিট কমাবেন (kWh)',
    baseLabel: 'বেসলাইন',
    baseCurrent: 'বর্তমান হিসাব',
    estimateBtn: 'সাশ্রয় দেখুন',
    newSlab: 'নতুন স্ল্যাব',
    newBill: 'আনুমানিক বিল',
    monthlySave: 'মাসিক সাশ্রয়',
    yearlySave: 'বার্ষিক সাশ্রয়',
    needCalcFirst: 'সাশ্রয় হিসাব করতে আগে একটি বিল হিসাব করুন।',
    billSaved: 'বিল ইতিহাসে সংরক্ষিত হয়েছে।',
    disclaimer: 'শুধু আনুমানিক হিসাব — আপনার অফিসিয়াল বিল নয়। ডিফল্ট রেট BERC ট্যারিফ সংশোধনের মাঝ-২০২৬ প্রেস কভারেজ থেকে নেওয়া; আপনার ডিসকো বিলের সাথে মিলিয়ে সম্পাদনা করুন।',
    errRequired: 'আপনার মাসিক ইউনিট লিখুন।',
    errNotNumber: 'সঠিক সংখ্যা লিখুন।',
    errNegative: 'ইউনিট ঋণাত্মক হতে পারে না।',
    errTooLarge: 'ইউনিট অনেক বেশি মনে হচ্ছে (সর্বোচ্চ ১,০০,০০০)।',
    footerNote: 'সম্পূর্ণ অফলাইন — সব ডেটা আপনার ব্রাউজারে (localStorage) থাকে।',
    slabRule: 'বাংলাদেশের বিল নিয়ম: আপনার পুরো ব্যবহার যে স্ল্যাবে পড়ে সেই একক ফ্ল্যাট রেটে বিল হয় — ধাপে ধাপে নয়।',
  },
};

function t(key, lang) {
  return (STR[lang] && STR[lang][key]) || STR.en[key] || key;
}

/* Node/test exports */
if (typeof module !== 'undefined' && module.exports) {  module.exports = {
    TARIFF_DEFAULTS, defaultConfig, sanitizeConfig, loadConfig, saveConfig,
    findSlab, calcBill, validateUnits, round2,
    loadHistory, saveHistory, addBill, deleteBill, historyStats,
    exportHistoryJSON, importHistoryJSON,
    estimateSavings, toBnDigits, fmtNum, fmtInt, slabLabel, t, STR,
    CONFIG_KEY, HISTORY_KEY, LANG_KEY,
  };
}

/* Browser smoke-test hook (harmless in production) */
if (typeof window !== 'undefined') {
  window.__ebb = { importHistoryJSON, exportHistoryJSON, validateUnits, calcBill, findSlab, defaultConfig, TARIFF_DEFAULTS };
}

/* ------------------------------------------------------------------ */
/* Browser UI                                                           */
/* ------------------------------------------------------------------ */

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => initApp());
}

function initApp() {
  const store = getStore();
  let lang = store.getItem(LANG_KEY) === 'bn' ? 'bn' : 'en';
  let cfg = loadConfig(store);
  let history = loadHistory(store);
  let currentBill = null;
  let currentUnits = 0;

  const $ = (id) => document.getElementById(id);

  function applyI18n() {
    document.documentElement.lang = lang === 'bn' ? 'bn' : 'en';
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'), lang);
    });
    document.querySelectorAll('[data-i18n-ph]').forEach((el) => {
      el.placeholder = t(el.getAttribute('data-i18n-ph'), lang);
    });
    $('langToggle').textContent = lang === 'en' ? 'বাংলা' : 'English';
    $('langToggle').setAttribute('aria-label', lang === 'en' ? 'Switch to Bengali' : 'Switch to English');
    buildConfigForm();
    renderHistory();
    if (currentBill) renderBill(currentBill, currentUnits);
    renderSavingsBase();
  }

  /* ---- calculator ---- */
  function showError(key) {
    const el = $('unitsError');
    el.textContent = t(key, lang);
    el.hidden = false;
    $('unitsInput').setAttribute('aria-invalid', 'true');
  }
  function clearError() {
    $('unitsError').hidden = true;
    $('unitsInput').removeAttribute('aria-invalid');
  }

  function renderBill(bill, units) {
    currentBill = bill; currentUnits = units;
    const rows = [
      [t('appliedSlab', lang), slabLabel(bill.slab, lang)],
      [t('ratePerUnit', lang), '৳ ' + fmtNum(bill.slab.rate, lang)],
      [t('energyCharge', lang), '৳ ' + fmtNum(bill.energy, lang)],
      [t('demandCharge', lang), '৳ ' + fmtNum(bill.demand, lang)],
      [t('meterRent', lang), '৳ ' + fmtNum(bill.rent, lang)],
      [t('vatRow', lang) + ' (' + fmtInt(cfg.vatPct, lang) + '%)', '৳ ' + fmtNum(bill.vat, lang)],
    ];
    $('billRows').innerHTML = rows.map(([k, v]) =>
      '<tr><th scope="row">' + escapeHtml(k) + '</th><td>' + escapeHtml(v) + '</td></tr>').join('');
    $('billTotal').textContent = '৳ ' + fmtNum(bill.total, lang);
    $('billResult').hidden = false;
    $('saveWrap').hidden = false;
    renderSavingsBase();
  }

  $('calcBtn').addEventListener('click', () => {
    clearError();
    const v = validateUnits($('unitsInput').value);
    if (!v.ok) { showError('err' + v.error[0].toUpperCase() + v.error.slice(1)); return; }
    renderBill(calcBill(v.value, cfg), v.value);
  });
  $('unitsInput').addEventListener('input', clearError);
  $('unitsInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('calcBtn').click(); });

  /* ---- save bill ---- */
  $('saveBtn').addEventListener('click', () => {
    if (!currentBill) return;
    const month = $('monthInput').value.trim() || new Date().toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', { month: 'short', year: 'numeric' });
    history = addBill(history, month, currentUnits, currentBill.total);
    saveHistory(history, store);
    renderHistory();
    $('saveMsg').textContent = t('billSaved', lang);
    $('saveMsg').hidden = false;
    setTimeout(() => { $('saveMsg').hidden = true; }, 2500);
  });

  /* ---- config form ---- */
  function buildConfigForm() {
    const wrap = $('slabRatesWrap');
    wrap.innerHTML = '';
    cfg.slabs.forEach((s, i) => {
      const label = document.createElement('label');
      label.className = 'field inline';
      const span = document.createElement('span');
      span.textContent = slabLabel(s, lang);
      const input = document.createElement('input');
      input.type = 'number'; input.min = '0'; input.step = '0.01';
      input.value = s.rate; input.dataset.slabIdx = i;
      input.setAttribute('aria-label', slabLabel(s, lang) + ' rate');
      input.addEventListener('change', () => {
        cfg.slabs[i].rate = numOr(input.value, cfg.slabs[i].rate);
        saveConfig(cfg, store); showSavedMsg();
      });
      label.appendChild(span); label.appendChild(input);
      wrap.appendChild(label);
    });
    $('demandInput').value = cfg.demandChargePerKw;
    $('loadInput').value = cfg.sanctionedLoadKw;
    $('rentInput').value = cfg.meterRent;
    $('vatInput').value = cfg.vatPct;
  }
  function showSavedMsg() {
    const el = $('configMsg');
    el.textContent = t('savedMsg', lang); el.hidden = false;
    clearTimeout(showSavedMsg._t);
    showSavedMsg._t = setTimeout(() => { el.hidden = true; }, 2000);
  }
  [['demandInput', 'demandChargePerKw'], ['loadInput', 'sanctionedLoadKw'], ['rentInput', 'meterRent'], ['vatInput', 'vatPct']]
    .forEach(([id, key]) => {
      $(id).addEventListener('change', () => {
        cfg[key] = numOr($(id).value, cfg[key]);
        saveConfig(cfg, store); showSavedMsg();
      });
    });
  $('resetCfgBtn').addEventListener('click', () => {
    cfg = defaultConfig(); saveConfig(cfg, store); buildConfigForm(); showSavedMsg();
    if (currentBill) renderBill(calcBill(currentUnits, cfg), currentUnits);
  });

  /* ---- history ---- */
  function renderHistory() {
    const tbody = $('historyBody');
    tbody.innerHTML = '';
    if (history.length === 0) {
      $('historyEmpty').hidden = false;
      $('historyTableWrap').hidden = true;
    } else {
      $('historyEmpty').hidden = true;
      $('historyTableWrap').hidden = false;
      history.forEach((b) => {
        const tr = document.createElement('tr');
        const tdM = document.createElement('td'); tdM.textContent = b.month;
        const tdU = document.createElement('td'); tdU.textContent = fmtInt(b.units, lang); tdU.className = 'num';
        const tdT = document.createElement('td'); tdT.textContent = fmtNum(b.total, lang); tdT.className = 'num';
        const tdD = document.createElement('td');
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'btn danger small';
        btn.textContent = t('delLabel', lang);
        btn.setAttribute('aria-label', t('delLabel', lang) + ' ' + b.month);
        btn.addEventListener('click', () => {
          history = deleteBill(history, b.id);
          saveHistory(history, store); renderHistory();
        });
        tdD.appendChild(btn);
        tr.append(tdM, tdU, tdT, tdD);
        tbody.appendChild(tr);
      });
    }
    const st = historyStats(history);
    $('statUnits').textContent = fmtInt(st.totalUnits, lang);
    $('statAmount').textContent = '৳ ' + fmtNum(st.totalBill, lang);
    $('statAvgUnits').textContent = fmtInt(st.avgUnits, lang);
    $('statAvgBill').textContent = '৳ ' + fmtNum(st.avgBill, lang);
    renderSavingsBase();
  }

  $('exportBtn').addEventListener('click', () => {
    const blob = new Blob([exportHistoryJSON(history)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'electricity-bill-bd-history.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });
  $('importFile').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => doImport(String(reader.result));
    reader.readAsText(f);
    e.target.value = '';
  });
  function doImport(text) {
    const res = importHistoryJSON(text);
    const msg = $('importMsg');
    if (res.ok) {
      history = res.bills;
      saveHistory(history, store); renderHistory();
      msg.textContent = t('importOk', lang); msg.className = 'msg ok';
    } else {
      msg.textContent = t('importErr', lang); msg.className = 'msg err';
    }
    msg.hidden = false;
    setTimeout(() => { msg.hidden = true; }, 4000);
  }
  $('wipeBtn').addEventListener('click', () => {
    if (window.confirm(t('wipeConfirm', lang))) {
      history = []; saveHistory(history, store); renderHistory();
    }
  });

  /* ---- savings ---- */
  function renderSavingsBase() {
    const sel = $('baseSelect');
    const cur = sel.value;
    sel.innerHTML = '';
    const opt = document.createElement('option');
    opt.value = 'current';
    opt.textContent = currentBill
      ? t('baseCurrent', lang) + ' (' + fmtInt(currentUnits, lang) + ' ' + t('colUnits', lang).toLowerCase() + ' · ৳ ' + fmtNum(currentBill.total, lang) + ')'
      : t('baseCurrent', lang) + ' —';
    sel.appendChild(opt);
    history.forEach((b) => {
      const o = document.createElement('option');
      o.value = b.id;
      o.textContent = b.month + ' (' + fmtInt(b.units, lang) + ' · ৳ ' + fmtNum(b.total, lang) + ')';
      sel.appendChild(o);
    });
    if (cur) sel.value = cur;
  }
  $('estimateBtn').addEventListener('click', () => {
    const out = $('savingsOut'); out.hidden = true;
    const selVal = $('baseSelect').value;
    let baseUnits = null;
    if (selVal === 'current') {
      if (!currentBill) { $('savingsMsg').textContent = t('needCalcFirst', lang); $('savingsMsg').hidden = false; return; }
      baseUnits = currentUnits;
    } else {
      const b = history.find((x) => x.id === selVal);
      if (!b) return;
      baseUnits = Number(b.units);
    }
    $('savingsMsg').hidden = true;
    const cut = numOr($('cutInput').value, NaN);
    if (!Number.isFinite(cut) || cut < 0 || cut >= baseUnits) {
      $('savingsMsg').textContent = t(cut >= baseUnits ? 'errTooLarge' : 'errNotNumber', lang);
      $('savingsMsg').hidden = false; return;
    }
    const r = estimateSavings(baseUnits, cut, cfg);
    $('svSlab').textContent = slabLabel(r.after.slab, lang);
    $('svBill').textContent = '৳ ' + fmtNum(r.after.total, lang);
    $('svMonthly').textContent = '৳ ' + fmtNum(r.monthly, lang);
    $('svYearly').textContent = '৳ ' + fmtNum(r.yearly, lang);
    out.hidden = false;
  });

  /* ---- language ---- */
  $('langToggle').addEventListener('click', () => {
    lang = lang === 'en' ? 'bn' : 'en';
    store.setItem(LANG_KEY, lang);
    applyI18n();
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  applyI18n();
}
