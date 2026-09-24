# Dashboard APIs (PostgreSQL functions)

Base: `http://localhost:3010`  
Auth: `Authorization: Bearer <token>`

## PG functions

| Function | Used by API |
|----------|-------------|
| `fn_composite_score(...)` | overview |
| `fn_dashboard_by_indicators(...)` | `/by-indicators`, `/kpis` |
| `fn_dashboard_by_type(...)` | `/by-type` |
| `fn_dashboard_by_domain(...)` | `/by-domain` |
| `fn_district_composites(...)` | helper |
| `fn_district_performance(...)` | `/performance` |

SQL file: `database/016_dashboard_functions.sql`

```bash
psql -d uphealthdashboard -f database/016_dashboard_functions.sql
```

## API endpoints

| Method | Path |
|--------|------|
| GET | `/api/dashboard/overview` |
| GET | `/api/dashboard/by-indicators` |
| GET | `/api/dashboard/by-type` |
| GET | `/api/dashboard/by-domain` |
| GET | `/api/dashboard/performance` |

Query: `period`, `geo_level`, `division_id`, `district_id`, `block_id`, `band_size`

Response includes `"source": "pgsql:fn_..."` so you can confirm DB functions are used.

## Example

```bash
TOKEN=$(curl -s -X POST http://localhost:3010/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"agra.dh","password":"Pass@123"}' | jq -r .token)

curl -s "http://localhost:3010/api/dashboard/by-indicators?district_id=1&period=2026-05" \
  -H "Authorization: Bearer $TOKEN"
```
