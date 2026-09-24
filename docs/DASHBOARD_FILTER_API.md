# Dashboard filter APIs (BY TYPE / BY DOMAIN)

Same shape as the screenshot accordion UI.

## Endpoints

| UI tab | API |
|--------|-----|
| BY TYPE | `GET /api/dashboard/by-type` |
| BY DOMAIN | `GET /api/dashboard/by-domain` |
| Either | `GET /api/dashboard/filter?view=type\|domain` |

Auth: `Authorization: Bearer <token>`

## Query params

| Param | Example |
|-------|---------|
| `period` | `2026-05` |
| `geo_level` | `district` |
| `district_id` | `1` |
| `section` | `coverage` / `ante_natal` (expand one accordion) |

## Response shape (matches screenshot)

```json
{
  "success": true,
  "tab": "BY TYPE",
  "overall_composite_label": "OVERALL COMPOSITE SCORE",
  "overall_composite_score": 0.7,
  "sections": [
    {
      "key": "coverage",
      "label": "COVERAGE",
      "color": "orange",
      "expandable": true,
      "expanded": true,
      "has_data": true,
      "count": 2,
      "indicators": [
        {
          "name": "Institutional Delivery rate",
          "value": 60,
          "display_value": "60%",
          "unit": "percent",
          "info": "(E8 + E9) / E10 * 100"
        }
      ]
    },
    { "key": "quality", "label": "QUALITY", "has_data": false, "indicators": [] },
    { "key": "data_quality", "label": "DATA QUALITY", "has_data": false, "indicators": [] }
  ]
}
```

### BY DOMAIN sections (always returned)
ANTE NATAL, DELIVERY CARE, POST NATAL CARE, IMMUNIZATION, FAMILY PLANNING, COMMUNICABLE DISEASES, FINANCE, DATA QUALITY

## Examples

```bash
# Full BY TYPE accordion
curl "http://localhost:3010/api/dashboard/by-type?district_id=1&period=2026-05" \
  -H "Authorization: Bearer $TOKEN"

# Expand only COVERAGE
curl "http://localhost:3010/api/dashboard/by-type?district_id=1&section=coverage" \
  -H "Authorization: Bearer $TOKEN"

# BY DOMAIN
curl "http://localhost:3010/api/dashboard/by-domain?district_id=1&period=2026-05" \
  -H "Authorization: Bearer $TOKEN"

# Unified filter
curl "http://localhost:3010/api/dashboard/filter?view=domain&district_id=1" \
  -H "Authorization: Bearer $TOKEN"
```

Data comes from PG functions: `fn_dashboard_by_type`, `fn_dashboard_by_domain`.
