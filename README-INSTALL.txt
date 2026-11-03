ZIVA STAGE 2A — TMDB CATALOGUE BACKEND KIT

This kit adds a secure server-side TMDB proxy and optional live catalogue while preserving ZIVA demo movies.

INSTALL
1. Download and extract the ZIP.
2. Copy ALL contents inside the ziva-stage2-kit folder into your existing project folder:
   C:\Users\ONWARDS\ZIVA
   Make sure hidden files such as .env.example and .gitignore are included. Merge folders when asked. Do not delete existing project files.
3. Open Git Bash and run:
   cd ~/ZIVA
   node setup-stage2.js

CHECK
Run these commands:
   node --check app.js
   node --check server.js
   node --check api/tmdb.js
   node --check api/status.js
   node --check lib/tmdb.js
   node --check src/catalogue.js
   npm test

START LOCAL SITE
   npm start
Then open http://127.0.0.1:5500

DEMO MODE
ZIVA works with the built-in sample titles when no TMDB token is set. The local status endpoint should report:
   {"mode":"demo","tmdbConfigured":false}

ENABLE LIVE TMDB DATA
1. Create a TMDB account and request an API Read Access Token from TMDB account settings.
2. Copy .env.example to .env in the ZIVA project root.
3. Put your token after TMDB_API_READ_ACCESS_TOKEN= in .env.
4. Restart npm start.
5. Never paste your token into chat, app.js, index.html, or GitHub. The .env file is ignored by Git.

The backend uses Node.js built-in modules only; no npm install is needed. Requires Node.js 20+.

VERCEL
Vercel can run api/tmdb.js and api/status.js as serverless functions. Set TMDB_API_READ_ACCESS_TOKEN in Vercel Project Settings > Environment Variables. The local server.js is for local development; Vercel uses the /api functions.

ATTRIBUTION
TMDB requires attribution when its API data/images are used. ZIVA adds the required notice, but before public release add an approved TMDB logo in an About/Credits area, following TMDB's current attribution guidelines. Required notice: “This product uses the TMDB API but is not endorsed or certified by TMDB.”

REVIEW BEFORE COMMITTING
After setup, inspect changes with:
   git status --short
   git diff --check
   git diff --stat
Do not commit until the local checks pass.
