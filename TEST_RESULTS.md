# TEST_RESULTS.md — electricity-bill-bd (factory run #37, 2026-10-12)

## Unit tests (`node --test tests/test.js`)
**46/46 passing** across 9 suites:
- slab boundaries (flat-rate rule): 15/15 — 0, 40, 50 → Lifeline; 51, 75 → 0–75; 76, 200 → 76–200; 201, 300 → 201–300; 301, 400 → 301–400; 401, 600 → 401–600; 601, 5000 → 601+
- bill totals (hand-checked): 6/6 — 40 units → total ৳ 309.54; 80 units → ৳ 800.10; 601 units → energy ৳ 10,427.35, total ৳ 11,034.82; flat-rate-not-marginal (150 × 8.50 = 1,275.00); custom config honoured; zero units still charges demand + rent + VAT (৳ 86.10)
- input validation: 5/5 (empty, non-numeric, negative, >100000 rejected; decimals accepted)
- config persistence: 4/4 (save/load round-trip incl. Infinity-safe slabs, ASCII-safe JSON, corrupt config falls back, missing config → defaults)
- bill history: 4/4 (add/delete/stats, empty stats, save/load persistence, Bengali month labels survive)
- export/import round-trip: 5/5 (export→wipe→import restores incl. বাংলা labels; malformed JSON rejected; bad shape rejected; zero-valid-bills rejected; invalid entries filtered)
- savings estimator: 2/2 (80−30 units → new Lifeline slab, ৳ 434.70/month; clamp at 0)
- Bengali digits & labels: 4/4 (toBnDigits, fmtNum EN/BN, slabLabel all slabs both languages, EN/BN dictionaries have identical key sets, all non-empty)
- rounding: 1/1

**Repairs (test-authoring, not app bugs): 2** — (1) custom-config test had a wrong expected total I typed before computing (338.10 is correct); (2) clamp-at-0 test compared rounded `monthly` against an unrounded subtraction (55.860000000000014 vs 55.86).

## ⚠ Hand-check discrepancy found and corrected
The task brief stated `40 × 5.32 = 212.00` (→ subtotal 294.00, VAT 14.70, total 308.70). That arithmetic is wrong: **40 × 5.32 = 212.80** → subtotal 294.80, VAT 14.74, **total 309.54**. The app and the test encode the mathematically correct values; the other two hand-checks (80 units → 800.10; 601 units → 10,427.35 energy) were verified correct as written.

## Headless-Chromium smoke test (`node smoke.mjs`, raw CDP via /opt/meta-chromium/chrome)
**38/38 passing**, zero console errors, zero page exceptions, on desktop 1280×800 and mobile 390px:
- Desktop (32): title, boot, slab-rule note, footer disclaimer, 40-unit calc (৳ 309.54, Lifeline, 6 rows), 601-unit calc (৳ 11,034.82, 601+ slab), validation (empty/negative inline errors, clears on valid input), BN toggle (html lang=bn, ৳ ৩০৯.৫৪ Bengali digits, persisted), toggle back to EN, history save → persisted → stats → delete → empty state, export JSON marker, malformed/bad-shape import rejected, valid import accepted, savings panel (৳ 434.70/month), savings-without-baseline message, config edit persisted (6.00), reset restores 5.32, no horizontal overflow
- Mobile 390px (4): no horizontal overflow, 76-unit calc = ৳ 764.40, stats grid fits
- Reload persistence (2): history row + config survive Page.reload
- Global (1): zero console/page errors across the entire run

**Repairs (test-script, not app bugs): 2** — (1) `/json/new` was called without the `url=` convention this Chrome build expects (raw encoded URL as the query string) — first attempt returned a non-JSON error; (2) I pre-typed 76 units → ৳ 763.35 from memory before computing (correct: 76 × 8.50 = 646, +42+40 = 728, VAT 36.40, total **764.40**). The savings "needs baseline" check was also rewritten from a no-op guard into a real reload-then-estimate assertion.

## Files
index.html (6,763 B), styles.css (5,471 B), app.js (~28 KB), tests/test.js, smoke.mjs, README.md, .gitignore, TEST_RESULTS.md. No secrets anywhere; no network calls; text files only.
