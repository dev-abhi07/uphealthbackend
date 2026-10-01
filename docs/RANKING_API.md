# Ranking dashboard APIs (separate from HMIS `/api/dashboard`)

## Data source (current)

**District + division + block from outcome cache:**

| Table | Role |
|--------|------|
| `indicator_outcome_district` | Composite: `index_outcome`, `rank_outcome` |
| `indicator_outcome_district_value` | IND001–IND037 values |
| `indicator_outcome_block` | Block composite + statewide `rank_outcome` |
| `indicator_outcome_block_value` | Block IND### values |

- **District:** direct from cache  
- **Division:** rolled up from districts (`AVG(index_outcome)`, ranks recomputed; IND = avg by division)  
- **Block:** direct from `OUTCOME_BLOCK_API_URL` cache  
- **Not used for plot:** Excel `ranking_value`, HMIS `kpi_value` / `fn_dashboard_*`

Periods: `GET /api/ranking/periods` (outcome-synced months only)  
Sync district: `POST /api/ranking/outcome/district/sync?month=7&year=2026`  
Sync block: `POST /api/ranking/outcome/block/sync?month=7&year=2026`  
Auth to upstream: Basic (`USER_NAME_UPDSUPERADMIN` / `PASSWORD_UPDSU`)

Legacy Excel import (`POST /api/ranking/import`) remains for historical files but is not served by ranking/dashboard plot endpoints.

## Endpoints

