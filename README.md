# Daily Grind App

Vue 3 + TypeScript + Firebase starter for Daily Grind.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Fill Firebase keys in `.env.local`:

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_VAPID_KEY=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_MEASUREMENT_ID=
```

5. Update [app/public/firebase-messaging-sw.js](public/firebase-messaging-sw.js) with your Firebase app values.

3. Run locally:

```bash
npm run dev
```

## Firebase Hosting

1. Set your Firebase project ID in `.firebaserc`:

```json
{
	"projects": {
		"default": "your-firebase-project-id"
	}
}
```

2. Deploy hosting:

```bash
npm run hosting:deploy
```

3. Deploy preview channel:

```bash
npm run hosting:preview
```

4. Run local hosting emulator:

```bash
npm run hosting:emulate
```

## GitHub Actions Hosting CI

This project includes workflows in [app/.github/workflows](app/.github/workflows):

- [app/.github/workflows/firebase-hosting-merge.yml](app/.github/workflows/firebase-hosting-merge.yml): deploys to live Hosting on push to `main`
- [app/.github/workflows/firebase-hosting-pr.yml](app/.github/workflows/firebase-hosting-pr.yml): creates Hosting preview on pull requests

Required repository secrets:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_SERVICE_ACCOUNT`

Create the service account JSON from Firebase project settings and store it as the `FIREBASE_SERVICE_ACCOUNT` secret.

Useful deploy scripts:

- `npm run hosting:deploy`
- `npm run firestore:deploy`
- `npm run firebase:deploy`

## Current Implementation

- First-run onboarding route with:
- Join a Team
- Create a Team
- Join route with camera-first QR flow + fallback invite code/link parsing
- Join route with live QR decoding via camera stream
- Create route with email sign-up and team/points unit inputs
- Team route with Firebase-backed features:
	- Lists create/archive + selection
	- List rename and delete (admin)
	- Personal/Shared task creation
	- Board columns (`todo`, `in_progress`, `done`) with status transitions
	- Task edit including assignee and recurring rule
	- Reward points when moving task into `done`
	- Team invite creation with required intended member name
	- Team member role management (`admin`/`member`) and removal (admin)
	- Self deduction and admin point adjustment with required notes
	- Ledger stream of point changes
- PWA service worker + installable web app manifest
- Firestore persistent offline cache (single-tab manager)
- Firebase bootstrap from Vite environment variables

## Next Steps

- Add Firestore security rules and indexes for production hardening
- Add notification preference controls (per-user, per-team)
- Add stronger server-authoritative rules via callable functions for points mutations

## Cloud Functions

Functions scaffold is in [app/functions](functions):

- `sendTestPush` callable function to validate push delivery
- `notifyCooldownDue` scheduled job (every 15 minutes) for due task reminders
	- includes due-task reminders, cooldown-approaching reminders, and cooldown-ended reminders

Setup:

1. Install functions dependencies:

```bash
cd functions
npm install
npm run build
```

2. Deploy all Firebase resources (hosting + firestore + functions):

```bash
cd ..
npm run firebase:deploy
```
