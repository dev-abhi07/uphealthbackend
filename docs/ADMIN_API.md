# Admin user management API

Auth: `Authorization: Bearer <token>` — **`system_admin` only**.  
`state_admin` (State) can view statewide ranking but **cannot** manage users.

Data is loaded from the outcome API — there are **no uploader roles**.

## Roles (only these five)

| Panel label | `role` code | Geo required |
|-------------|-------------|--------------|
| System Admin | `system_admin` | No |
| State | `state_admin` | No |
| Division | `division_viewer` | `geo.division_id` |
| District | `district_viewer` | `geo.district_id` |
| Block | `block_viewer` | `geo.block_id` / `block_lgd` |

Aliases accepted on create/update: `state`, `division`, `district`, `block`.

## Seed login

```bash
node src/db/seedAuthUsers.js
```

Only these two users are seeded (create the rest from the panel):

| Username | Password | Role |
|----------|----------|------|
| `sysadmin` | `Pass@123` | System Admin |
| `state.admin` | `Pass@123` | State |

## Endpoints

| Method | Path |
|--------|------|
| GET | `/api/admin/roles` |
| GET | `/api/admin/geo-options` (`?division_id=` / `?district_id=`) |
| GET | `/api/admin/users` |
| POST | `/api/admin/users` |
| GET / PUT | `/api/admin/users/:id` |
| PATCH | `/api/admin/users/:id/active` |
| POST | `/api/admin/users/:id/reset-password` |

## List users (search + pagination)

```http
GET /api/admin/users?search=lucknow&page=1&page_size=20
GET /api/admin/users?q=bkt&role=block&is_active=true&page=1&limit=10
```

| Query | Description |
|-------|-------------|
| `search` or `q` | Case-insensitive match on username, full name, email, mobile, role, division/district/block name or LGD |
| `page` | Page number (default `1`) |
| `page_size` or `limit` | Page size (default `20`, max `100`) |
| `role` | Filter: `system_admin` / `state` / `division` / `district` / `block` |
| `geo_level` | `state` \| `division` \| `district` \| `block` |
| `is_active` | `true` / `false` |

Response extras: `total`, `page`, `page_size`, `total_pages`, `has_next`, `has_prev`, `search`, `filters`, `items`.

## Create examples

```json
{ "username": "up.state", "password": "Pass@123", "role": "state" }

{ "username": "lucknow.div", "password": "Pass@123", "role": "division",
  "geo": { "geo_level": "division", "division_id": 3 } }

{ "username": "gbn.dh", "password": "Pass@123", "role": "district",
  "geo": { "geo_level": "district", "district_id": 42 } }

{ "username": "bkt.block", "password": "Pass@123", "role": "block",
  "geo": { "geo_level": "block", "block_lgd": "1329" } }
```