Auth: `Authorization: Bearer <token>`

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/ranking/import` | Upload ranking Excel (`file`) — legacy only |
| POST | `/api/ranking/outcome/district/sync` | Pull district rows from external API into cache |
| POST | `/api/ranking/outcome/block/sync` | Pull block rows from `OUTCOME_BLOCK_API_URL` |
| GET | `/api/ranking/dashboard?geo_level=division&period=2026-06` | Division map + ranking (**outcome rollup**) |
| GET | `/api/ranking/dashboard?geo_level=district&period=2026-06` | District map + ranking (**outcome**) |
| GET | `/api/ranking/dashboard?geo_level=block&period=2026-07` | Block map + ranking (**outcome**) |
| GET | `/api/ranking/dashboard?geo_level=block&period=2026-07&district=Fatehpur` | Blocks under a district |
| GET | `/api/ranking/dashboard?geo_level=block&period=2026-07&district=Lucknow&block_id=1329` | Full district block ranking; gauge + BY INDICATORS for that block |
| GET | `/api/ranking/dashboard?view=table&level=division&period=2026-06&table_mode=division` | Table / Deep Dive |
| GET | `/api/ranking/deep-dive?view=division&period=2026-06` | Deep Dive |
| GET | `/api/ranking/geo-options?division=Lucknow%20Division` | Division / District / Block dropdowns |
| GET | `/api/ranking/analytics?period_from=2026-05&period_to=2026-06` | Overall Composite Score analytics |
| GET | `/api/ranking/trend?level=district&from_period=2026-01&to_period=2026-06&area_id=173` | Trend chart (primary + compare + UP avg) |
| GET | `/api/ranking/trend?level=block&from_period=2026-01&to_period=2026-07&area_id=1329&block=Bakshi-Ka-Talab&compare_area_id=121&compare_name=Ambedkar+Nagar&indicator_code=IND004` | Block trend from `indicator_outcome_block` (compare may be block or district) |
| GET | `/api/ranking/executive-summary?period=2026-06&level=division` | Executive Summary — all districts only |
| GET | `/api/ranking/executive-summary?period=2026-06&level=district` | Executive Summary — all blocks only |
| GET | `/api/ranking/periods` | Outcome-synced months only |

### Executive Summary response shape

- **State / sysadmin**
  - `level=division` → divisions (`content_geo_level=division`)
  - `level=district` → districts (`content_geo_level=district`)
- **Division login** → districts of that division (`content_geo_level=district`)
- **District login** → blocks of that district (`content_geo_level=block`)
- Same response keys; geo filtered by login. Rank-insights + indicator-performance follow the same rules.

Optional filters:
- `filter` — `all` (default) | `aspirational` | `high_priority`  
  Show All / Aspirational / High Priority toggles (map + table).  
  Applies at **division** and **district** (divisions that contain matching districts; district list filtered).  
  **Skipped at block** (single-block views). Ranks stay API/outcome ranks (not re-densified).
- `div_code` — division master code (e.g. `14595` = Agra Division)
- `division` — division name
- `district` / `dt_lgd` / `district_lgd` / `area_id` — district name or LGD (e.g. Lucknow = `162`)
- `block` / `block_id` / `block_lgd` / `block_name` — selected block name or Block LGD (e.g. Bakshi-Ka-Talab = `1329`)
- `parent_area_id` — alias for `div_code` when it matches `division.code`
- `indicator_code` — `RANK_COMPOSITE` (default) or `IND001`…`IND037`

Example (table + aspirational):  
`/api/ranking/dashboard?view=table&level=division&geo_level=division&table_mode=division&period=2026-07&filter=aspirational`

`period` optional — latest outcome-synced month if omitted.

### Block click (same pattern as district click)

| Panel | Behavior |
|--------|----------|
| **BLOCK RANKING** | Full list for the district (unchanged) |
| **Gauge + BY INDICATORS** | Values for the selected block only |
| `summary_scope` | `"block"` when `block_id` / `block` is set; else `"district"` / `"state"` |
| `selected_block` | `{ name, score, rank, … }` for the clicked row |
| `district_overall_composite_score` | District avg (for comparison) when a block is selected |

Example: `geo_level=block&period=2026-07&district=Lucknow&block_id=1329`
→ `overall_composite_score` ≈ `0.49` (Bakshi-Ka-Talab), `ranking[]` still all Lucknow blocks.

## Sync

```bash
TOKEN=$(curl -s -X POST http://localhost:3010/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"state.admin","password":"Pass@123"}' | jq -r .token)

curl -X POST "http://localhost:3010/api/ranking/outcome/district/sync?month=6&year=2026" \
  -H "Authorization: Bearer $TOKEN"

curl -X POST "http://localhost:3010/api/ranking/outcome/block/sync?month=7&year=2026" \
  -H "Authorization: Bearer $TOKEN"
```

Or from CLI:

```bash
node scripts/syncBlockOutcomeFromApi.js 7 2026
```

## Dashboard examples

```bash
curl "http://localhost:3010/api/ranking/dashboard?geo_level=division&period=2026-06" \
  -H "Authorization: Bearer $TOKEN"

curl "http://localhost:3010/api/ranking/dashboard?geo_level=district&period=2026-06" \
  -H "Authorization: Bearer $TOKEN"

# Districts under Agra Division
curl "http://localhost:3010/api/ranking/dashboard?geo_level=district&period=2026-06&div_code=14595" \
  -H "Authorization: Bearer $TOKEN"
```

Response notes:
- `ranking[]` = rows for the table — **use `name`, `rank`, and `score` as-is** (do not re-join labels from geojson)
- `ranking[].area_id` / `lgd_code` = Excel `DistrictLGDcode` (Pilibhit = **173**, not 151)
- `ranking[].district_id` / `id` = master `district.id`
- `ranking[].rank` = dense 1..n in response order; `state_rank` = statewide sheet rank
- Rank gaps like 15→18 mean the UI filtered rows client-side — re-number with dense 1..n after filter
- `source` = `indicator_outcome_api` or `indicator_outcome_cache`
- `overall_composite_score` = AVG of district `index_outcome` (scoped)
- SUMMARY: `indicators[]` / `by_type[]` / `by_domain[]`

**BY TYPE / BY DOMAIN** (map SUMMARY left panel):
- Source of truth = Excel/`indicator` table: `indicator_type` + Excel `Domain` → `domain_label`
- **Tab switch key:** `panel_tab`
  - `panel_tab=indicators` → only `indicators[]`
  - `panel_tab=type` → only `by_type[]` (COVERAGE / QUALITY / DATA QUALITY)
  - `panel_tab=domain` → only `by_domain[]` (Excel domain labels: Maternal Health, Child Health, …)
  - `panel_tab=all` → all three arrays

**TABLE VIEW — INDICATOR BREAKUP** (right panel dropdown):
- **Key:** `breakup_tab` (aliases: `breakup_group`, `group_by`)
  - `breakup_tab=indicator` → `breakup_rows[]` = flat indicators (`indicator_breakup`)
  - `breakup_tab=type` → `breakup_rows[]` = type groups (COVERAGE / QUALITY / DATA QUALITY)
  - `breakup_tab=domain` → `breakup_rows[]` = Excel domain groups (`label` = Maternal Health, …) — **not** `delivery_care` / `ante_natal`
- Always also returns `breakup_by_type[]`, `breakup_by_domain[]`, and flat `indicator_breakup[]` (each row has `domain` / `domain_label` = Excel Domain text)
- Independent of `panel_tab`

```bash
curl "http://localhost:3010/api/ranking/dashboard?view=table&level=district&period=2024-07&breakup_tab=domain" \
  -H "Authorization: Bearer $TOKEN"
```

- Dual-month bars: `score` / `prev_score`, `bar_pct` / `prev_bar_pct`
- Default indicator = `RANK_COMPOSITE`

### Indicator click

```bash
curl "http://localhost:3010/api/ranking/dashboard?geo_level=district&period=2026-06&indicator_code=IND004" \
  -H "Authorization: Bearer $TOKEN"
```

See also: executive summary, analytics, deep-dive endpoints in the table above (all outcome-backed for division/district).

## Trend / Compare (`GET /api/ranking/trend`)

Powers **VIEW BY: Trend** (primary area + optional compare + UP average line).

```http
GET /api/ranking/trend?level=district&from_period=2026-01&to_period=2026-06&area_id=173&area_name=Pilibhit
GET /api/ranking/trend?level=division&from_period=2026-01&to_period=2026-06&area_name=Chitrakoot&compare_name=Gorakhpur
GET /api/ranking/dashboard?view=trend&level=district&area_id=173&months=6
```

| Param | Meaning |
|--------|---------|
| `level` / `geo_level` | `district` (default) or `division` |
| `from_period` / `to_period` | `YYYY-MM` range (aliases: `period_from` / `period_to`). If `to_period` is before the latest **API-synced** month, the axis is extended automatically (e.g. FE sends `2026-06` but July is synced → chart includes **Jul '26**) |
| `months` | If from/to omitted, last N synced outcome months |
| `area_id` | District **LGD** (Pilibhit=`173`) or division code |
| `area_name` | District / division name |
| `compare_area_id` / `compare_name` / `compare_with` | Second series for Compare with |
| `compare_up_avg` | `0` to hide UP line (default on) |
| `indicator_code` | `RANK_COMPOSITE` (default) or `IND001`… |

Response highlights:
- `primary` / `compare` / `up_avg` — each has `series[]` with `value` (raw) and `display_value` (same rounding as ranking table: composite **0.55**, percent **20**)
- `chart.series[].data` — plot values on the **same scale as ranking** (composite 0–1, percent 0–100)
- `chart.y_min` / `y_max` / `y_label` / `y_unit` — change with `indicator_code` (composite → 0–1 “Overall Composite Score”; `IND001` → 0–100 indicator name)
- `legend[].latest_value` — use for tooltip chips (matches ranking score)
- `compare_options` — dropdown list for Compare with
- Data source: `indicator_outcome_district` only (same cache as map ranking)

```http
# Overall composite (matches DISTRICT RANKING scores)
GET /api/ranking/trend?level=district&area_id=173&from_period=2026-01&to_period=2026-06&compare_name=Rampur

# Selected indicator — Y-axis becomes that indicator’s unit/scale
GET /api/ranking/trend?level=district&area_id=173&indicator_code=IND001&from_period=2026-01&to_period=2026-06
```
