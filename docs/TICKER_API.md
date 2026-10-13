# Ticker (marquee) API — for Frontend

Sub-dashboard wise ticker messages (create / update / delete / read).

**Auth**
- Public marquee read: any logged-in user (`Authorization: Bearer <token>`)
- Admin CRUD: **`system_admin` only** (`sysadmin` / `Pass@123`)

**Dashboard codes** (dropdown `value`)

| code | UI label |
|------|----------|
| `health_ranking` | Health Ranking |
| `program_area` | Program Area |
| `cm_dashboard` | CM Dashboard |
| `niti_dashboard` | NITI Dashboard |
| `cmo_dashboard` | CMO Dashboard |
| `landing_page` | Landing Page |

---

## 1) Dropdown options (any logged-in user)

Works for **division / district / block / state / system_admin**:

```http
GET /api/admin/ticker-dashboards
Authorization: Bearer <any_token>
```

Aliases (same response):
```http
GET /api/admin/ticker_dashboards
GET /api/tickers/dashboards
```

**Create / update / delete** tickers still require **`system_admin`** (`POST/PUT/DELETE /api/admin/tickers`).

**Response**
```json
{
  "success": true,
  "dashboards": [
    { "code": "health_ranking", "name": "Health Ranking", "value": "health_ranking", "label": "Health Ranking", "sort_order": 1, "is_active": true }
  ]
}
```

Use `value` / `code` in create/update payload as `dashboard_code`.

---

## 2) Create ticker

```http
POST /api/admin/tickers
Authorization: Bearer <sysadmin_token>
Content-Type: application/json
```

**Payload**
```json
{
  "dashboard_code": "health_ranking",
  "message": "Data for July 2026 has been updated on the Health Ranking dashboard.",
  "is_active": true,
  "starts_at": null,
  "ends_at": null
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `dashboard_code` | yes | one of the codes above (alias: `dashboard`) |
| `message` | yes | non-empty marquee text |
| `is_active` | no | default `true` |
| `starts_at` | no | ISO datetime; null = no start limit |
| `ends_at` | no | ISO datetime; null = no end limit |

**Response `201`**
```json
{
  "success": true,
  "ticker": {
    "id": 1,
    "dashboard_code": "health_ranking",
    "dashboard_name": "Health Ranking",
    "message": "Data for July 2026…",
    "is_active": true,
    "starts_at": null,
    "ends_at": null,
    "created_by": 1,
    "updated_by": 1,
    "created_at": "2026-09-29T07:00:00.000Z",
    "updated_at": "2026-09-29T07:00:00.000Z"
  }
}
```

---

## 3) List tickers (admin panel)

```http
GET /api/admin/tickers?dashboard=health_ranking&is_active=true&page=1&page_size=50
Authorization: Bearer <sysadmin_token>
```

Query params (all optional): `dashboard` / `dashboard_code`, `is_active`, `q` (search message), `page`, `page_size`.

---

## 4) Get one

```http
GET /api/admin/tickers/:id
Authorization: Bearer <sysadmin_token>
```

---

## 5) Update ticker

```http
PUT /api/admin/tickers/:id
Authorization: Bearer <sysadmin_token>
Content-Type: application/json
```

**Payload** (send only fields to change, or full object)
```json
{
  "dashboard_code": "landing_page",
  "message": "Updated marquee text",
  "is_active": true,
  "starts_at": "2026-09-01T00:00:00.000Z",
  "ends_at": "2026-12-31T23:59:59.000Z"
}
```

---

## 6) Delete ticker

Soft delete (sets `is_active=false`) — default:

```http
DELETE /api/admin/tickers/:id
Authorization: Bearer <sysadmin_token>
```

Hard delete:

```http
DELETE /api/admin/tickers/:id?hard=1
Authorization: Bearer <sysadmin_token>
```

**Response**
```json
{ "success": true, "id": 1, "deleted": true, "soft": true }
```

---

## 7) Public marquee (any logged-in user)

Show on Health Ranking / Landing / etc.

```http
GET /api/tickers?dashboard=health_ranking
Authorization: Bearer <any_user_token>
```

Omit `dashboard` to get all active tickers across dashboards.

**Response**
```json
{
  "success": true,
  "dashboard": "health_ranking",
  "count": 1,
  "tickers": [
    {
      "id": 1,
      "dashboard_code": "health_ranking",
      "dashboard_name": "Health Ranking",
      "message": "Data for July 2026…",
      "is_active": true,
      "starts_at": null,
      "ends_at": null,
      "updated_at": "2026-09-29T07:00:00.000Z"
    }
  ]
}
```

Only returns rows where `is_active=true` and within optional `starts_at`/`ends_at` window.

---

## FE wiring cheat-sheet

| UI action | API |
|-----------|-----|
| Open create modal → fill Dashboards dropdown | `GET /api/admin/ticker-dashboards` |
| Submit create | `POST /api/admin/tickers` |
| Edit existing | `PUT /api/admin/tickers/:id` |
| Delete | `DELETE /api/admin/tickers/:id` |
| Show marquee on Health Ranking | `GET /api/tickers?dashboard=health_ranking` |
| Show marquee on Landing Page | `GET /api/tickers?dashboard=landing_page` |

**Migration:** run `database/029_ticker_notification.sql` on Postgres.
