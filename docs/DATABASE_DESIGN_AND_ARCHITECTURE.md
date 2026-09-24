# UP Health Dashboard — Database Design & Architecture

**Project:** `uphealthdashboard`  
**Purpose:** Store, aggregate, and serve health performance indicators across Division → District → Block → Facility levels in Uttar Pradesh.  
**Document status:** Design v1.1 (foundation + common upload system)  
**Date:** 2026-08-03

---

## 1. Goals

1. Support ~37+ health indicators from mixed source systems (HMIS, eKavach, Mantra, UWIN, CRS, DGFW, Nikshay, DVDMS, FAMS, etc.).
2. Allow each indicator to be available at **different geo levels** (Division / District / Block / Facility) — not all indicators apply at all levels.
3. Store raw component values at their **collection level**, then compute KPI values at the **reporting level**.
4. Keep dashboard reads fast by serving pre-computed `kpi_value` rows.
5. Provide a **common data upload system** so **District (DH)**, **Block**, and **Facility** users can upload indicator data through one shared workflow (same screens, same validation engine, different geo scope by role).
6. Remain extensible for new indicators, sources, targets, and period types.

---

## 2. High-Level Architecture

```text
┌──────────────────────────────────────────────────────────────────────────┐
│  EXTERNAL SOURCE SYSTEMS (API / file ETL)                                 │
│  HMIS · eKavach · Mantra · UWIN · CRS · DGFW · Nikshay · DVDMS · FAMS … │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ automated ETL
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    COMMON MANUAL UPLOAD CHANNEL                           │
│                                                                           │
│   District (DH) user ──┐                                                  │
│   Block user ──────────┼──► same Upload UI / API / templates              │
│   Facility user ───────┘     (scoped by role + assigned geo)              │
│                                                                           │
│   Excel/CSV form upload → validate → stage → approve → publish to facts   │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         PostgreSQL DATABASE                               │
│                                                                           │
│  Geo Master · Indicator Master · Users/Roles                              │
│  upload_batch · upload_row (staging)                                      │
│  fact_component_value ──► kpi_value                                       │
└───────────────────────────────────┬──────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  APPLICATION: Auth · Upload portal · Dashboard · Drill-down APIs          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Layer responsibilities

| Layer | Responsibility |
|--------|----------------|
| **External source systems** | Systems of record; automated ETL where APIs/files exist |
| **Common upload system** | One portal for DH / Block / Facility to enter or file-upload data for indicators not (yet) available via API, or for corrections / local reporting |
| **ETL / publish** | Move approved upload rows (and external ETL) into `fact_component_value` |
| **Compute job** | Aggregate components to requested level, apply formula, write `kpi_value` |
| **API** | Serve masters + `kpi_value`; enforce `indicator_level` and upload scope rules |
| **UI** | Dashboard + common upload screens filtered by user geo level |

---

## 3. Domain Concepts

### 3.1 Geo hierarchy

```text
Division
  └── District
        └── Block
              └── Facility (DH / CHC / PHC / SC / other)
