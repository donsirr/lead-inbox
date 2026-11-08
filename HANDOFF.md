# Lead Inbox: Handoff

A small lead inbox. Customers send a request at `/` and the owner manages leads at `/dashboard`.
Node.js, Express and PostgreSQL. No build step, no paid services, no AI. Full setup details are in [README.md](README.md).

## How to run it

**Live:** <https://lead-inbox-pied.vercel.app> (form) and <https://lead-inbox-pied.vercel.app/dashboard> (owner dashboard).
Hosted on Vercel with a Neon Postgres database, both on free plans.

**Locally** (needs Node 20.6+ and a Postgres database, such as a free Neon one):

```bash
npm install
cp .env.example .env     # fill in DATABASE_URL, API_TOKEN, OWNER_USER, OWNER_PASS, WEBHOOK_URL
npm run dev              # http://localhost:3000
npm run test:local       # in a second terminal: runs the API tests
```

The `leads` table is created automatically.

## Owner login

- Username: `admin`
- Password: `admin`

## API_TOKEN

```
14cc8235204d9076022b29ebca5c24967b85012cc410540b3f599657cb9dacfe
```

Send it as `Authorization: Bearer <API_TOKEN>`. It's needed for everything except `POST /api/leads` and
`POST /api/login`. Logging in to the dashboard also returns it.

## What works

- Public form that saves leads, with clear error messages for bad input (never a server error).
- Each new lead is sorted by category and urgency using keyword rules.
- Dashboard: log in, see counts by status, filter by status and category, change status, add notes.
  Works on phone and desktop.
- API: create, list (newest first, with filters), view and update leads. Protected by the token.
- A `lead.created` webhook is sent for each new lead. If it fails, the lead is still saved.
- 181 automated API tests, all passing.

## What doesn't work (yet)

- No spam protection or rate limiting on the public form.
- No pagination: the list shows the newest 500 leads.
- Only one owner account, and the login password is weak (`admin`). Change it before real use.
- The "session" is just the API token stored in the browser tab. It isn't a proper session system.
- The pages were tested in a headless browser, not clicked through by hand on a real phone.

## What I assumed where the brief was unclear

- **The example lead didn't match the rules.** "Can you come Tuesday?" is labelled `booking`, but it has no
  booking keyword. It does contain "can you" and "?", so by the rules it's a **question**. I followed the rules.
- **Keywords** match at the start of a word, ignoring case. "book" matches "booking" but not "facebook".
- **Urgency:** a high keyword or a complaint gives high, otherwise a low keyword gives low, otherwise normal.
- **"Required"** means not empty and not just spaces. Text is saved exactly as typed.
- **`service`** is required. **`phone`** is optional.
- I added length limits the brief didn't mention: email 254, phone 50, note 5000 characters.
- Unknown filter values return an empty list instead of an error.
- Postgres is used for storage because free hosts don't keep files between deploys.
- No AI for sorting, as the brief required. Rules are also predictable, free and easy to adjust.

## What I'd do next

1. Spam protection on the form (rate limiting and a hidden honeypot field).
2. Email or SMS alerts to the owner for urgent leads.
3. Pagination, search and CSV export in the dashboard.
4. Proper login sessions instead of giving the browser the long-lived API token.
5. Webhook retries and a signature so the receiver can check the request is genuine.
6. Optional AI sorting that falls back to the rules if it fails.
