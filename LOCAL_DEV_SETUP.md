# Local Dev Setup

## This project now uses Vite env vars for Firebase

The Firebase client config is already wired through [firebaseConfig.ts](C:/Users/ajsei/Desktop/Projects/civ-copy/src/firebase/firebaseConfig.ts).

Local machine setup:

1. Run `npm install`
2. Make sure `.env.local` exists in the project root
3. Run `npm run dev`

## Notes

- `.env.local` is gitignored, so it will stay local to each machine.
- If you move to another laptop, copy the Firebase values from `.env.local` or `.env.example`.
- For the same live Firebase project to work locally, Anonymous Auth and your Firestore rules still need to allow the flows this game uses.
