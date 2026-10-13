# Dashboard APIs (outcome tables)

Base: `http://localhost:3010`  
Auth: `Authorization: Bearer <token>`

## Data source

Reads **`indicator_outcome_district`** / **`indicator_outcome_district_value`** only.  
Legacy `kpi_value` and PostgreSQL `fn_dashboard_*` / `fn_composite_score` are **not** used.

- Composite header = AVG(`index_outcome`) for the geo scope  
- Indicators = AVG of IND values for the scope  
- Performance bands = district `rank_outcome` / `index_outcome`  
- Block scope → `has_data: false` (no block outcome yet)  
- Response `"source": "indicator_outcome"`

Sync district data first:

```bash
POST /api/ranking/outcome/district/sync?month=6&year=2026
```

## API endpoints

| Method | Path |
|--------|------|
| GET | `/api/dashboard/overview` |
| GET | `/api/dashboard/by-indicators` |
| GET | `/api/dashboard/by-type` |
| GET | `/api/dashboard/by-domain` |
| GET | `/api/dashboard/performance` |

Query: `period` (`YYYY-MM`), `geo_level`, `division_id`, `district_id`, `block_id`, `band_size`

## Example

```bash
TOKEN=$(curl -s -X POST http://localhost:3010/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"agra.dh","password":"Pass@123"}' | jq -r .token)

curl -s "http://localhost:3010/api/dashboard/by-indicators?district_id=1&period=2026-06" \
  -H "Authorization: Bearer $TOKEN"
```
