# Backend

BubbleSchedule has no separate server process: the backend is **Firebase** (Auth, Firestore, Cloud Messaging) plus
**server route handlers** that run on Vercel. This folder holds the database configuration; the route handlers live next
to the pages because Next.js requires it (`src/app/api`, helpers in `src/lib/server`).

| What | Where |
|---|---|
| Firestore security rules | [`firestore.rules`](firestore.rules) |
| Firestore indexes | [`firestore.indexes.json`](firestore.indexes.json) |
| Firebase CLI config (repo root) | `../firebase.json` (points at the two files above) |
| API route handlers | `../src/app/api/**` |
| Server-only libraries (admin SDK, push, planner, rate limits) | `../src/lib/server`, `../src/lib/firebase/admin.ts` |

Deploy rules and indexes: `npm run deploy:firebase` (from the repo root; needs `firebase login`).

## Auth

Firebase Authentication with **Google** and **Email/Password**. After sign-in the browser sends the ID token to
`POST /api/session`, which exchanges it for a **session cookie** (verified server-side by `src/proxy.ts` and by every API
route through `getSessionUid`). Some routes also accept an `Authorization: Bearer <ID token>`.

## Data model (Cloud Firestore)

```
users/{uid}                      profile, timezone, settings (working hours, language, quiet hours, notifications), fcmTokens
 ├─ tasks/{taskId}               title, deadline?, durationMin?, loggedMinutes, pacing (chill|balanced|locked),
 │                               status (active|completed), subtasks[], recurrence?, startedAt?, accumulatedSeconds?, flags
 ├─ schedules/{dateKey}          planned blocks (the plan is stored under the day it was made and holds several days)
 ├─ messages/{messageId}         AI chat history
 ├─ history/{taskId}             finished tasks with actual duration (used to suggest durations)
 └─ devices/{deviceId}           push token + user agent per browser/device
feedback/{id}                    user feedback (written by the API with the Admin SDK); feedback/{id}/attachments/{n} photos
rateLimits/{key}                 server-only counters (feedback, file analysis)
```

Security rules (`firestore.rules`): a user can read and write only their own `users/{uid}` tree; `feedback` can be created by
a signed-in user for themselves and never read from the client; `reminders` and `rateLimits` are server-only.

## API routes (`src/app/api`)

| Route | Purpose |
|---|---|
| `POST/DELETE /api/session` | create / clear the session cookie |
| `POST /api/assistant` | AI assistant: create/modify/answer, optional file attachments (multipart) |
| `POST /api/schedule` | Gemini-based schedule for a day (up to 90 days for undated tasks) |
| `POST /api/rebalance` | deterministic re-plan of all tasks (the planner in `src/lib/planner.ts`) |
| `POST /api/decompose` | split a big task into scheduled parts |
| `POST /api/estimate-task` | read an assignment file and estimate its duration (nothing is stored) |
| `POST /api/feedback` | save feedback (+ up to 3 photos), 5 per hour per user |
| `GET/POST /api/notifications/dispatch` | push dispatcher (start-in-5-min, 1-day-before-deadline); needs `CRON_SECRET` |
| `POST /api/notifications/action` | “Mark done” / “Snooze 15m” buttons of a notification (signed token) |
| `GET /api/cron/notifications` | alias of the dispatcher for older scheduler configs |

## AI

`src/lib/ai/gemini.ts` wraps `@google/genai` with structured JSON output, model fallback and retries.
The deterministic planner (`src/lib/planner.ts`, `src/lib/rebalance.ts`) orders tasks red → yellow → green → no deadline
and runs in the browser and on the server, so scheduling works even when the AI is unavailable.
