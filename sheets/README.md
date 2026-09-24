# Upload sheets

**State upload workflow only** (`state_admin`). See `docs/UPLOAD_API.md`.

## Column layout by level

| Level | Columns |
|-------|---------|
| District | `District \| District LGD \| values` |
| Block | `Block \| Block LGD \| values` (District hidden) |
| Facility | `Facility Name \| HFR Code \| values` (District+Block hidden) |

## Excel samples (`sheets/xlsx/`)

| File | Level |
|------|-------|
| `EX_STATE_ANC_BLOCK_Lucknow_FILLED.xlsx` | block |
| `EX_STATE_CSECTION_FACILITY_Agra_FILLED.xlsx` | facility |
| `EX_STATE_ANC_DISTRICT_LucknowDiv_FILLED.xlsx` | district |

Regenerate: `npm run sheets:xlsx`
