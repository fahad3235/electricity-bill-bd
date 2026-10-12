# ⚡ Electricity Bill BD

![offline](https://img.shields.io/badge/offline-100%25-brightgreen) ![bilingual](https://img.shields.io/badge/EN-%E0%A6%AC%E0%A6%BE%E0%A6%82%E0%A6%B2%E0%A6%BE-blue) ![tests](https://img.shields.io/badge/tests-46%2F46_passing-brightgreen) ![smoke](https://img.shields.io/badge/smoke-38%2F38_passing-brightgreen) ![license](https://img.shields.io/badge/license-MIT-lightgrey)

A free, fully offline, bilingual (English / বাংলা) Bangladesh residential electricity bill calculator.

## The problem

Bangladesh residential electricity bills use a slab system where your **entire** monthly consumption is billed at the single flat rate of the slab it falls into — not block-by-block like some countries. Many people miscalculate their bill by applying marginal blocks, or can't quickly tell which slab they're in and what cutting a few units would save.

## Features

1. **Bill calculator** — enter monthly units (kWh); the app finds your slab and shows: applied slab, per-unit rate, energy charge, demand charge, meter rent, VAT 5% on (energy + demand + rent), and the total bill.
2. **Slab logic** — Lifeline (≤ 50 units), 0–75, 76–200, 201–300, 301–400, 401–600, 601+, applied as a flat rate on the whole consumption.
3. **Editable rate configuration** — all 7 slab rates, demand charge (৳/kW), sanctioned load (kW), meter rent, and VAT % are editable, persisted in `localStorage`, with a reset-to-defaults button.
4. **Bill history** — save bills with a month label; table with delete, totals, average units and average bill; JSON export → wipe → import round-trip; malformed imports are rejected and your data stays intact.
5. **Savings estimator** — pick a baseline (current calculation or a saved bill) and a "cut X units" target; see the new slab, projected bill, monthly and yearly savings.
6. **Full EN/বাংলা i18n** — one-tap toggle (persisted), Bengali digits for all numbers in বাংলা mode, inline validation errors, empty states, responsive down to 390px.

## Stack

Vanilla HTML + CSS + JavaScript. No frameworks, no CDN, no network calls — a single-page app that runs from `file://` or any static host.

## Prerequisites

- Any modern browser (for the app)
- Node.js ≥ 18 (for the unit tests and the smoke test)

## Install & run

```bash
# just open it — no build step
open index.html            # or serve it:
npx serve .                # then visit http://localhost:3000
```

## Dev commands

```bash
node --test tests/test.js  # 46 unit tests (slab boundaries, totals, config, history, export/import, savings, digits)
node smoke.mjs             # 38 headless-Chromium checks (desktop 1280px + mobile 390px, zero console errors)
```

## Environment

No environment variables, no API keys, no backend. App state lives in `localStorage` keys `ebb-tariff-config-v1`, `ebb-bill-history-v1`, `ebb-lang-v1`.

## Deployment (GitHub Pages)

```bash
# push the repo, then: Settings → Pages → Deploy from branch → main → / (root)
```

The app is a static site — everything works over GitHub Pages with no configuration.

## Limitations

- **Estimate only, not your official bill.** Default rates from mid-2026 press coverage of the BERC tariff revision; edit the rate configuration to match your Disco (DPDC/DESCO/NESCO/WZPDCL/BREB) bill.
- The calculator implements the **slab-wise flat-rate rule** (whole consumption × one slab rate). It does not model marginal/block billing, power factor surcharges, or Disco-specific adjustments — those belong in the editable config or a future version.
- VAT is computed as a flat % on (energy + demand + meter rent).
- Data is stored only in the browser; clearing site data wipes history and config.

## Status

Complete and verified: 46/46 unit tests and 38/38 headless-Chromium smoke checks pass with zero console/page errors on desktop and 390px mobile. See `TEST_RESULTS.md` for the full QA record.