```

- **Division** is typically a roll-up of districts (not a separate collection source in most sheet rows).
- Raw data may arrive at Facility, Block, or District.
- Reporting may be at Division, District, Block, and/or Facility depending on the indicator.

### 3.2 Indicator vs component

- An **indicator** is the KPI shown to users (usually a % or rate).
- A **component** is a building block (numerator part, denominator part, or formula part).
- Components can come from **different sources** and **different collection levels**.

**Example — Birth registration %**

| Piece | Source | Collection level | Reporting level |
|--------|--------|------------------|-----------------|
| Births registered | CRS | District | District (+ Division roll-up) |
| Estimated live births | DGFW | Block | Summed to District before formula |

**Example — Perinatal death % (negative indicator)**

| Piece | Source | Collection level | Reporting level |
|--------|--------|------------------|-----------------|
| Stillbirths / early neonatal deaths / live births | HMIS | Facility | Facility, Block, District |

### 3.3 Reporting level vs collection level

| Term | Meaning |
|------|---------|
| **Collection level** | Where raw numbers are stored (`indicator_component.collection_level`) |
| **Reporting / applicable level** | Where the KPI may be displayed (`indicator_level`) |

**Rule:** Aggregate components to the requested reporting level **first**, then apply the formula. Never average child percentages.

### 3.4 Period types

| Period type | Example use |
|-------------|-------------|
| `monthly` | VHND sessions last month |
| `rolling_30d` | ANM eKavach login last 30 days |
| `cumulative` | Birth registration cumulative |
| `fy` | Budget utilization for financial year |

### 3.5 Negative indicators

Indicators such as perinatal death % and low birth weight % are marked `is_negative = true`.  
UI RAG/color logic is reversed (higher value = worse performance).

### 3.6 Common upload system (DH / Block / Facility)

One **shared upload module** is used by all reporting units. Behaviour is the same; **scope changes by role**:

| Uploader role | Geo scope | Typical actions |
|---------------|-----------|-----------------|
| **Facility user** | Own facility only | Enter/upload facility-collected components; submit for Block/District review |
| **Block user** | Own block (+ child facilities) | Upload block-level data; review/approve facility uploads in block |
| **District (DH) user** | Own district (+ child blocks/facilities) | Upload district-level data; review/approve block/facility uploads; publish |

**“Common” means:**

- Same UI routes and APIs (`/upload`, templates, validation, status).
- Same staging tables (`upload_batch`, `upload_row`).
- Same publish path into `fact_component_value`.
- Different **allowed indicators**, **allowed geo IDs**, and **approval rights** driven by role + assignment.

Data may still also arrive via automated ETL from HMIS/eKavach/etc. Manual upload is for:

- Indicators without a live API feed
- Local corrections / late reporting
- Components that are collected only at DH / Block / Facility paper or portal forms

---

## 4. Indicator Categories (from sheet)

| Category | Approx. rows | Examples |
|----------|--------------|----------|
| Maternal & Child Health | 1–16 | ANC, institutional delivery, HRP, immunization, VHND, perinatal, LBW |
| Workforce / Facility readiness | 17–19, 25–26 | ASHA incentives, AB-HWC functional, UDSP, NQAS, UPRSK service norms |
| Disease control | 20–24 | TB notification/success, HTN/diabetes screening |
| Logistics & finance | 27–30 | EDL drug availability, FAMS/Koshvani budget |
| Digital health / ABHA | 31–37 | ABHA seeding, eKavach registrations, active HMIS, PMJAY ABDM |

---

## 5. Database Technology

| Choice | Recommendation |
|--------|----------------|
| RDBMS | **PostgreSQL 15+** |
| Why | Strong relational integrity, numeric precision, indexing, easy hierarchy queries, JSONB if needed later |
| Extensions (optional later) | `pg_trgm` (search), partitioning on large fact tables by period |

---

## 6. Entity Relationship Overview

```text
division 1───* district 1───* block 1───* facility

app_user *───* user_geo_assignment
app_user *───* role  (via user_role)

source_system 1───* indicator_component
source_system 1───* fact_component_value

indicator 1───* indicator_level
indicator 1───* indicator_component
indicator 1───* indicator_upload_rule   (who may upload this indicator)
indicator 1───* kpi_value
indicator 1───* indicator_target

indicator_component 1───* fact_component_value
indicator_component 1───* upload_row

time_period 1───* fact_component_value
time_period 1───* kpi_value
time_period 1───* upload_batch

upload_batch 1───* upload_row
upload_batch *───1 app_user (uploaded_by)
upload_batch *───0..1 app_user (approved_by)

