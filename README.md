# ZIVA — Light up your screen

A responsive dark-themed cinema discovery website built with **HTML, CSS and vanilla JavaScript**. This is a clean-room recreation inspired by the reference website supplied by the project owner. It is not the original site's source code and is not affiliated with any streaming provider.

## Run locally

Use Node.js 22 or newer, install the dependencies, run the tests, and start the server:

```bash
npm install
npm test
npm start
```

Then visit `http://127.0.0.1:5500`. The Node server is required for authentication and the TMDB proxy; opening `index.html` directly provides only the static demo.

## Supabase authentication and catalogue setup

The website uses the existing Node.js server, Supabase helper, schema, and TMDB proxy.

Example server configuration:

```bash
PORT=5500
TMDB_API_READ_ACCESS_TOKEN=your-tmdb-read-token
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-supabase-publishable-key
SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key-only-on-server
APP_ORIGIN=https://your-ziva-domain.example
```

Keep these values in a local `.env` file and never expose them in browser code, app.js, index.html, or GitHub. The real `.env` file is not tracked and should not be overwritten.

`SUPABASE_URL` and either `SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY` are required for authentication. `APP_ORIGIN` should be set to the exact public origin in production; local development can derive its origin from the incoming request. `TMDB_API_READ_ACCESS_TOKEN` enables the live catalogue. `SUPABASE_SERVICE_ROLE_KEY` is optional and is not used by the current authentication flow; if configured for future trusted server-side work, keep it server-only.

The server-side auth layer uses the existing `lib/supabase.js` integration. Supabase access and refresh tokens remain in server-set `HttpOnly`, `SameSite=Lax` cookies; they are never returned to frontend JavaScript or put in local storage. Production cookies are `Secure`. Auth POST requests validate both same-origin requests and a CSRF token obtained from `GET /api/auth/session`.

The existing schema is defined in `supabase/migrations/001_initial_auth_schema.sql`. It creates:

- `public.profiles` for user profile data
- `public.roles` and `public.user_roles` for the admin RBAC model
- a `public.handle_new_user()` trigger that creates a profile and assigns the default `user` role when a Supabase Auth user signs up
- row-level security policies for user profile access and admin-only role management
- `public.is_user_admin()` for secure permission checks

Authentication uses Supabase email/password accounts, with email verification during registration. `POST /api/auth/register` creates the account and requests a signup verification code; `POST /api/auth/verify` verifies the single-use code and establishes the cookie session. `POST /api/auth/login` signs in with an email and password. Sign-in by one-time email code remains available through `POST /api/auth/login-code`, with `POST /api/auth/verify` completing it. Code expiry and rate limits are governed by Supabase Auth. `POST /api/auth/resend` requests another signup verification code. Other routes are:

- `POST /api/auth/verify`
- `GET /api/auth/session`
- `POST /api/auth/logout`
- `GET /api/admin/permissions`
- `GET /api/playback/authorize`

The frontend displays live TMDB metadata in this order: Trending Movies, New Releases, Popular Movies, Top Rated Movies, Action, Comedy, Horror, Romance, Adventure, Animation, Documentaries, other TMDB genres, then Trending Series. Sections have pagination, loading placeholders, and error/empty states. Search, detail metadata, shareable movie links, official trailer links, and TMDB regional watch-provider listings use TMDB endpoints. Duplicate titles are suppressed across sections where possible.

ZIVA does not currently have a licensed playback/download provider integration. Movie details show streaming availability from TMDB where provided, otherwise state that the title is unavailable in the selected region. The playback authorization endpoint fails closed rather than authorizing access based only on sign-in. There are no download endpoints or invented playback links. The existing watchlist remains in browser local storage and is not synchronized between devices.

The admin permission route verifies the authenticated user's confirmed-email session and calls `is_user_admin()` in that user's Supabase context on each request. Public registration cannot grant admin roles.

The admin dashboard checks `GET /api/auth/session` for authentication and then requires a successful `GET /api/admin/permissions` response before showing administrator access as granted. The session endpoint's `isAdmin` field is informational only and is not used to authorize admin access. A missing Supabase configuration or unavailable permission check is reported separately from an unauthenticated visitor or a denied ordinary-user account.

## Supabase Auth dashboard configuration

1. Apply `supabase/migrations/001_initial_auth_schema.sql` to the project.
2. In **Authentication → Providers → Email**, enable email/password sign-up and require email confirmation. Configure the confirmation email template to include `{{ .Token }}` so users receive the six-digit verification code used by the registration dialog. Email-code sign-in is optional.
3. Configure the OTP length to six digits to match the code-entry form, and choose a suitable expiry under the project's Auth security settings.
4. Configure SMTP/email delivery and Supabase Auth rate limits for production.
5. In **Authentication → URL Configuration**, set the Site URL and allowed redirect URLs for your local and deployed ZIVA origins. The current OTP endpoints do not depend on a browser redirect, but these settings should still match the hosted app.
6. Run the Node server with the Supabase URL and publishable/anon key configured. Keep `SUPABASE_SERVICE_ROLE_KEY` server-only; it is not required by the browser or normal OTP flow.

Real registration/login and email delivery require a reachable, correctly configured Supabase project. Automated tests use a local Supabase mock and do not verify dashboard settings or live email delivery.

## First administrator setup

Do not grant admin privileges from the browser or any public API route. Run the following SQL in the Supabase SQL editor or from a server-side database admin script after the user has signed up:

```sql
INSERT INTO public.user_roles (user_id, role_id)
SELECT p.id, r.id
FROM public.profiles p
JOIN public.roles r ON r.name = 'admin'
WHERE p.email = 'admin@example.com'
ON CONFLICT (user_id, role_id) DO NOTHING;
```

This assigns the first administrator role only from a trusted database-admin context. Public users cannot assign themselves administrator roles because the `user_roles` table is restricted to admin-only RLS policies.

## Features

- Responsive cinema-style landing page for desktop, tablet and mobile.
- TMDB movie and series cards with live genre, year, rating, and poster metadata.
- Live search, ordered genre sections, and per-section pagination.
- Movie details, shareable links, official trailers, and regional streaming availability.
- Personal watchlist saved in browser local storage.
- Keyboard support, semantic controls and reduced-motion preference.
- No framework or frontend build step.

## Project structure

```text
ZIVA/
├── README.md
├── index.html
├── styles.css
├── app.js
├── package.json
├── package-lock.json
├── server.js
├── api/
│   └── tmdb.js
├── admin/
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── lib/
├── src/
├── supabase/
│   └── migrations/
└── tests/
```

## Hosting

The authentication routes run in `server.js`, so a static-only deployment (including GitHub Pages or a static Vercel site) cannot provide working authentication. Host the Node server and serve the frontend and `/api/*` from the same origin, or configure a same-origin reverse proxy to the Node server. Do not expose environment files or server-side source through a static host.

## Connect real catalogue data

TMDB is used only for legitimate metadata, posters, trailers, and regional watch-provider listings, and requires a server-side read token. ZIVA does not download full movies from TMDB, scrape unauthorized movie sites, bypass provider protections, or invent playback URLs. Actual playback/download access requires a licensed provider integration with server-side entitlement checks.

## Customize

- Configure TMDB and update the sections in `src/catalogue-sections.js`.
- Change design tokens at the top of `styles.css`.
- Update hero copy, navigation and page sections in `index.html`.

## License

No license is specified. Add a license before redistributing this project for reuse.
