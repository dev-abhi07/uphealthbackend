# State Upload API (state_admin only)

Upload workflow is **only for state users** (`state_admin`).  
District / Block / Facility uploaders (DU / BU / FU) get **403**.

## Flow

1. Select **Indicator**
2. Select **Data Source** (of that indicator)
3. Select **Upload Level** (`district` | `block` | `facility`)
4. Select **Period**
5. **Generate / download** Excel
6. Fill only value columns → **Upload**

## Sheet columns (parent geo auto-hidden)

| Level | Visible columns |
|-------|-----------------|
| **district** | `District \| District LGD code \| <values>` |
| **block** | `Block \| Block LGD code \| <values>` — District hidden |
| **facility** | `Facility Name \| HFR Code \| <values>` — District + Block hidden |

## Auth

```http
Authorization: Bearer <state.admin token>
```

Demo: `state.admin` / `Pass@123` (or `admin` / `Pass@123`)

## Endpoints

### 1. List indicators
`GET /api/upload/indicators`

### 2. Sources for indicator
`GET /api/upload/indicators/:code/sources`

### 3. Levels for indicator
`GET /api/upload/indicators/:code/levels?source_code=hmis`

Response includes `visible_columns` / `hidden_columns` per level.

### 4. Preview final columns
`GET /api/upload/indicators/:code/columns?level=block`

### 5. Periods
`GET /api/upload/periods`

### 6. Generate / download Excel
```http
GET /api/upload/templates/:code/download
  ?period=2026-05
  &level=facility
  &source_code=hmis
```

Alias: `GET /api/upload/generate/:code?...`

| Query | Required | Notes |
|-------|----------|-------|
| `period` | yes* | e.g. `2026-05` |
| `from_date` + `to_date` | yes* | alternative to `period`, e.g. `2026-06-01` & `2026-07-31` |
| `level` | yes | `district` \| `block` \| `facility` |
| `source_code` | no | must be allowed for indicator |

\*Provide either `period` **or** both `from_date` and `to_date`. Missing periods are auto-created from the date range.

Sheets are always **statewide**:
- `facility` → all facilities across all districts
- `block` → all blocks across all districts
- `district` → all districts

`district_id` / `division_id` are **not used** (ignored if sent).

### 7. Upload filled Excel
```http
POST /api/upload
Content-Type: multipart/form-data
```

| Field | Required | Notes |
|-------|----------|-------|
| `file` | yes | `.xlsx` / `.xls` |
| `period` | no | overrides Excel Period |
| `indicator_code` | no | if Name mismatch |
| `level` | no | `district` \| `block` \| `facility` |
| `publish` | no | default `true` |

### 8. Batches
- `GET /api/upload/batches?limit=20`
- `GET /api/upload/batches/:id`

## Example (statewide facility sheet)

```bash
TOKEN=$(curl -s -X POST http://localhost:3010/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"state.admin","password":"Pass@123"}' | jq -r .token)

curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3010/api/upload/indicators

curl -o chc_fru.xlsx -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3010/api/upload/templates/IND_CHC_FRU_CSECTION_PCT/download?period=2026-05&level=facility&source_code=hmis"

curl -X POST http://localhost:3010/api/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@chc_fru.xlsx" \
  -F "period=2026-05" \
  -F "level=facility"
```

## DU/BU/FU

```bash
# lucknow.dh → 403 Access denied. Required role: state_admin
```
