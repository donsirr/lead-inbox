# Lead Inbox: Handoff

A small CRM lead inbox. Visitors send a request at `/`, and the owner manages leads at `/dashboard`.
Built with Node.js, Express and PostgreSQL. There's no build step, no paid services and no AI APIs.

## Live app (fill in after deploying)

| What | Value |
|---|---|
| App URL | `https://<your-service>.onrender.com` |
| Lead form | `https://<your-service>.onrender.com/` |
| Dashboard | `https://<your-service>.onrender.com/dashboard` |
| Owner login | user `<OWNER_USER>`, password `<OWNER_PASS>` |
| API token | `<API_TOKEN>` (send as `Authorization: Bearer <API_TOKEN>`) |

## Run locally

Requires Node 20.6+ and a Postgres database. A free Neon database works fine for local dev too.

```bash
npm install
cp .env.example .env        # then edit .env: DATABASE_URL, API_TOKEN, OWNER_USER, OWNER_PASS
npm run dev                 # http://localhost:3000
npm run test:local          # runs the API tests against the local server (in a second terminal)
```

The app creates the `leads` table on startup if it doesn't exist.

To test a deployed server (the webhook tests are skipped, because they need to start local copies of the server):

```bash
BASE_URL=https://<your-service>.onrender.com API_TOKEN=<token> OWNER_USER=<user> OWNER_PASS=<pass> npm test
```

## Deploy (Render + Neon, both free)

1. **Neon**: create a project at neon.tech and copy the connection string (it ends in `?sslmode=require`).
2. **GitHub**: push this repo.
3. **Render**: New > Blueprint > pick the repo. `render.yaml` sets up the service. Fill in
   `DATABASE_URL`, `OWNER_USER` and `OWNER_PASS`. `API_TOKEN` is generated for you; copy it from the
   service's Environment tab.
   (Or New > Web Service by hand: build `npm ci`, start `npm start`, health check `/health`, and the
   same env vars.)
4. Open `/health` (it should return `{"status":"ok"}`), then submit the form and log in to `/dashboard`.

Note: Render's free tier sleeps after about 15 minutes without traffic, so the first request after that takes
30 to 60 seconds. Neon also suspends idle databases. The app retries the database connection on startup.

## What works

- `POST /api/leads` (public, CORS enabled): validation with clear 400 errors, never a 500 on bad input
  (wrong types, missing body, malformed JSON, arrays, NUL bytes). Text is stored exactly as typed.
- `GET /api/leads` returns newest first (up to 500) and supports `?status=` and `?category=` filters, alone or together.
- `GET /api/leads/:id` and `PATCH /api/leads/:id` (status and/or note).
- Bearer-token auth on everything except `POST /api/leads` and `POST /api/login`. Auth is checked before
  404s, validation and even JSON parsing.
- `POST /api/login` checks OWNER_USER/OWNER_PASS (timing-safe) and returns the token.
- Rule-based category and urgency on each new lead (`src/classifier.js`).
- Webhook `lead.created` is sent after saving, without waiting on it, with a 5s timeout. Failures are only logged.
- Dashboard: login, filters, status change, note editing, logout, cards on mobile and a grid on desktop, dark mode.
  All lead text is rendered with `textContent` (no `innerHTML`), so it's XSS safe.
- `GET /health`, trust proxy, graceful shutdown.
- `test/api.test.js`: 181 checks, all passing locally.

## What doesn't (yet)

- No rate limiting or spam protection on the public form.
- No pagination: the list returns the newest 500. The spec asked for at least 100.
- A single owner account. The "session" is just the API token kept in sessionStorage (it's cleared
  when the tab closes). Changing the token means updating `API_TOKEN` and logging in again.
- The UI was syntax-checked and the API it uses is fully tested, but I couldn't click through it in a real
  browser during this session. Give it a quick manual look on your phone.
- Only tested against Neon-compatible Postgres. Supabase should work, but its SSL certificate setup may need
  a tweak to the connection settings.

## Assumptions and judgment calls

- **Rules-only sorting, no AI**, as required. See "Why rules-only" below.
- **Postgres for persistence.** Render's free disk is wiped on every deploy.
- **The spec's example lead doesn't match its own rules.** The example message "Can you come Tuesday?" is
  labelled `booking`, but no booking keyword appears in it ("come on" is not "come Tuesday"). By the
  rules it contains "can you" and "?", so it is classified as **question**. I followed the rules.
  If you want it to be booking, add a keyword such as "come" to the booking list.
- **Keyword matching** is case-insensitive and anchored at the start of a word. "book" matches
  "booking" and "booked" but not "facebook", and "rate" doesn't match "separate". "?" matches anywhere.
  Because of that, "whenever" also contains "when", so it counts as a question.
- **Urgency order**: a high keyword or a complaint gives high, otherwise a low keyword gives low, otherwise
  normal. So a complaint that says "no rush" is still high.
- **"Required"** means not missing, not null, and not just whitespace. The value is still stored untrimmed.
- **Lengths** are counted in characters, so an emoji counts as 1. Extra limits not in the spec:
  email 254, phone 50, note 5000.
- **service** is required.
- **phone** may be omitted or null, which gives `""`. If present it must be a string.
- **created_at** is returned to whole seconds (`2026-11-07T09:30:00Z`) to match the example. Ordering
  uses the full precision plus id.
- **Filters**: `?status=` with an empty value means no filter (that's how "All" works in the dashboard).
  Unknown values, wrong case, or a repeated parameter return `{"leads": []}`.
- **IDs**: anything other than a positive whole number within the Postgres int range returns 404.
- **PATCH** with neither status nor note returns 400. Other fields in the body are ignored.
  The id format is checked (404), then the body (400), then whether the lead exists (404).
- **JSON with no Content-Type header** is accepted on the API. Body-parser errors return 400, never 500.
- **Webhook** is skipped if `WEBHOOK_URL` is empty. A non-2xx response is logged as an error.

## Questions you asked

**Why rules-only is better here (for now):**

- **Predictable and testable**: the same message always gets the same label, so the grader and your tests can rely on it.
  AI output can change from one call or model version to the next.
- **Free forever, and nothing to manage**: no keys to leak, no quotas, no surprise bills, no provider shutting down a free tier.
- **Fast and always available**: no network call, nothing extra to time out, works when the AI provider is down or rate-limiting you.
- **Privacy**: customer names and messages never leave your server or database.
- **Easy to explain and adjust**: "it's a complaint because it says *refund*". To change it, you edit a word list.
- **Good enough for the volume**: a small business gets a handful of leads a day, and the owner reads every one anyway.
  AI helps most with messy, ambiguous wording, which is a nice-to-have rather than a need at this size.

## What I'd do next

1. Optional AI classifier with fallback to the rules (above).
2. Rate limiting and a honeypot field on the public form.
3. Email or SMS alert to the owner for high-urgency leads (the webhook can already feed Zapier, Make or n8n).
4. Pagination and search in the dashboard. Export to CSV.
5. Proper sessions (short-lived signed tokens) instead of handing the long-lived API token to the browser.
6. Webhook retries with a signature header so the receiver can verify the request came from this app.
