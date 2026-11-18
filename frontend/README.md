# Frontend

The web app is a **Next.js 16 (App Router) + React 19 + TypeScript** project styled with **Tailwind CSS 4**.
Its source sits at the **repository root** (`src/`, `public/`) so that Vercel can build the project without changing the
project's Root Directory; this folder documents it.

## Where things are

| Path (from repo root) | Contents |
|---|---|
| `src/app/` | Routes: `/` (redirect), `/login`, `/dashboard`, PWA `manifest.ts`, global CSS |
| `src/components/` | UI: `bubbles/` (canvas, bubble, task window, create form), `schedule/`, `chat/`, `profile/`, `dashboard/` (shell, header), the interactive tutorial, celebration, support dialogs |
| `src/context/` | Providers: auth, language (EN/UK), theme, toasts, notifications, support |
| `src/hooks/` | Data and behaviour: tasks (Firestore), chat, schedule, re-planning, timers, voice dictation, local reminders |
| `src/lib/` | Pure logic: bubble sizing/layout, planner, urgency colours, time model, i18n dictionary (`i18n/uk.ts`), Firebase client |
| `src/types/` | Shared TypeScript types (`Task`, `Schedule`, API payloads) |
| `src/proxy.ts` | Route protection (valid session cookie required for `/dashboard`) |
| `public/` | Icons, `sw.js` (offline/PWA), `firebase-messaging-sw.js` (push) |

## Notes

- All UI strings are English in code and translated at render time through `t("English text")`; Ukrainian lives in `src/lib/i18n/uk.ts`.
- The dashboard state comes from Firestore listeners (`useTasks`, `useSchedule`); the planner re-runs automatically when tasks change.
- The app shell is locked to the viewport (no page scroll or zoom); panels scroll internally.
- Run it with `npm run dev`; configuration is described in the root `README.md` and `infra/README.md`.
