# ProxyCopyServer

A **TypeScript** proxy & cache server with a **Next.js** configuration panel.

Point your client apps at `http://localhost:3000/proxy/<path>` instead of the real API.  
The server either records every response to disk (**Proxy Mode**) or replays the recorded responses without hitting the network (**Cache Mode**).

---

## How it works

```
Client app  →  http://localhost:3000/proxy/oauth/token
                         │
                         ▼
          ┌──────────────────────────────────────┐
          │  ProxyCopyServer  :3000              │
          │                                      │
          │  PROXY MODE                          │
          │  ├─ strips /proxy prefix             │
          │  ├─ forwards → Upstream API          │
          │  └─ saves → mock/{hostname}/{path}/  │
          │                                      │
          │  CACHE MODE                          │
          │  ├─ reads from mock/{hostname}/{path}/│
          │  └─ no network call needed           │
          └──────────────────────────────────────┘
                         │
                         ▼
          Config Panel  :3001  (Next.js UI)
```

> The **Upstream Service URL** in the config panel:
> - In **Proxy Mode**: where requests are forwarded to.
> - In **Cache Mode**: which recorded environment to serve from
>   (switching the URL switches the active cache folder).

---

## Project Structure

```
proxycopyserver/
├── backend/                        # Express + TypeScript (port 3000)
│   ├── src/
│   │   ├── index.ts                # Server entry — mounts /api + /proxy/*
│   │   ├── proxy.ts                # Core proxy/cache logic
│   │   ├── config.ts               # Config singleton + getHostname()
│   │   ├── utils.ts                # getPath, existFile, fetchWithTimeout
│   │   ├── types.ts                # Shared TypeScript interfaces
│   │   └── routes/
│   │       └── config.routes.ts    # REST API consumed by the panel
│   ├── mock/                       # Cached responses (auto-created, git-ignored)
│   │   └── {hostname}/
│   │       └── {uri-path}/
│   │           └── {METHOD}[_?q=v][_&b=v]_{status}.json
│   ├── config.json                 # Runtime config (auto-created, git-ignored)
│   ├── config.example.json         # Schema reference
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/                       # Next.js config panel (port 3001)
│   └── src/
│       ├── app/                    # Next.js App Router
│       ├── components/             # ConfigDashboard, ServerSettings, …
│       └── lib/api.ts              # Typed REST client
│
├── package.json                    # Workspace scripts (concurrently)
└── README.md
```

---

## Quick Start

### Prerequisites
- Node.js ≥ 18 (uses native `fetch`)

### Install & run

```bash
# 1. Install dependencies in both workspaces
cd backend  && npm install
cd ../frontend && npm install
cd ..

# 2. Install concurrently at the root (needed for npm run dev)
npm install

# 3. Start both servers simultaneously
npm run dev
#   backend  →  http://localhost:3000
#   frontend →  http://localhost:3001
```

Or run them separately:

```bash
npm run dev:backend    # Express proxy server
npm run dev:frontend   # Next.js config panel
```

---

## Sending requests through the proxy

All the client's requests must be prefixed with `/proxy`:

```bash
# Instead of:
curl https://api.bancolombia.com/oauth/token

# Use:
curl http://localhost:3000/proxy/oauth/token
#                                  ^^^^^^
#             your baseURL becomes http://localhost:3000/proxy
```

The `/proxy` prefix is stripped before forwarding — the upstream service receives the original path.

---

## Configuration Panel  (`http://localhost:3001`)

### ⚙️ General

| Field | Description |
|---|---|
| **Upstream Service URL** | URL of the real API. In Proxy Mode: where to forward. In Cache Mode: which recorded environment to read from. |
| **Operation Mode** | **Cache Mode** = serve from disk (no network). **Proxy Mode** = forward & record. |

### ✅ Validate Rules

Per-route rules that control how requests are fingerprinted into unique cache filenames.

| Field | Description |
|---|---|
| **Route** | URI path (without `/proxy`), e.g. `/oauth/token` |
| **Body params** | POST body fields whose values are appended to the cache key |
| **Query params** | `🌐 All` (default) / `🚫 None` / `🔍 Specific` — which URL query params affect the cache key |
| **Fallback** | If enabled: serve closest cached response when exact match is not found |

**Filename formula:**
```
{METHOD}[_?qParam=val&...]_[&bodyParam=val]_{statusCode}.json
```

Example — `POST /oauth/token?version=2`, body `{client_id:"myapp"}`, rule with specific `queryParams: ["version"]` and body `params: ["client_id"]`:
```
POST_?version=2_&client_id=myapp_200.json
```

### 🔑 Session Headers

HTTP headers forwarded from the incoming request to the upstream service (e.g. `authorization`, `x-api-key`).

### 📦 Cache Manager

Browse cached files grouped by domain/environment, search by path, and clear all with one click.

---

## Cache folder structure

```
backend/mock/
  api.bancolombia.com/          ← production captures
    oauth/
      token/
        POST_&client_id=myapp_200.json
    movimientos/
        GET_?page=2&status=active_200.json

  staging.bancolombia.com/      ← staging captures (coexist)
    oauth/
      token/
        POST_&client_id=myapp_200.json

  _default/                     ← when no URL is configured
```

Switching the **Upstream Service URL** in the panel instantly changes which of these folders is read in Cache Mode.

---

## REST API (backend)

| Method | Path | Description |
|--------|------|-------------|
| `GET`    | `/api/config` | Get current configuration |
| `PUT`    | `/api/config` | Replace whole configuration |
| `POST`   | `/api/config/validate` | Add a validate rule |
| `PUT`    | `/api/config/validate/:index` | Update a validate rule |
| `DELETE` | `/api/config/validate/:index` | Remove a validate rule |
| `POST`   | `/api/config/session` | Add a session header |
| `DELETE` | `/api/config/session/:index` | Remove a session header |
| `GET`    | `/api/mock/list` | List all cached files |
| `DELETE` | `/api/mock/clear` | Clear all cached files |
| `ALL`    | `/proxy/*` | Proxy catch-all — record or replay |

---

## Cache file format

```json
{
  "uri": "/oauth/token",
  "method": "POST",
  "req": {
    "headers": { "authorization": "Bearer …" },
    "body": { "client_id": "myapp", "grant_type": "password" }
  },
  "res": {
    "statusCode": "200",
    "headers": { "content-type": "application/json" },
    "responseTime": 143,
    "body": { "access_token": "…" }
  }
}
```

HTML, CSS, and JS assets are stored as companion files; the JSON holds a reference in `htmlFilePath`.

---

## Environment variables

### Backend (`backend/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT`   | `3000`  | Port for the Express server |

### Frontend (`frontend/.env.local`)

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKEND_URL` | `http://localhost:3000` | Backend URL used by Next.js to proxy `/api/*` requests |

---

## Tech stack

| Layer | Tech |
|---|---|
| Backend | Node.js 18+, Express 4, TypeScript 5, tsx |
| Frontend | Next.js 15+, React 19, TypeScript 5 |
| Design | Custom dark glassmorphism (no CSS framework) |
