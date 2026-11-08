# Lead Inbox

A lead inbox for a small service business. Customers send requests through a public form. Each lead is
automatically sorted by category and urgency, and the owner works through them on a mobile-friendly dashboard.

- **Public lead form** at `/`
- **Owner dashboard** at `/dashboard`: filter, change status, add notes
- **JSON API** with bearer-token auth
- **Rule-based sorting**: no AI and no API keys
- **Webhook** (`lead.created`) on every new lead

Stack: Node.js, Express 5, PostgreSQL (`pg`), plain HTML/CSS/JS. No build step.

> Handing this project over? See [HANDOFF.md](HANDOFF.md) for credentials, assumptions and next steps.

---

## Quick start

### 1. Requirements

- **Node.js 20.6 or newer**: check with `node -v`
- **A PostgreSQL database.** The easiest option is a free [Neon](https://neon.tech) database, with nothing to
  install. A local Postgres works too.

### 2. Install

```bash
git clone https://github.com/<you>/lead-inbox.git
cd lead-inbox
npm install
```

### 3. Configure

Copy the example env file:

```bash
cp .env.example .env              # macOS / Linux / Git Bash
Copy-Item .env.example .env       # Windows PowerShell
```

Then edit `.env`:

| Variable | What to put |
|---|---|
| `PORT` | `3000` locally. On Render, leave it unset (Render sets it). |
| `DATABASE_URL` | Your Postgres connection string. For Neon, copy it from the dashboard and keep `?sslmode=require`. |
| `API_TOKEN` | A long random string. The dashboard and API use it. |
| `WEBHOOK_URL` | Where `lead.created` events are POSTed. Leave it empty to turn webhooks off. |
| `OWNER_USER` | Dashboard username. |
| `OWNER_PASS` | Dashboard password. |

Generate a token:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`.env` is git-ignored. Never commit it.

### 4. Run

```bash
npm run dev
```

You should see `lead-inbox listening on :3000`. The `leads` table is created automatically the first time.

- Form: <http://localhost:3000/>
- Dashboard: <http://localhost:3000/dashboard> (log in with `OWNER_USER` / `OWNER_PASS`)
- Health check: <http://localhost:3000/health>

### 5. Test

With the server running, open a second terminal:

```bash
npm run test:local
```

This runs about 180 end-to-end checks against `http://localhost:3000`: validation, auth, filters,
ordering, classifier and webhook failure handling. It ends with `N passed, 0 failed`.

---

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Start the server using env vars from the environment (for production / Render) |
| `npm run dev` | Start the server and load `.env` |
| `npm run test:local` | Run the API tests against the local server, using `.env` |
| `npm test` | Run the API tests against `BASE_URL` (see [Testing a deployed server](#testing-a-deployed-server)) |

---

## Deploy to Render (free)

1. Create a free **Neon** database and copy its connection string.
2. Push this repo to **GitHub**.
3. In **Render**, choose **New → Blueprint** and select the repo. [`render.yaml`](render.yaml) configures the service.
4. Fill in `DATABASE_URL`, `OWNER_USER` and `OWNER_PASS`. `API_TOKEN` is generated for you; copy it
   from the service's **Environment** tab. `WEBHOOK_URL` is already set.
5. Wait for the deploy, then open `https://<your-service>.onrender.com/health`.

Prefer to set it up by hand? Choose **New → Web Service** with build command `npm ci`, start command `npm start`,
health check path `/health`, and the env vars above.

Render's free tier sleeps after about 15 minutes idle, so the first request after that takes 30–60 seconds.

### Testing a deployed server

```bash
BASE_URL=https://<your-service>.onrender.com \
API_TOKEN=<token> OWNER_USER=<user> OWNER_PASS=<pass> \
npm test
```

The webhook tests are skipped remotely, because they need to start local copies of the server.

---

## API

All requests and responses are JSON. Every route except `POST /api/leads` and `POST /api/login` needs:

```
Authorization: Bearer <API_TOKEN>
```

A missing or wrong token returns `401 {"error": "..."}`.

| Method | Path | Auth | Success | Notes |
|---|---|---|---|---|
| `POST` | `/api/leads` | public | `201` + lead | Bad input returns `400 {"error"}`. CORS enabled. |
| `GET` | `/api/leads` | token | `200 {"leads": [...]}` | Newest first. Optional `?status=` and `?category=`. |
| `GET` | `/api/leads/:id` | token | `200` + lead | Unknown or non-numeric id returns `404`. |
| `PATCH` | `/api/leads/:id` | token | `200` + lead | Body `{"status"}` and/or `{"note"}`. |
| `POST` | `/api/login` | public | `200 {"token"}` | Body `{"username", "password"}`. Wrong credentials return `401`. |
| `GET` | `/health` | public | `200 {"status": "ok"}` | |

### Lead object

```json
{
  "id": 12,
  "name": "Ana Cruz",
  "email": "ana@example.com",
  "phone": "",
  "service": "cleaning",
  "message": "Can you book me in on Tuesday?",
  "category": "booking",
  "urgency": "normal",
  "status": "new",
  "note": "",
  "created_at": "2026-11-07T09:30:00Z"
}
```

### Rules

| Field | Rule |
|---|---|
| `name` | Required, max 100 characters |
| `email` | Required, valid email format |
| `phone` | Optional, defaults to `""` |
| `service` | `cleaning`, `repair`, `consultation` or `other` |
| `message` | Required, max 2000 characters |
| `status` | `new` (default), `contacted`, `won` or `lost` |
| `note` | String, defaults to `""` |

Text is stored exactly as typed: no trimming or escaping.

### Example

```bash
curl -X POST http://localhost:3000/api/leads \
  -H "Content-Type: application/json" \
  -d '{"name":"Ana Cruz","email":"ana@example.com","service":"cleaning","message":"I need a quote asap"}'

curl http://localhost:3000/api/leads?status=new \
  -H "Authorization: Bearer $API_TOKEN"

curl -X PATCH http://localhost:3000/api/leads/1 \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"contacted","note":"Called, left voicemail"}'
```

---

## How leads are sorted

[`src/classifier.js`](src/classifier.js) uses case-insensitive keyword rules on the message. If more than one
category matches, the first one in this table wins.

| Category | Keywords |
|---|---|
| `complaint` | refund, terrible, awful, angry, broken, unhappy, complain, disappointed, worst, rude, never again |
| `booking` | book, schedule, appointment, available, availability, reserve, come on, quote |
| `question` | `?`, how much, do you, can you, what, when, price, rate, cost |
| `other` | anything else |

| Urgency | When |
|---|---|
| `high` | urgent, asap, emergency, today, immediately, right now, tonight, or any complaint |
| `low` | whenever, no rush, just curious, next month |
| `normal` | everything else |

To change the sorting, edit the keyword lists at the top of the file.

## Webhook

After a lead is saved, the server POSTs this to `WEBHOOK_URL`:

```json
{ "event": "lead.created", "lead": { ... } }
```

The webhook has a 5-second timeout and runs in the background. If it's slow or down, the error is logged
and the `201` response is unaffected.

---

## Project structure

```
src/
  server.js       entry point: config checks, DB init, start listening
  app.js          Express app: routes, auth, CORS, error handling
  db.js           Postgres pool, table creation, queries
  validate.js     input validation for create / update
  classifier.js   rule-based category + urgency
  webhook.js      fire-and-forget lead.created webhook
public/
  index.html, form.js            public lead form
  dashboard.html, dashboard.js   owner dashboard
  styles.css                     shared styles (mobile-first, dark mode)
test/
  api.test.js     end-to-end API tests (no framework)
render.yaml       Render blueprint
.env.example      env var template
```

## Troubleshooting

| Problem | Fix |
|---|---|
| `DATABASE_URL is not set` | You ran `npm start` locally. Use `npm run dev`, which loads `.env`. |
| `[db] init failed ... retrying` | Check `DATABASE_URL`. For Neon, make sure `?sslmode=require` is on the end. |
| `node: bad option: --env-file` | Your Node is older than 20.6. Upgrade Node. |
| Dashboard login says wrong password | Check `OWNER_USER` / `OWNER_PASS` in `.env` (or on Render) and restart the server. |
| `401` from the API | Send `Authorization: Bearer <API_TOKEN>` with the exact token value. |
| `EADDRINUSE :3000` | Something else is using port 3000. Change `PORT` in `.env`. |
| `[webhook] ... fetch failed` in logs | The webhook endpoint is down. Leads are still saved. |
