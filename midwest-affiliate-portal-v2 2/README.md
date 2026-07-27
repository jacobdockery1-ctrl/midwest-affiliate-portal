# MidWest Tees — Affiliate Portal (v2)

A full affiliate program in one small app:

- **Affiliate portal** (`/?token=…`) — each affiliate sees their live earnings + link and asks an **AI helper** anything, in plain English. The helper is **locked to affiliate topics** — ask about the weather and it politely refuses.
- **Owner dashboard** (`/admin`) — you + your mom see every affiliate, total owed, **mark-as-paid** (records the payout so nothing is paid twice), and **add new affiliates** with an auto-generated link, private portal token, and ready-to-send welcome message.
- **Live commissions** from Shopify (`utm_source` → paid orders → 10%).
- **Real database** (Supabase) for the roster + payout ledger.

## Architecture

```
Affiliate ──/?token──▶ portal (index.html) ──▶ /api/me, /api/ask
Owner ─────/admin─────▶ dashboard (admin.html) ──▶ /api/admin/*

server.js
 ├─ lib/shopify.js  client-credentials auth + utm_source attribution (60s cache)
 ├─ lib/db.js       Supabase: affiliates, payouts, chat logs
 └─ lib/ai.js       scoped Claude helper (system-prompt guardrail + conversation memory)
```

**Money math:** `earned = Shopify sales × rate`, `owed = earned − Σ payouts`. Marking paid inserts a payout row, so the owed amount drops and can't be double-paid.

## Setup

### 1. Database (Supabase)
Run `supabase/migration.sql` once in your project (SQL editor). It creates `mw_affiliates`, `mw_payouts`, `mw_chat_logs` with RLS on (the server uses the service-role key and bypasses RLS; the public anon key sees nothing).

### 2. Deploy (Railway)
Push to GitHub, create a Railway project from the repo, set the variables from `.env.example`:
- Shopify: `SHOP`, `CLIENT_ID`, `CLIENT_SECRET`
- Claude: `ANTHROPIC_API_KEY`
- Supabase: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- App: `ADMIN_PASSWORD`

Railway runs `npm start`. Keep `public/` lowercase (Linux is case-sensitive).

### 3. Use it
- Open `https://YOUR-APP.up.railway.app/admin`, enter your password.
- Add an affiliate → copy their welcome message (includes their private portal link) → send it.
- They open their link, see their earnings, and ask the helper anything.
- When you owe someone, hit **Pay** — it records the payout and opens Venmo pre-filled.

## Local dev
```bash
npm install
cp .env.example .env   # fill in
npm start
# affiliate: http://localhost:3000/?token=<token from your DB>
# admin:     http://localhost:3000/admin
```
Both pages have a **demo mode** if opened with no backend/token, so you can preview the UI (and see the AI guardrail behavior) before deploying.

## The AI guardrail
`lib/ai.js` feeds Claude a system prompt containing only that affiliate's numbers + the program rules, with strict instructions that it's an affiliate helper *only*: no general questions, code, essays, advice, or roleplay — off-topic gets a one-line redirect. It also refuses to reveal its instructions or other affiliates' data.

## Nice next steps
- Auto-email the welcome message (SendGrid/Resend) instead of copy-paste.
- Affiliate "request payout" button that pings you.
- Leaderboard / tiers, date-range reports, CSV export.
