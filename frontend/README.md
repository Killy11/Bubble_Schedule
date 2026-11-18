# Frontend

The web app: **Next.js 16 (App Router) + React 19 + TypeScript**, styled with **Tailwind CSS 4**. It is also the Next.js host of
the API: the route files in `src/app/api` re-export the handlers from `../backend/src/routes`.

## Where things are

| Path | Contents |
|---|---|
| `src/app/` | Routes: `/` (redirect), `/login`, `/dashboard`, PWA `manifest.ts`, global CSS, and the thin `api/**/route.ts` files |
| `src/components/` | UI: `bubbles/` (canvas, bubble, task window, create form), `schedule/`, `chat/`, `profile/`, `dashboard/` (shell, header), the interactive tutorial, celebration, share and support dialogs |
| `src/context/` | Providers: auth, language (EN/UK), theme, toasts, notifications, support |
| `src/hooks/` | Data and behaviour: tasks (Firestore), chat, schedule, re-planning, timers, voice dictation, local reminders, task music |
| `src/lib/` | Pure logic shared with the backend: bubble sizing/layout, planner, urgency colours, time model, i18n dictionary (`i18n/uk.ts`), Firebase client |
| `src/types/` | Shared TypeScript types (`Task`, `Schedule`, API payloads) |
| `src/proxy.ts` | Route protection (valid session cookie required for `/dashboard`) |
| `public/` | Icons, `sw.js` (offline/PWA), `firebase-messaging-sw.js` (push), `audio/` (task music) |
| `assets/` | Design source files (logo) |

## Configuration

- `next.config.ts` sets the build root to the repository root so the backend code is compiled and traced into the serverless functions.
- `tsconfig.json` defines `@/*` → `src/*` and `@backend/*` → `../backend/src/*`, and type-checks both workspaces.
- Environment variables go in `frontend/.env.local` (copy `../infra/.env.example`).

## Notes

- All UI strings are English in code and translated at render time through `t("English text")`; Ukrainian lives in `src/lib/i18n/uk.ts`.
- Dashboard state comes from Firestore listeners (`useTasks`, `useSchedule`); the planner re-runs when tasks change.
- The app shell is locked to the viewport (no page scroll or zoom); panels scroll internally.
- `npm run dev` / `npm run build` from the repository root run this workspace.
