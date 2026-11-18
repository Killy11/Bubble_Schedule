# Backend

BubbleSchedule has no separate server process: the backend is **Firebase** (Auth, Firestore, Cloud Messaging) plus
**server code** that runs on Vercel. This workspace holds all of it: the API handlers, the AI layer, notifications and the
database configuration. It is built together with the Next.js app: `frontend/src/app/api/**/route.ts` are one-line
re-exports of the handlers here (Next.js requires route files inside the app, and route options such as `maxDuration` must
be literal in those files).

| What | Where |
|---|---|
| Firestore security rules | [`firestore.rules`](firestore.rules) |
| Firestore indexes | [`firestore.indexes.json`](firestore.indexes.json) |
| Firebase CLI config (repo root) | `../firebase.json` (points at the two files above) |
| API handlers | [`src/routes/`](src/routes) |
| Gemini client, prompts, schemas, validation | [`src/ai/`](src/ai) |
| Push, file parsing, rate limits, server re-planning, assistant memory | [`src/server/`](src/server) |
| Firebase Admin SDK, session helper | [`src/firebase/`](src/firebase) |
| Shared types and pure logic used on both sides (planner, time, types) | `../frontend/src/lib`, `../frontend/src/types` (imported with `@/`) |

Deploy rules and indexes: `npm run deploy:firebase` (from the repo root; needs `firebase login`).

## Auth

Firebase Authentication with **Google** and **Email/Password**. After sign-in the browser sends the ID token to
`POST /api/session`, which exchanges it for a **session cookie** (verified server-side by `src/proxy.ts` and by every API
route through `getSessionUid`). Some routes also accept an `Authorization: Bearer <ID token>`.

## Data model (Cloud Firestore)

```
users/{uid}                      profile, timezone, settings (working hours, language, quiet hours, notifications), fcmTokens,
 │                                userMemory[] (AI long-term memory, max 12 short items), chatDate (day of the current chat)
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

## API routes (handlers in `src/routes`, served at `/api/*`)

| Route | Purpose |
|---|---|
| `POST/DELETE /api/session` | create / clear the session cookie |
| `POST /api/chat/rollover` | daily chat reset: folds lasting preferences from the previous day's chat into `userMemory`, then clears the chat |
| `POST /api/assistant` | AI assistant: create/modify/answer, optional file attachments (multipart); sends only the last 16 messages + `userMemory` + the task list to the model |
| `POST /api/schedule` | Gemini-based schedule for a day (up to 90 days for undated tasks) |
| `POST /api/rebalance` | deterministic re-plan of all tasks (the planner in `src/lib/planner.ts`) |
| `POST /api/decompose` | split a big task into scheduled parts |
| `POST /api/estimate-task` | read an assignment file and estimate its duration (nothing is stored) |
| `POST /api/feedback` | save feedback (+ up to 3 photos), 5 per hour per user |
| `GET/POST /api/notifications/dispatch` | push dispatcher (start-in-5-min, 1-day-before-deadline); needs `CRON_SECRET` |
| `POST /api/notifications/action` | “Mark done” / “Snooze 15m” buttons of a notification (signed token) |
| `GET /api/cron/notifications` | alias of the dispatcher for older scheduler configs |

## AI

`src/ai/gemini.ts` wraps `@google/genai` with structured JSON output, model fallback and retries.
The deterministic planner (`../frontend/src/lib/planner.ts`, `../frontend/src/lib/rebalance.ts`) orders tasks red → yellow → green → no deadline
and runs in the browser and on the server, so scheduling works even when the AI is unavailable.