etl_batch (audit of automated ingestion)
geo_source_map (optional crosswalk of external geo codes)
```

---

## 7. Table Design

### 7.0 Users, roles & geo assignment (for common upload + dashboard)

#### `role`
| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL PK | |
| code | VARCHAR(50) UNIQUE NOT NULL | `state_admin`, `division_viewer`, `district_uploader`, `block_uploader`, `facility_uploader`, `district_approver` |
| name | VARCHAR(100) NOT NULL | |

#### `app_user`
| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL PK | |
| username | VARCHAR(100) UNIQUE NOT NULL | |
| full_name | VARCHAR(150) | |
| email | VARCHAR(150) | |
| mobile | VARCHAR(20) | |
| password_hash | TEXT | or SSO subject id |
| is_active | BOOLEAN DEFAULT TRUE | |
| created_at | TIMESTAMPTZ DEFAULT NOW() | |

#### `user_role`
| Column | Type | Notes |
|--------|------|-------|
| user_id | BIGINT FK → app_user | |
| role_id | BIGINT FK → role | |
| PK | (user_id, role_id) | |

#### `user_geo_assignment`
Binds a user to the geo unit they may view/upload for.

| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL PK | |
| user_id | BIGINT FK → app_user | |
| geo_level | VARCHAR(20) NOT NULL | division \| district \| block \| facility |
| division_id | BIGINT FK NULLABLE | |
| district_id | BIGINT FK NULLABLE | |
| block_id | BIGINT FK NULLABLE | |
| facility_id | BIGINT FK NULLABLE | |
| UNIQUE | (user_id, geo_level, COALESCE geo ids) | |

**Examples:**

- Facility ANM/MO → `geo_level=facility`, `facility_id=...`
- Block user → `geo_level=block`, `block_id=...`
- DH / District user → `geo_level=district`, `district_id=...`

---

### 7.1 Geography master

#### `division`
| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL PK | |
| code | VARCHAR(20) UNIQUE NOT NULL | Stable business code |
| name | VARCHAR(150) NOT NULL | |
| is_active | BOOLEAN DEFAULT TRUE | |

#### `district`
| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL PK | |
| division_id | BIGINT FK → division | |
| code | VARCHAR(20) UNIQUE NOT NULL | |
| name | VARCHAR(150) NOT NULL | |
| is_active | BOOLEAN DEFAULT TRUE | |

#### `block`
| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL PK | |
| district_id | BIGINT FK → district | |
| code | VARCHAR(20) UNIQUE NOT NULL | |
| name | VARCHAR(150) NOT NULL | |
| is_active | BOOLEAN DEFAULT TRUE | |

#### `facility`
| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL PK | |
| block_id | BIGINT FK → block | |
| district_id | BIGINT FK → district | Denormalized for fast filters |
| code | VARCHAR(30) UNIQUE NOT NULL | |
| name | VARCHAR(255) NOT NULL | |
| facility_type | VARCHAR(50) | DH, CHC, PHC, SC, etc. |
| is_active | BOOLEAN DEFAULT TRUE | |

**Indexes:** `district(division_id)`, `block(district_id)`, `facility(block_id)`, `facility(district_id)`.

#### `geo_source_map` (optional)
Maps external codes from each source system to internal geo IDs.

| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL PK | |
| geo_level | VARCHAR(20) NOT NULL | division \| district \| block \| facility |
| geo_id | BIGINT NOT NULL | Internal ID for that level |
| source_id | BIGINT FK → source_system | |
| external_code | VARCHAR(100) NOT NULL | |
| UNIQUE | (source_id, geo_level, external_code) | |

---

### 7.2 Source & indicator master

#### `source_system`
| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL PK | |
| code | VARCHAR(50) UNIQUE NOT NULL | `hmis`, `ekavach`, `mantra`, `uwin`, `crs`, `dgfw`, `nikshay`, `dvdms`, `fams`, `koshvani`, `uprs`, `udsp`, `nqas`, `pmjay`, `hi` |
| name | VARCHAR(150) NOT NULL | |

#### `indicator`
| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL PK | |
| sno | INT | Sheet serial number |
| code | VARCHAR(50) UNIQUE NOT NULL | e.g. `IND_VHND_PCT` |
| name | TEXT NOT NULL | Full indicator label |
| category | VARCHAR(50) | mch \| workforce \| disease \| logistics \| digital |
| description | TEXT | |
| formula_text | TEXT | Human-readable formula |
| unit | VARCHAR(20) DEFAULT `percent` | percent \| rate \| count \| amount |
| is_negative | BOOLEAN DEFAULT FALSE | Reverse RAG if true |
| period_type | VARCHAR(30) NOT NULL | monthly \| rolling_30d \| cumulative \| fy |
| primary_source_id | BIGINT FK → source_system | Main source for display |
| is_active | BOOLEAN DEFAULT TRUE | |

#### `indicator_level`
Defines where the KPI may be shown in UI/API.

| Column | Type | Notes |
|--------|------|-------|
| indicator_id | BIGINT FK → indicator | |
| level | VARCHAR(20) NOT NULL | division \| district \| block \| facility |
| PK | (indicator_id, level) | |

#### `indicator_component`
| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL PK | |
| indicator_id | BIGINT FK → indicator | |
| component_code | VARCHAR(50) NOT NULL | e.g. `VHND_CONDUCTED` |
| label | TEXT NOT NULL | |
| role | VARCHAR(20) NOT NULL | numerator \| denominator \| part |
| source_id | BIGINT FK → source_system | |
| collection_level | VARCHAR(20) NOT NULL | facility \| block \| district |
| external_field | VARCHAR(100) | HMIS code / API field key |
| aggregation_method | VARCHAR(20) DEFAULT `sum` | sum \| avg \| latest \| count_distinct |
| sort_order | INT DEFAULT 0 | |
| UNIQUE | (indicator_id, component_code) | |

#### `indicator_upload_rule`
Controls **who can upload** which indicator (common system, level-specific rights).

| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL PK | |
| indicator_id | BIGINT FK → indicator | |
| upload_geo_level | VARCHAR(20) NOT NULL | district \| block \| facility — who enters the data |
| requires_approval | BOOLEAN DEFAULT TRUE | |
| approver_role_code | VARCHAR(50) | e.g. `district_approver`, `block_uploader` |
| template_code | VARCHAR(50) | Links to Excel/CSV template |
| is_active | BOOLEAN DEFAULT TRUE | |
| UNIQUE | (indicator_id, upload_geo_level) | |

**Examples:**

| Indicator | upload_geo_level | Approver |
|-----------|------------------|----------|
| Perinatal / HMIS facility clinical parts | facility | Block or District |
| VHND sessions | block | District |
| Birth registration (CRS manual fallback) | district | State / Division (optional) |
| ANM login (if manual) | district | State (optional) |

---

### 7.3 Time dimension

#### `time_period`
| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL PK | |
| period_type | VARCHAR(30) NOT NULL | monthly \| fy \| custom |
| label | VARCHAR(50) NOT NULL | e.g. `2025-04`, `FY2025-26` |
| start_date | DATE NOT NULL | |
| end_date | DATE NOT NULL | |
| UNIQUE | (period_type, label) | |

For `rolling_30d` indicators, prefer `as_of_date` on fact/KPI rows in addition to (or instead of) `time_period_id`.

---

### 7.4 Facts (raw ingested values)

#### `fact_component_value`
Stores the lowest-level numbers needed to compute KPIs.

| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL PK | |
| component_id | BIGINT FK → indicator_component | |
| geo_level | VARCHAR(20) NOT NULL | facility \| block \| district |
| division_id | BIGINT FK NULLABLE | Filled for convenience |
| district_id | BIGINT FK NULLABLE | |
| block_id | BIGINT FK NULLABLE | |
| facility_id | BIGINT FK NULLABLE | |
| time_period_id | BIGINT FK NULLABLE | |
| as_of_date | DATE NULLABLE | Rolling windows |
| value_num | NUMERIC(18,4) NOT NULL | |
| source_id | BIGINT FK → source_system | |
| ingested_at | TIMESTAMPTZ DEFAULT NOW() | |
| batch_id | VARCHAR(100) | ETL batch reference |

**Integrity rules (ETL/app enforced):**

- `geo_level = facility` → `facility_id` required  
- `geo_level = block` → `block_id` required  
- `geo_level = district` → `district_id` required  
- Parent IDs should be populated for faster filtering  

**Indexes:**  
`(component_id, time_period_id)`, `(district_id, component_id, time_period_id)`, `(block_id, ...)`, `(facility_id, ...)`.

---

### 7.5 Computed KPIs (dashboard read model)

#### `kpi_value`
| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL PK | |
| indicator_id | BIGINT FK → indicator | |
| geo_level | VARCHAR(20) NOT NULL | division \| district \| block \| facility |
| division_id | BIGINT FK NULLABLE | |
| district_id | BIGINT FK NULLABLE | |
| block_id | BIGINT FK NULLABLE | |
| facility_id | BIGINT FK NULLABLE | |
| time_period_id | BIGINT FK NULLABLE | |
| as_of_date | DATE NULLABLE | |
| numerator | NUMERIC(18,4) | |
| denominator | NUMERIC(18,4) | |
| value | NUMERIC(18,4) | Final KPI value |
| computed_at | TIMESTAMPTZ DEFAULT NOW() | |

**Uniqueness:** one row per indicator + geo identity + period/as_of_date.

Dashboard and API should primarily read from `kpi_value`, joined to `indicator` and geo masters.

---

### 7.6 Targets & ETL audit

#### `indicator_target`
| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL PK | |
| indicator_id | BIGINT FK | |
| geo_level | VARCHAR(20) NOT NULL | Thresholds may differ by level |
| time_period_id | BIGINT FK NULLABLE | |
| green_min / green_max | NUMERIC | |
| amber_min / amber_max | NUMERIC | |
| target_value | NUMERIC | Optional single target |

#### `etl_batch`
| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL PK | |
| source_id | BIGINT FK | |
| started_at | TIMESTAMPTZ | |
| finished_at | TIMESTAMPTZ | |
| status | VARCHAR(20) | running \| success \| failed |
| row_count | INT | |
| message | TEXT | |

---

### 7.7 Common upload staging tables

Register a source_system row with code `manual_upload` for values that enter via this portal.

#### `upload_template`
Defines the Excel/CSV / on-screen form layout used by all levels.

| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL PK | |
| code | VARCHAR(50) UNIQUE NOT NULL | e.g. `TMPL_FACILITY_MCH`, `TMPL_BLOCK_VHND` |
| name | VARCHAR(150) NOT NULL | |
| upload_geo_level | VARCHAR(20) NOT NULL | district \| block \| facility |
| file_type | VARCHAR(20) DEFAULT `xlsx` | xlsx \| csv \| form |
| version | INT DEFAULT 1 | Template versioning |
| is_active | BOOLEAN DEFAULT TRUE | |

#### `upload_template_column`
| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL PK | |
| template_id | BIGINT FK → upload_template | |
| column_key | VARCHAR(50) NOT NULL | Header key in file |
| component_id | BIGINT FK → indicator_component NULLABLE | Mapped target component |
| data_type | VARCHAR(20) NOT NULL | number \| text \| date \| geo_code |
| is_required | BOOLEAN DEFAULT TRUE | |
| sort_order | INT | |

#### `upload_batch`
One submission (file or multi-row form save).

| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL PK | |
| batch_no | VARCHAR(40) UNIQUE NOT NULL | Human-readable id |
| template_id | BIGINT FK → upload_template | |
| uploaded_by | BIGINT FK → app_user | |
| upload_geo_level | VARCHAR(20) NOT NULL | district \| block \| facility |
| division_id | BIGINT FK NULLABLE | |
| district_id | BIGINT FK NULLABLE | |
| block_id | BIGINT FK NULLABLE | |
| facility_id | BIGINT FK NULLABLE | Scope of uploader |
| time_period_id | BIGINT FK → time_period | Reporting period |
| source_file_name | VARCHAR(255) | Original file name |
| source_file_path | TEXT | Stored file path / object key |
| status | VARCHAR(30) NOT NULL | `draft` \| `submitted` \| `validation_failed` \| `pending_approval` \| `approved` \| `rejected` \| `published` \| `superseded` |
| row_count | INT DEFAULT 0 | |
| error_count | INT DEFAULT 0 | |
| remarks | TEXT | Uploader note |
| submitted_at | TIMESTAMPTZ | |
| approved_by | BIGINT FK → app_user NULLABLE | |
| approved_at | TIMESTAMPTZ | |
| rejection_reason | TEXT | |
| published_at | TIMESTAMPTZ | When facts were written |
| created_at | TIMESTAMPTZ DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ DEFAULT NOW() | |

**Indexes:** `(status, upload_geo_level)`, `(district_id, time_period_id)`, `(block_id, ...)`, `(facility_id, ...)`, `(uploaded_by)`.

#### `upload_row`
Each data line inside a batch (staging — not yet trusted facts).

| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL PK | |
| batch_id | BIGINT FK → upload_batch | |
| row_no | INT NOT NULL | Line number in file/form |
| indicator_id | BIGINT FK → indicator NULLABLE | |
| component_id | BIGINT FK → indicator_component NULLABLE | |
| geo_level | VARCHAR(20) NOT NULL | Level of this row’s geo |
| division_id / district_id / block_id / facility_id | BIGINT NULLABLE | Resolved geo |
| external_geo_code | VARCHAR(100) | As provided in file before mapping |
| value_num | NUMERIC(18,4) | |
| value_text | TEXT | For non-numeric if needed |
| validation_status | VARCHAR(20) DEFAULT `pending` | pending \| ok \| error |
| validation_errors | JSONB | List of field errors |
| published_fact_id | BIGINT NULLABLE | FK to `fact_component_value` after publish |
| UNIQUE | (batch_id, row_no, component_id) optional depending on wide vs long format |

**Long format (recommended):** one component value per row.  
**Wide format (Excel-friendly):** one geo row with many component columns → ETL expands into multiple `upload_row` lines using `upload_template_column`.

#### `upload_status_history`
Audit trail for approvals.

| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL PK | |
| batch_id | BIGINT FK → upload_batch | |
| from_status | VARCHAR(30) | |
| to_status | VARCHAR(30) | |
| changed_by | BIGINT FK → app_user | |
| remark | TEXT | |
| changed_at | TIMESTAMPTZ DEFAULT NOW() | |

---

## 8. Common Upload System Architecture (DH / Block / Facility)

### 8.1 Design principle

**One system, three scopes.**

```text
                 ┌─────────────────────────────────────┐
                 │     COMMON UPLOAD MODULE            │
                 │  Templates · Validate · Approve     │
                 │  Publish → fact_component_value     │
                 └──────────────┬──────────────────────┘
          ┌─────────────────────┼─────────────────────┐
          ▼                     ▼                     ▼
   Facility portal        Block portal          District (DH) portal
   (own facility)         (own block +          (own district +
                           facilities)            blocks/facilities)
