# User Activity Log API

Tracks **logged-in users**: page access, dashboard views, UI actions, and time spent.

Apply schema once:

```bash
psql -U postgres -d up_health_dashboard -f database/030_user_activity_log.sql
```

---

## URLs (for frontend)

| Method | URL | Who | Purpose |
|--------|-----|-----|---------|
| **POST** | `/api/user-logs` | Any logged-in user | Log one event **or** `{ events: [...] }` |
| **POST** | `/api/user-logs/batch` | Any logged-in user | Log batch `{ events: [...] }` |
| **GET** | `/api/admin/user-logs` | `system_admin` | User list (group by name) |
| **GET** | `/api/admin/user-logs/user/:userId` | `system_admin` | User activity + time summary |
| **GET** | `/api/admin/user-logs/summary` | `system_admin` | Activity summary |
| **GET** | `/api/admin/user-logs/time-summary` | `system_admin` | **Time spent** by user / page / day |

All require: `Authorization: Bearer <token>`

Base (local): `http://localhost:3010`  
Base (prod example): `https://upranking.demoaqueretech.in/api` → paths below are after `/api` if gateway strips prefix — use full path as mounted: `/api/user-logs`.

---

## Event types

| `event_type` | When to send |
|--------------|----------------|
| `login` | After successful login (**auto-logged by backend** on `POST /api/auth/login`) |
| `logout` | On logout (**auto-logged** on `POST /api/auth/logout` — FE must call this) |
| `page_view` | Enter a route / page |
| `dashboard_view` | Open ranking map/table/analytics/executive |
| `page_heartbeat` | Every 30–60s while page visible (include `duration_ms` cumulative or delta) |
| `page_leave` | Leave page / tab hide (include total `duration_ms` for that visit) |
| `action` | Click filter, download, sync, change indicator, etc. |
| `api_hit` | **Auto-logged by backend** on every authenticated API call (response unchanged) |

**Aliases accepted:** `pageView` / `pageview` → `page_view`; `leave` / `pageLeave` → `page_leave`; `heartbeat` / `ping` → `page_heartbeat`; `click` → `action`; `dashboard` → `dashboard_view`; also `eventType`, `event`, `type` field names.

---

## Write — single event

```http
POST /api/user-logs
Authorization: Bearer <token>
Content-Type: application/json

{
  "event_type": "page_view",
  "session_id": "a1b2c3d4-uuid",
  "page": "/ranking",
  "page_title": "Health Ranking Dashboard",
  "view_mode": "map",
  "geo_level": "division",
  "period_label": "2026-07",
  "dashboard_code": "ranking",
  "client_ts": "2026-09-30T09:45:00.000Z"
}
```

### Time spent (on leave)

```json
{
  "event_type": "page_leave",
  "session_id": "a1b2c3d4-uuid",
  "page": "/ranking",
  "view_mode": "table",
  "duration_ms": 185000,
  "period_label": "2026-07"
}
```

(`duration_sec` also accepted → converted to ms.)

### Action

```json
{
  "event_type": "action",
  "session_id": "a1b2c3d4-uuid",
  "page": "/ranking",
  "action_name": "download_report",
  "action_payload": { "format": "xlsx", "period": "2026-07" },
  "view_mode": "map"
}
```

### Batch

```http
POST /api/user-logs/batch
```

```json
{
  "events": [
    { "event_type": "page_view", "page": "/ranking", "session_id": "…" },
    { "event_type": "action", "page": "/ranking", "action_name": "filter_aspirational", "session_id": "…" }
  ]
}
```

Max **100** events per request.

---

## FE integration tips

1. Generate `session_id` once per browser tab (`crypto.randomUUID()`), reuse until logout.
2. On route enter → `page_view` / `dashboard_view`.
3. Start timer; on leave / `visibilitychange` hidden → `page_leave` with `duration_ms`.
4. Optional: heartbeat every 30s with cumulative `duration_ms` (survives crash).
5. Fire-and-forget (`navigator.sendBeacon` or `fetch` keepalive) on unload if possible.

---

## Admin — User Logs UI (2 steps)

### Step 1 — list users (clickable names)
```http
GET /api/admin/user-logs?page=1&page_size=25
```
Returns `users[]` / `groups[]` with counts + `logs_url` (no nested logs).

### Step 2 — click user → show that user’s activity
```http
GET /api/admin/user-logs/user/{user_id}?page=1&page_size=50
```
Example: `GET /api/admin/user-logs/user/18?page=1&page_size=50`

Returns `{ user: { name, username, … }, logs: [ … ] }`.

### Summary (optional cards)
```http
GET /api/admin/user-logs/summary
```

### Time summary (manage time spent)
```http
GET /api/admin/user-logs/time-summary
GET /api/admin/user-logs/time-summary?user_id=18
GET /api/admin/user-logs/time-summary?from=2026-09-01&to=2026-09-30&source=leave
```

Response:
- `totals` / `time_summary` — overall `duration_display` (`HH:MM:SS`), min, hours
- `users[]` — time per user (click → `logs_url` / `time_url`)
- `by_page[]` — time per page
- `by_day[]` — daily time (IST)

`source`: `leave` (default, recommended) | `all` | `heartbeat`

User detail also includes `time_summary`, `time_by_page`, `time_by_day`.

| Param | Meaning |
|-------|---------|
| `page` / `p` | Pagination |
| `page_size` | Page size |
| `page_path` | Filter by route |
| `event_type` | Filter event |
| `from` / `to` | Date range |
| `q` | Search |
| `group_by` | `name` (default list) \| `none` (flat) |
| `logs_per_user` | Embed N logs in list (default **0**) |
| `source` | Time calc: `leave` \| `all` \| `heartbeat` |

---

## Curl examples

```bash
TOKEN=$(curl -s -X POST http://localhost:3010/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"sysadmin","password":"Pass@123"}' | jq -r .token)

# Log page view
curl -X POST http://localhost:3010/api/user-logs \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"event_type":"dashboard_view","page":"/ranking","view_mode":"map","period_label":"2026-07","session_id":"demo-session-1"}'

# Log time spent
curl -X POST http://localhost:3010/api/user-logs \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"event_type":"page_leave","page":"/ranking","duration_ms":120000,"session_id":"demo-session-1"}'

# Admin summary
curl "http://localhost:3010/api/admin/user-logs/summary" \
  -H "Authorization: Bearer $TOKEN"
```
