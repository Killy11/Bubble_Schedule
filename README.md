# BubbleSchedule

**Visual time management: your tasks as glowing bubbles, planned for you by AI.**

BubbleSchedule turns a to-do list into a canvas of bubbles. Each task is a bubble: the **longer** the task, the **bigger**
the bubble, and its **colour follows the deadline** (red under a day, yellow 1–5 days, green later or no deadline). An AI
assistant plans your day from plain text or your voice, a focus timer tracks the time you really spend, and push
notifications remind you when things start.

It is built for students and busy people who want to *see* their workload at a glance and have a calendar that arranges
itself, in **English and Ukrainian**.

## Live demo

**<https://bubbleschedule.vercel.app>**

1. Open the link and choose **Continue with Google**, or type an email and a password (≥ 6 characters) and tap **Create account**.
2. A short interactive tutorial starts for new accounts (replay it any time with the **?** button in the header).
3. Tap the central **+** bubble to create your first task.

## Features

- **Bubble canvas**: size = duration, colour = deadline urgency; a permanent central **+** bubble creates tasks.
- **Task window**: live timer (`MM:SS`) with “log minutes” (rounded down to whole minutes), manual time logging
  (−15 / +15), automatic completion with confetti and sound when the planned time is used up, Undo for completions.
- **AI assistant** (Google Gemini): create, change, complete and delete tasks by typing or **voice dictation** (UK / EN);
  attach PDFs, images, DOCX, TXT/MD/CSV/JSON files and let it read them; estimate how long an assignment will take.
- **Automatic schedule**: a deterministic planner arranges tasks by urgency (red → yellow → green → no deadline) inside
  your working hours, with Locked In / Normal / Chill focus modes, breaks, daily load limits and multi-day spreading.
- **Overdue / Completed** lists, recurring tasks, quiet hours, feedback form, bilingual UI, light and dark themes.
- **Notifications**: web push 5 minutes before a task starts and 1 day before a deadline, plus a timer-finished alert.
- **PWA**: installable, works with the mobile app shell locked to the screen.

## Repository structure

```
.
├── frontend/   Web app overview. The Next.js source itself lives in src/ + public/ at the repo root (see below)
├── backend/    Firestore security rules and indexes, data model and server API documentation
├── infra/      Environment template (.env.example), deployment guide and architecture diagram
├── src/        Next.js application code: UI (components, hooks, context) AND server routes (src/app/api, src/lib/server)
├── public/     Static assets, PWA icons, service workers (sw.js, firebase-messaging-sw.js)
├── vercel.json firebase.json package.json next.config.ts tsconfig.json eslint.config.mjs
└── README.md
```

> **Why `src/` is at the root and not inside `frontend/`:** Vercel builds the repository root, and the Next.js API routes
> (`src/app/api`) must live in the same project as the pages. Moving the app into a sub-folder would require changing the
> Vercel project's *Root Directory* setting; the live deployment keeps working as it is. Each of `frontend/`, `backend/`
> and `infra/` has its own README that maps the relevant files.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind CSS 4, framer-motion, lucide-react, canvas-confetti |
| Backend | Next.js route handlers (Node.js runtime) with the Firebase Admin SDK |
| Database & auth | Firebase Authentication (Google + email/password), Cloud Firestore |
| Push | Firebase Cloud Messaging (Web Push) with a service worker |
| AI | Google Gemini via `@google/genai` (assistant, task decomposition, file analysis), `mammoth` for DOCX text |
| Hosting | Vercel (app and API), Firebase (rules, auth, FCM) |

## Local setup

**Prerequisites**

- Node.js **22 or newer** and npm
- A Firebase project (the free *Spark* plan is enough): Authentication (Google and Email/Password enabled), Firestore, Cloud Messaging
- A Gemini API key from <https://aistudio.google.com/apikey>
- Optional: the Firebase CLI (`npm i -g firebase-tools`) to deploy the Firestore rules

**Steps**

```bash
git clone https://github.com/Killy11/Bubble_Schedule.git
cd Bubble_Schedule
npm install

cp infra/.env.example .env.local     # then fill in the values (see below)
npm run dev                          # http://localhost:3000
```

**Environment variables** (all documented in [`infra/.env.example`](infra/.env.example)):

| Variable | Where to get it |
|---|---|
| `NEXT_PUBLIC_FIREBASE_*` (API key, auth domain, project id, storage bucket, sender id, app id) | Firebase console → Project settings → Your apps (Web) |
| `NEXT_PUBLIC_FIREBASE_VAPID_KEY` | Project settings → Cloud Messaging → Web configuration → Web Push certificates |
| `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY` | Project settings → Service accounts → Generate new private key (keep the `\n` sequences and quotes) |
| `GEMINI_API_KEY` (+ optional `GEMINI_API_MODEL`) | Google AI Studio |
| `CRON_SECRET` | any long random string (`openssl rand -hex 32`); protects the notification dispatcher |
| `NOTIFICATION_ACTION_SECRET` | optional; signs the “Mark done / Snooze” notification buttons (defaults to `CRON_SECRET`) |

Also add `localhost` to Firebase Authentication → Settings → Authorised domains (it is there by default), and deploy the
Firestore rules once (see Deployment). Without a `GEMINI_API_KEY` the app still runs; AI features report that they are not configured.

**Useful commands**

```bash
npm run dev       # development server
npm run build     # production build (also type-checks)
npm run start     # run the production build
npm run lint      # ESLint
```

## Deployment

The app is deployed to **Vercel** and the data rules to **Firebase**. Full details are in [`infra/README.md`](infra/README.md).

1. **Firebase**: create the project, enable Google + Email/Password sign-in, create the Firestore database, then deploy rules and indexes:
   `firebase login && npm run deploy:firebase` (uses `firebase.json`, which points at `backend/firestore.rules` and `backend/firestore.indexes.json`).
2. **Vercel**: import the GitHub repository (framework: Next.js, root directory: repository root, Node 22). Add every variable from `infra/.env.example` under *Settings → Environment Variables*, then deploy. Every push to `main` deploys automatically.
3. **Auth domain**: add your Vercel domain (e.g. `bubbleschedule.vercel.app`) to Firebase Authentication → Settings → Authorised domains.
4. **Reminders (cron)**: point a scheduler (for example cron-job.org, every 1–2 minutes) at `GET https://<your-domain>/api/notifications/dispatch` with the header `Authorization: Bearer <CRON_SECRET>`. Vercel's free plan only allows daily cron jobs, so an external scheduler is used.

## Further reading

- [`frontend/README.md`](frontend/README.md): UI architecture and where things are
- [`backend/README.md`](backend/README.md): data model, security rules, API routes, planner
- [`infra/README.md`](infra/README.md): environment, deployment, architecture diagram