```

Users never get a different product — only:

1. Different **menu of templates/indicators** (`indicator_upload_rule.upload_geo_level`)
2. Different **geo filter** (`user_geo_assignment`)
3. Different **approval powers** (role)

### 8.2 End-to-end upload flow

```text
1. Login (Facility / Block / DH)
2. Select period + template (or indicator form)
3. Enter data online OR upload Excel/CSV
4. System validates:
     - user may upload this template level
     - geo codes belong under user's assignment
     - required columns present
     - numeric ranges / duplicates for same period
5. Status → submitted / validation_failed / pending_approval
6. Approver (Block or District) reviews
7. On approve → publish job writes fact_component_value
     source = manual_upload, batch_id linked
8. KPI compute job refreshes kpi_value for affected geos/periods
```

### 8.3 Status state machine

```text
draft
  → submitted
      → validation_failed → (fix) → submitted
      → pending_approval
            → rejected → (edit/resubmit) → submitted
            → approved
                  → published
                  → superseded   (if a newer approved batch replaces same geo+period+components)
```

### 8.4 Who uploads what

| Level | Can upload rows for | Can approve |
|-------|---------------------|-------------|
| **Facility** | Own `facility_id` only; indicators with `upload_geo_level=facility` | — (usually cannot approve own data) |
| **Block** | Own block-level indicators; optionally facility rows for facilities in block | Facility uploads in block (if configured) |
| **District (DH)** | District-level indicators; optional block/facility corrections in district | Block (and optionally facility) uploads |

State/Division roles are typically **view + final audit**, not day-to-day entry (configurable).

### 8.5 Conflict rules (manual vs automated ETL)

When the same component + geo + period exists from both `manual_upload` and an external system:

| Policy option | Behaviour |
|---------------|-----------|
| **A. Source priority (recommended v1)** | Prefer automated source if present; manual only if no API value |
| **B. Last approved wins** | Latest `published_at` / `ingested_at` wins |
| **C. Manual override flag** | Manual batch can set `force_override=true` (district approver only) |

Document the chosen policy in ETL config; store winning source on `fact_component_value.source_id`.

### 8.6 Upload UI capabilities (common screens)

1. **My uploads** — list batches with status (same page for all roles)
2. **New upload** — template picker filtered by role level
3. **Download blank template** — Excel with geo pre-filled for user’s scope
4. **Validation report** — row-level errors
5. **Approval inbox** — Block/DH see child submissions
6. **Publish log** — link to facts / KPI refresh status

### 8.7 API sketch (upload)

```text
GET  /api/upload/templates?level=facility
POST /api/upload/batches                 # create draft + attach file or JSON rows
POST /api/upload/batches/{id}/validate
POST /api/upload/batches/{id}/submit
POST /api/upload/batches/{id}/approve    # Block/DH
POST /api/upload/batches/{id}/reject
POST /api/upload/batches/{id}/publish    # or auto on approve
GET  /api/upload/batches?status=pending_approval&district_id=...
```

All endpoints enforce: **requested geo ⊆ user_geo_assignment**.

---

## 9. Computation Logic

### 9.1 Algorithm

For request: **Indicator X at geo G (level L) for period P**

1. Verify `(X, L)` exists in `indicator_level`. If not → reject / hide.
2. Load all `indicator_component` rows for X.
3. For each component:
   - Select `fact_component_value` rows under geo G for period P.
   - Aggregate using `aggregation_method` (usually `SUM`).
4. Combine parts by `role`:
   - Simple ratio: `value = numerator / NULLIF(denominator, 0) * 100`
   - Multi-part (e.g. perinatal): sum numerator parts / sum denominator parts.
5. Upsert into `kpi_value` with numerator, denominator, value.

### 9.2 Roll-up examples

| Indicator | Fact grain | District view |
|-----------|------------|---------------|
| VHND % | Block | Sum conducted & planned for blocks in district, then % |
| Birth registration % | District num + Block denom | Use district registered; sum block estimates; then % |
| Perinatal death % | Facility | Sum facility HMIS parts in district; then % |
| ANM login % | District | Direct district facts; then % |

### 9.3 Division view

Unless an indicator is collected at division:

1. Aggregate child district numerators/denominators (or sum district `kpi_value` numerators/denominators).
2. Recompute %.

Do **not** average district percentages.

---

## 10. Level Matrix Guidance

Populate `indicator_level` from the sheet’s reporting column:

| Sheet value | Suggested `indicator_level` rows |
|-------------|----------------------------------|
| District | `district`, optionally `division` |
| Block | `block`, optionally `district`, `division` |
| Facility | `facility`, and usually `block`, `district`, `division` for roll-up |
| Both | Typically `district` + `block` (plus `division` if required) |

UI rule: if user is browsing Block, only show indicators that include `block`.

---

## 11. Seed Mapping Examples (from sheet)

### 11.1 `% U/VHND sessions conducted against planned`
- **Levels:** district, block  
- **Upload:** Block user (sessions); District may approve  
- **Components:**
  - Sessions conducted → eKavach @ block (numerator) *or manual_upload*
  - Planned / population base → DGFW (or defined planned source) @ block (denominator)
- **Period:** monthly

### 11.2 `% births registered against estimated live births`
- **Levels:** district (+ division)
- **Upload:** District (DH) if CRS feed unavailable  
- **Components:**
  - Births registered → CRS @ district (numerator)
  - Estimated live births → DGFW @ block (denominator; sum to district)
- **Period:** cumulative

### 11.3 `% ANMs logged into eKavach (last 30 days)`
- **Levels:** district (+ division)
- **Upload:** Usually API-only; optional District correction template  
- **Components:**
  - ANMs logged in → eKavach @ district (numerator)
  - Active ANMs → eKavach @ district (denominator)
- **Period:** rolling_30d

### 11.4 `% perinatal deaths before discharge (negative)`
- **Levels:** district, block, facility
- **Upload:** Facility (HMIS line items); Block/DH approve  
- **Components (HMIS @ facility):** fresh stillbirth, macerated stillbirth, newborn deaths 1–7 days, live births male/female
- **Period:** monthly
- **is_negative:** true

---

## 12. API / Query Patterns (design intent)

### List indicators for current context
```text
GET /api/indicators?level=block&category=mch
→ indicators JOIN indicator_level WHERE level = 'block'
```

### KPI values for a geo
```text
GET /api/kpi?indicator_id=...&level=district&district_id=...&period=2025-04
→ kpi_value filtered by indicator + geo + period
```

### Drill-down
```text
GET /api/kpi/children?indicator_id=...&parent_level=district&district_id=...
→ child block/facility kpi_value rows (only if child level is applicable)
```

### Upload (see also Section 8.7)
```text
POST /api/upload/batches  →  validate  →  submit  →  approve  →  publish
```

---

## 13. Security & Data Quality (initial)

| Concern | Approach |
|---------|----------|
| Auth | Roles: state / division / district (DH) / block / facility |
| Geo scope | Enforce `user_geo_assignment` on every read and upload |
| Upload isolation | Facility cannot submit another facility’s code; Block cannot leave district |
| Approval segregation | Uploader ≠ approver (configurable; recommended for facility data) |
| Divide-by-zero | Store NULL value when denominator is 0 |
| Missing facts | Completeness report: expected facilities/blocks vs published batches |
| Idempotent publish | Upsert facts by component + geo + period; supersede old manual batch |
| Audit | `upload_status_history`, `ingested_at`, `computed_at`, batch IDs |

---

## 14. Implementation Phases

| Phase | Deliverable |
|-------|-------------|
| **P0** | This design doc + PostgreSQL schema migrations |
| **P1** | Load geo masters (Division / District / Block / Facility) |
| **P2** | Seed `source_system`, all ~37 `indicator` + `indicator_level` + `indicator_component` + `indicator_upload_rule` |
| **P3** | Users/roles + geo assignment; common upload APIs (draft → validate → submit) |
| **P4** | Approval + publish → `fact_component_value`; Excel templates for Facility / Block / DH |
| **P5** | KPI compute job → `kpi_value`; dashboard read API |
| **P6** | Automated ETL for priority external sources; conflict policy with manual_upload |
| **P7** | Targets/RAG, Division views, completeness & overdue upload alerts |

---

## 15. Out of Scope for v1 Schema

- Real-time streaming ingestion (batch ETL + batch upload first)
- Full data warehouse star-schema redesign
- Machine learning / forecasting tables
- Storing source payloads as the primary fact model (keep normalized facts)
- Offline mobile sync (can add later using same `upload_batch` model)

These can be added later without breaking the indicator/geo/upload/kpi core.

---

## 16. Open Decisions

Confirm before freezing migrations:

1. **Division in v1:** Always allow division roll-up for district-level indicators, or only where sheet says so?
2. **Facility on “Both” indicators:** Show facility drill-down for all HMIS facility-collected KPIs, or only when sheet marks Facility?
3. **History retention:** Keep all monthly history indefinitely, or partition/archive after N years?
4. **Denominator estimates:** Version DGFW estimates by year/month explicitly in facts?
5. **Tech stack for API:** Laravel / Node / Python — schema remains the same either way.
6. **Upload approval chain:** Facility → Block → District, or Facility → District directly?
7. **Manual vs API conflict:** Source priority (A), last wins (B), or forced override (C)?
8. **DH meaning:** Confirm DH = District Health office user (district scope) vs District Hospital facility user (facility scope). Both can be supported via `user_geo_assignment`.

---

## 17. Next Step

1. Freeze upload approval chain + conflict policy (Section 16 items 6–8).  
2. Create SQL migrations for Section 7 (including users + upload staging).  
3. Digitize indicator sheet into seed data, including `indicator_upload_rule` per DH/Block/Facility.  
4. Build common upload UI shell shared by all three roles.

---

*End of document.*
