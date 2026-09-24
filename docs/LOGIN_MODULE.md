# Authentication API — State / Division / District / Block login

JWT-based auth. Each user has a **role** + optional **geo assignment**. Ranking APIs enforce that scope.

## Setup

```bash
npm run db:auth   # schema + demo users
npm run dev       # API on PORT from .env (default 3010)
```

## Demo users (password: `Pass@123`)

| Username | Role | Sees |
|----------|------|------|
| `state.admin` / `admin` | `state_admin` | Entire UP |
| `prayagraj.div` | `division_viewer` | Prayagraj Division |
| `agra.div` | `division_viewer` | Agra Division |
| `lucknow.div` | `division_viewer` | Lucknow Division |
| `prayagraj.dh` | `district_viewer` | Prayagraj district |
| `agra.dh` | `district_viewer` | Agra district |
| `lucknow.dh` | `district_viewer` | Lucknow district |
| `prayagraj.handia` | `block_viewer` | Handia block |
| `agra.achhnera` | `block_viewer` | Achhnera block |
| `lucknow.bkt` | `block_viewer` | Bakshi-Ka-Talab block |

List via API:

```http
GET /api/auth/demo-accounts
```

---

## Endpoints

| Method | Path | Auth | Body / notes |
|--------|------|------|----------------|
| POST | `/api/auth/login` | No | `{ "username", "password" }` |
| GET | `/api/auth/me` | Bearer | Profile + `scope` |
| POST | `/api/auth/change-password` | Bearer | `{ "current_password", "new_password" }` |
| POST | `/api/auth/logout` | Bearer | Client discards token |
| GET | `/api/auth/demo-accounts` | No | Demo usernames (no passwords) |

---

## Login

```bash
curl -s -X POST http://localhost:3010/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"prayagraj.div","password":"Pass@123"}'
```

### Response shape

```json
{
  "success": true,
  "token": "<jwt>",
  "token_type": "Bearer",
  "expires_in": "8h",
  "scope": { "...same as user.scope..." },
  "user": {
    "id": 3,
    "username": "prayagraj.div",
    "full_name": "Prayagraj Division Viewer",
    "roles": [{ "code": "division_viewer", "name": "Division Viewer" }],
    "geo_assignments": [
      {
        "geo_level": "division",
        "division_id": "1",
        "division_name": "Prayagraj Division",
        "division_code": "11075",
        "district_id": null,
        "district_name": null,
        "block_id": null,
        "block_name": null
      }
    ],
    "scope": {
      "level": "division",
      "is_state_admin": false,
      "can_upload": false,
      "can_view_statewide": false,
      "division_id": 1,
      "division_name": "Prayagraj Division",
      "division_code": "11075",
      "district_id": null,
      "district_name": null,
      "block_id": null,
      "block_name": null,
      "label": "Prayagraj Division",
      "default_filters": {
        "level": "district",
        "table_mode": "district",
        "div_code": "11075",
        "division": "Prayagraj Division",
        "division_id": "1"
      }
    }
  }
}
```

### Scope by login type

| Login | `scope.level` | `default_filters` highlights |
|-------|---------------|------------------------------|
| State | `state` | `level=division` (statewide) |
| Division | `division` | `div_code`, `division` |
| District | `district` | `district`, `district_id` |
| Block | `block` | `district` + `block` |

Use `Authorization: Bearer <token>` on all ranking / dashboard APIs.

---

## Me

```bash
curl -s http://localhost:3010/api/auth/me \
  -H "Authorization: Bearer <token>"
```

Returns `{ success, user, scope }` (same `scope` as login).

---

## Frontend usage

```js
const res = await fetch(`${BASE}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username, password }),
});
const data = await res.json();
localStorage.setItem("accessToken", data.token);
localStorage.setItem("userDetail", JSON.stringify(data.user));
// Apply data.user.scope.default_filters on Health Ranking URL
```

---

## DB

- `app_user`, `user_role`, `user_geo_assignment`
- Roles: `state_admin`, `division_viewer`, `district_viewer`, `block_viewer`, …
- Schema: `database/015_auth_schema.sql`
- Seed: `npm run db:auth` → `src/db/seedAuthUsers.js`
