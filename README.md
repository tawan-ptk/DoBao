# DoBao

DoBao is a Thai-language web app for people living with, or at risk of, type 2 diabetes. It keeps a daily record of meals, activity, medication and health measurements, builds a simple weekly routine, and includes Baobuddy, an assistant that answers questions about the user's own records and about general health.

This repository contains the web client and the serverless API that sits in front of it. Record storage, parsing, scheduling and the language model integration live in the companion service, [AIDoBao](https://github.com/tawan-ptk/AIDoBao).

Live deployment: <https://dobaohealth.vercel.app>

## Features

- **Daily log.** Meals, activity, medication, sleep and measurements (glucose, weight, blood pressure). Entries can be typed as free text, such as "lunch was chicken rice, walked 20 minutes in the evening", and are split into separate records for review. Nothing is saved until the user confirms the draft.
- **Fast manual entry.** Structured forms that save directly, without a model call.
- **History by day.** Any past day can be opened, edited as a new version, or deleted.
- **Weekly routine.** A seven-day plan built from activities the user picks. Medication and appointment times are fixed and never moved automatically.
- **Baobuddy chat.** Summaries of the user's own records, meal suggestions filtered by allergies and conditions, and health answers grounded in curated sources or a search limited to trusted health sites. Every answer lists its sources.
- **Shareable summaries.** A one-day or multi-day summary is drawn to a canvas in the browser and shared through the system share sheet. No image is uploaded.
- **Consent first.** Storing health data and using the assistant are separate permissions. Both can be withdrawn at any time.

## Architecture

```text
Browser ── Supabase Auth (Google OAuth, PKCE) ──▶ access token
   │
   ▼
/api  (Vercel Node function)
   ├─ verifies the token with Supabase Auth on every request
   ├─ enforces consent, same-origin checks and per-user rate limits
   ├─ Supabase Postgres (RLS): accounts, consent history, daily goals,
   │                           read-only projection of health records
   └─ AIDoBao service: source of truth for health records, drafts,
                       plans and the assistant
```

The browser never talks to AIDoBao directly. The API attaches a server-side credential and a stable per-user identifier, so the client cannot read or write records that belong to another account. After each confirmed change the API copies a read-only projection of the user's records into Supabase, which keeps the dashboard fast.

## Tech stack

| Layer | Choice |
| --- | --- |
| Client | Plain HTML, CSS and JavaScript, bundled with esbuild |
| Hosting | Vercel (static files and a Node 22 function, region `sin1`) |
| Auth | Supabase Auth with Google as the only provider |
| Database | Supabase Postgres with row-level security |
| Tests | Node's built-in test runner with jsdom |

There is no front-end framework. The UI is a single page with bottom-sheet dialogs on phones and modal dialogs on desktop.

## Getting started

Requirements: Node.js 22 and a Supabase project with the Google provider turned on.

```sh
npm ci
cp .env.example .env.local   # fill in the values; never commit this file
npm run dev                  # http://localhost:3000
```

Database migrations are in `supabase/migrations/` and should be applied in order. The setup guides in `docs/` (written in Thai) cover the Google Cloud client, Supabase URL configuration and the Vercel environment.

```sh
npm test               # unit and UI tests
npm run check          # syntax check, tests and production build
npm run setup:check    # verifies configuration without printing secrets
```

`npm run build` copies only an explicit allow-list of public files into `dist/`. The build fails if anything else appears there.

## Project layout

| Path | Purpose |
| --- | --- |
| `index.html`, `style.css` | Markup and styles for every screen |
| `script.js`, `client-data.js` | UI state, drafts, history, chat, charts and share images |
| `auth-client.js` | Google sign-in, session persistence and token refresh |
| `boot.js` | Shows a launch screen before first paint while a saved session resumes |
| `api/index.js` | The single API entry point: auth, consent, routing and projection sync |
| `server/` | Supabase auth helpers, security checks, AI client and privacy notice |
| `supabase/migrations/` | Tables, RLS policies and RPC functions |
| `tests/` | Node test suites for the API and the UI |
| `docs/` | Deployment, login and support guides |

## Security and privacy

- Secrets live only in `.env.local` and the Vercel environment. They are never bundled or committed.
- The API accepts requests only from the configured origin and responds with `Cache-Control: no-store, private`.
- Writes require an explicit confirmation step, and confirmations are idempotent.
- Chat history is stored on the device, scoped to the signed-in account, and cleared on sign-out.
- Questions sent to the language model carry no account details or stored records.

## Status

DoBao is a student project and has not been clinically validated. It does not diagnose conditions or change medication, and its answers should not replace advice from a care team.
