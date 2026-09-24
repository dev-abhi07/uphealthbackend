# Ranking dashboard APIs (separate from HMIS `/api/dashboard`)

Do **not** mix with KPI upload. Ranking Excel import fills these tables only.

## Which sheet for UI

Use these files:

```text
By DIvision/<Month>/Data_Report_Requirement-*_division.xlsx
By District/<Month>/Data_Report_Requirement-*_district.xlsx
By District/<Month>/Agra-Data_Report_Requirement-*_block.xlsx
```

Example (Jan 2026):

```text
.../By DIvision/Jan/Data_Report_Requirement-18-8-2026_division.xlsx
```

- Inside workbook: tab **`composite_score`** + indicator tabs  
- `geo_level=division` | `district` | `block`

## Endpoints

Auth: `Authorization: Bearer <token>`

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/ranking/import` | Upload ranking Excel (`file`) |
| GET | `/api/ranking/dashboard?geo_level=division&period=2026-01` | Division map + ranking + indicators |
| GET | `/api/ranking/dashboard?geo_level=district&period=2026-01` | District map + ranking + indicators |
| GET | `/api/ranking/dashboard?geo_level=block&period=2026-01` | Block ranking + indicators |
| GET | `/api/ranking/dashboard?geo_level=district&period=2026-02&div_code=14595` | Districts under Agra Division |
| GET | `/api/ranking/dashboard?geo_level=block&period=2026-02&div_code=14595` | Blocks under Agra Division |
| GET | `/api/ranking/dashboard?view=table&level=division&period=2026-01&table_mode=division&panel_tab=indicators&analytics_compare=timeperiod&analytics_mode=month` | Table view (Deep Dive) — same as health-ranking URL |
| GET | `/api/ranking/deep-dive?view=division&period=2026-06` | Deep Dive: rankings + FY + trend + breakup |
| GET | `/api/ranking/geo-options?division=Lucknow%20Division` | Division / District / Block dropdowns |
| GET | `/api/ranking/analytics?period_from=2026-05&period_to=2026-06&division=Lucknow%20Division&district=Lucknow` | Overall Composite Score analytics |
| GET | `/api/ranking/executive-summary?period=2026-01&level=division` | Executive Summary (top/bottom, KPIs, MoM change) |
| GET | `/api/ranking/periods` | Imported months |

Optional filters:
- `div_code` — division master code (e.g. `14595` = Agra Division)
- `division` — division name
- `district` — district name (mainly for `geo_level=block`)
- `parent_area_id` — alias for `div_code` when it matches `division.code`

`period` optional — latest imported month if omitted.

## Import

```bash
TOKEN=$(curl -s -X POST http://localhost:3010/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"state.admin","password":"Pass@123"}' | jq -r .token)

curl -X POST http://localhost:3010/api/ranking/import \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@Data_Report_Requirement-18-8-2026_division.xlsx"
```

## Dashboard (frontend)

```bash
curl "http://localhost:3010/api/ranking/dashboard?geo_level=division&period=2026-01" \
  -H "Authorization: Bearer $TOKEN"
```

District dashboard:

```bash
curl "http://localhost:3010/api/ranking/dashboard?geo_level=district&period=2026-01" \
  -H "Authorization: Bearer $TOKEN"
```

Block dashboard:

```bash
curl "http://localhost:3010/api/ranking/dashboard?geo_level=block&period=2026-06" \
  -H "Authorization: Bearer $TOKEN"

# optional district filter
curl "http://localhost:3010/api/ranking/dashboard?geo_level=block&period=2026-06&district=Agra" \
  -H "Authorization: Bearer $TOKEN"
```

Drill-down (frontend URL: `level=division&div_code=14595&table_mode=district&period=2026-02`):

```bash
# Preferred — table shows only Agra Division districts
curl "http://localhost:3010/api/ranking/dashboard?level=division&table_mode=district&period=2026-02&div_code=14595" \
  -H "Authorization: Bearer $TOKEN"

# Equivalent
curl "http://localhost:3010/api/ranking/dashboard?geo_level=district&period=2026-02&div_code=14595" \
  -H "Authorization: Bearer $TOKEN"
```

Response notes:
- `ranking[]` = rows for the **table** (districts when `table_mode=district` + `div_code`)
- `selected_division` = clicked division summary (map popup)
- `rank_trend` / `rank_change` for Trend column
- If only `level=division&div_code=...` (no table_mode), also returns `child_ranking[]` (districts under that division)
- SUMMARY tabs:
  - **BY INDICATORS** → `indicators[]`
  - **BY TYPE** → `by_type[]` (`COVERAGE` / `QUALITY` / `DATA QUALITY`)
  - **BY DOMAIN** → `by_domain[]` (`ANTE NATAL`, `DELIVERY CARE`, …)
  - Header score → `overall_composite_score` / `overall_composite_label`

### Indicator click → ranking for that indicator

On division / district (and block when data exists), pass `indicator_code`:

```bash
# Division-wise ranking for ANC indicator
curl "http://localhost:3010/api/ranking/dashboard?geo_level=division&period=2026-01&indicator_code=RANK_ANC4_HB" \
  -H "Authorization: Bearer $TOKEN"

# District-wise for Full Immunization
curl "http://localhost:3010/api/ranking/dashboard?geo_level=district&period=2026-01&indicator_code=RANK_FULL_IMM" \
  -H "Authorization: Bearer $TOKEN"

# Block-wise (only if indicator imported at block level)
curl "http://localhost:3010/api/ranking/dashboard?geo_level=block&district=Unnao&period=2026-01&indicator_code=RANK_ANC4_HB" \
  -H "Authorization: Bearer $TOKEN"
```

Response:
- `ranking[]` sorted by that indicator’s rank/score
- `selected_indicator` (`code`, `name`, `unit`, `average`, `available`)
- `indicators[].selected` marks the active indicator
- `overall_composite_score` stays the composite header score
- Default (omit param) = `RANK_COMPOSITE`

## Table view (frontend `health-ranking?view=table…`)

Pass the same query string the UI uses:

```bash
curl "http://localhost:3010/api/ranking/dashboard?view=table&level=division&period=2026-01&panel_tab=indicators&table_mode=division&labels=1&analytics_compare=timeperiod&analytics_mode=month" \
  -H "Authorization: Bearer $TOKEN"
```

| URL param | Effect |
|-----------|--------|
| `view=table` | Deep Dive / table payload (not map) |
| `level` / `table_mode` | `division` or `district` ranking rows |
| `period` | Selected month |
| `panel_tab=indicators` | `indicators[]` + `indicator_breakup[]` |
| `labels=1` | Echoed as `labels: true` |
| `analytics_compare=timeperiod` | Month columns in `analytics.periods` + `period_values` per row |
| `analytics_mode=month` | Monthly series (use `fy` for FY-window trend) |

Response: `summary`, `state_row`, `rankings` / `ranking`, `indicators`, `indicator_breakup`, `analytics`.

## Executive Summary

Division/district snapshot: Top/Bottom 3, narrative, key indicators, map ranks, MoM change charts.

```bash
curl "http://localhost:3010/api/ranking/executive-summary?period=2026-01&level=division" \
  -H "Authorization: Bearer $TOKEN"
```

| Field | UI |
|-------|-----|
| `top_performers` / `bottom_performers` | TOP 3 / BOTTOM 3 lists |
| `narrative` / `narrative_badge` | Center summary text + month badge |
| `key_indicators.positive` / `.negative` | Thumbs-up / thumbs-down KPI cards |
| `map.ranking` | Heatmap division scores + bands |
| `performance_change` | Right panel rank + 3-month history + MoM `change` |
| `highest_increase` / `lowest_decrease` | Bottom bar charts (prev vs current) |
| `history_legend` / `compare_chart_legend` | Colors for NOV/DEC/JAN style legends |

Also: `GET /api/ranking/dashboard?view=executive&period=2026-01&level=division`

## Overall Composite Score analytics

Matches UI: **By Timeperiod** + Division → District → Block + UP Average / Best Performance.

### Frontend URL (preferred)

Same query string as `health-ranking?view=analytics…`:

```bash
curl "http://localhost:3010/api/ranking/dashboard?view=analytics&level=division&period=2026-06&panel_tab=indicators&table_mode=district&labels=1&analytics_compare=timeperiod&analytics_mode=quarter&area_id=auraiya__erwa-katra&district_id=auraiya&block_id=auraiya__erwa-katra&parent_area_id=auraiya&analytics_period=2026-06&analytics_from=2026-Q1&analytics_to=2026-Q1" \
  -H "Authorization: Bearer $TOKEN"
```

| URL param | Meaning |
|-----------|---------|
| `view=analytics` | Overall Composite Score analytics |
| `analytics_mode=quarter\|month` | Axis mode |
| `analytics_from` / `analytics_to` | `2026-Q1` (Indian FY Q1 = Apr–Jun) or `YYYY-MM` |
| `district_id` | slug e.g. `auraiya` |
| `block_id` / `area_id` | `district__block` slug e.g. `auraiya__erwa-katra` |
| `parent_area_id` | district slug (analytics) or numeric `div_code` (map) |
| `panel_tab` | `indicators` / domain / type |
| `labels=1` | echoed |

Also: `GET /api/ranking/analytics` with the same params.

### Geo dropdowns

```bash
curl "http://localhost:3010/api/ranking/geo-options?division=Lucknow%20Division&district=Lucknow" \
  -H "Authorization: Bearer $TOKEN"
```

### Analytics (custom months)

```bash
curl "http://localhost:3010/api/ranking/analytics?period_from=2026-05&period_to=2026-06&division=Lucknow%20Division&district=Lucknow&block=all&compare_up_avg=1&compare_best=1" \
  -H "Authorization: Bearer $TOKEN"
```

### Analytics (quarters — Indian FY)

```bash
curl "http://localhost:3010/api/ranking/analytics?quarter_from=2026-Q1&quarter_to=2026-Q1&district_id=auraiya&block_id=auraiya__erwa-katra" \
  -H "Authorization: Bearer $TOKEN"
```

Response highlights:
- `breadcrumb` / `breadcrumb_display` / `composite.score` + `composite.series`
- `indicators[]` — `from_value` / `to_value` (bar ends) + `series` (sparkline) + optional `up_avg_series` / `best_perf_series`
- `indicators[].chart` / `composite.chart` — trend panel ready:
  - `bars` / `points[].bar` → orange selected-geo bars
  - `up_avg` / `points[].up_avg` → blue **UP Average** line
  - `best_perf` / `points[].best_perf` → grey **Best Performance** band
  - `categories` → `["Apr 26","May 26","Jun 26"]`
- `by_domain` / `by_type` — All Indicators / By Domain / By Type tabs
- `missing_months` — requested months not yet imported (e.g. Jul 2026)

## Deep Dive (By Division / By District table + indicator breakup)

```bash
# By Division — Composite Score — Jun 2026
curl "http://localhost:3010/api/ranking/deep-dive?view=division&period=2026-06&indicator_code=RANK_COMPOSITE&filter=all" \
  -H "Authorization: Bearer $TOKEN"

# By District
curl "http://localhost:3010/api/ranking/deep-dive?view=district&period=2026-06&indicator_code=RANK_COMPOSITE" \
  -H "Authorization: Bearer $TOKEN"

# Indicator breakup scoped to a division
curl "http://localhost:3010/api/ranking/deep-dive?view=division&period=2026-06&division=Meerut%20Division" \
  -H "Authorization: Bearer $TOKEN"
```

Response highlights:
- `summary` — total districts, top/lowest, average + change
- `state_row` — Uttar Pradesh aggregate
- `rankings[]` — RANK / MONTHLY / FY / `trend_series` (sparkline points); hierarchy:
  - **By Division:** division → `children[]` districts → each district `children[]` **blocks**
  - **By District:** district → `children[]` blocks
- `hierarchy` — e.g. `["division","district","block"]`; each row has `geo_level`, `expandable`, `child_count`
- `indicator_breakup[]` — INDICATOR / UP AVG / BEST PERF / MONTHLY / FY for `breakup_scope`
- `indicator_options[]` — dropdown list
- `filter` — `all` | `aspirational` | `high_priority`

FY = average of available months from Indian FY start (Apr) through selected period.


Excel sometimes uses non-master spellings. Parser + DB normalize these to master names:

| Excel | Master |
|-------|--------|
| Bagpat | Baghpat |
| Budaun | Badaun |
| Unnav | Unnao |
| Shrawasti | Shravasti |
| Kanpur Division | Kanpur Nagar Division |
| Alligarh Division | Aligarh Division |

Repair existing rows: `node scripts/fixRankingGeoAliases.js`

For `ranking[]` trend:
- `prev_rank` (previous period composite rank; null if not available)
- `rank_change` (current_rank - prev_rank in rank number; null if not available)
- `rank_trend` (`up`/`down`/`same`; null if not available)
Without import: `has_data: false`.
