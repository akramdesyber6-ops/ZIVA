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

The server-side auth layer uses the existing `lib/supabase.js` integration. Supabase access and refresh tokens remain in server-set `HttpOnly` cookies; they are never returned to frontend JavaScript or put in local storage. Web-only deployments use `SameSite=Lax`; configuring `MOBILE_APP_ORIGINS` enables `SameSite=None; Secure` cookies for cross-origin WebView requests (and currently applies that cookie policy across the deployment). Production cookies are `Secure`. Auth POST requests validate both the trusted Origin and a CSRF token obtained from `GET /api/auth/session`.

The existing schema is defined in `supabase/migrations/001_initial_auth_schema.sql`. It creates:

- `public.profiles` for user profile data
- `public.roles` and `public.user_roles` for the admin RBAC model
- a `public.handle_new_user()` trigger that creates a profile and assigns the default `user` role when a Supabase Auth user signs up
- row-level security policies for user profile access and admin-only role management
- `public.is_user_admin()` for secure permission checks

## Production API and session configuration

The application reads these environment variable names; keep values in the server environment and do not commit them:

- `PORT` — Node server port.
- `APP_ORIGIN` — exact trusted production web origin, including scheme and port if non-default.
- `MOBILE_APP_ORIGINS` — comma-separated Capacitor WebView origins explicitly allowed for credentialed CORS and CSRF.
- `ZIVA_API_BASE_URL` — deployed HTTPS API origin used only when preparing the native web bundle; it must not include a path, query, or fragment.
- `SUPABASE_URL` and `SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY` — server-side Supabase Auth configuration.
- `SUPABASE_SERVICE_ROLE_KEY` — server-only and not required by the normal authentication flow; never include it in web or native assets.
- `TMDB_API_READ_ACCESS_TOKEN` — server-side metadata proxy credential.

Use the real, operator-configured service origin; the repository intentionally does not choose a production hostname. Production must set `APP_ORIGIN` and `ZIVA_API_BASE_URL` explicitly, and `ZIVA_API_BASE_URL` must be HTTPS. `MOBILE_APP_ORIGINS` is an explicit allowlist, not a wildcard. Keep it limited to the exact origins from the packaged Capacitor app. The API client applies a 15-second timeout to `/api/*` requests and reports network failures without exposing credentials. Offline state does not erase the HttpOnly cookies; retry session restoration after connectivity returns.

The browser session uses server-set HttpOnly access and refresh cookies. Authenticated requests are verified with Supabase Auth; a missing or expired access cookie can be renewed using the refresh cookie. Temporary Auth/network failures return an unavailable response instead of clearing a session as if it were expired. Mutating requests additionally require a matching CSRF cookie/header and a trusted Origin. Supabase's refresh-token reuse interval defaults to 10 seconds, and Supabase does not recommend changing it. The interval allows legitimate retries during token rotation; Supabase also permits reuse of the active token's parent to account for unreliable networks. Multi-instance deployments should handle concurrent refreshes safely in the application/runtime rather than relying on a longer reuse interval.

Native WebViews send credentialed cross-origin requests to `ZIVA_API_BASE_URL`, so configure `MOBILE_APP_ORIGINS` and HTTPS on the API. This uses the same server cookies and Supabase account as the web app, not a second native auth store. Cookie persistence and third-party-cookie behavior differ between Android System WebView and iOS WKWebView and cannot be established by the repository's mock tests. Verify initial login, relaunch, token renewal, logout, offline/reconnection, and protected-page restoration on physical devices before release. Never move access or refresh tokens into URLs, logs, local storage, or the packaged web bundle.

Authentication uses Supabase email/password accounts, with email verification during registration. `POST /api/auth/register` creates the account and requests a signup verification code; `POST /api/auth/verify` verifies the single-use code and establishes the cookie session. `POST /api/auth/login` signs in with an email and password. Sign-in by one-time email code remains available through `POST /api/auth/login-code`, with `POST /api/auth/verify` completing it. Code expiry and rate limits are governed by Supabase Auth. `POST /api/auth/resend` requests another signup verification code. Other routes are:

- `POST /api/auth/verify`
- `GET /api/auth/session`
- `POST /api/auth/logout`
- `GET /api/admin/permissions`
- `GET /api/admin/users`, `/api/admin/catalog`, `/api/admin/video-sources`, `/api/admin/subscriptions`, `/api/admin/payments`; writes are administrator-gated and CSRF-protected
- `GET /api/anime` for validated AniList metadata
- `GET|POST /api/library`, `POST /api/watch-history`, and `GET|POST /api/profile`
- `GET /api/billing` for the authenticated user's subscription and payment history
- `GET /api/playback/authorize`

The home catalogue starts with trending movies and series, followed by top-rated movies and series, now-playing movies, and on-the-air series. Later rows load progressively as they approach the viewport. The dedicated `/movies` and `/series` pages retain genre filtering, search, pagination, loading placeholders, and error/empty states. Search requests are cancelable; browser metadata is briefly cached and server metadata uses a bounded TTL/stale cache with request coalescing. Catalogue metadata is refreshed when the page returns to focus and on a 60-second interval. Movie and series details, shareable links, official trailers, and regional watch-provider listings use TMDB metadata; duplicate entries are suppressed within each catalogue section.

ZIVA does not currently have a licensed playback/download provider integration. Movie details show regional streaming availability from TMDB where provided; this availability is not a ZIVA playback entitlement. Series details allow a visitor to select a TMDB-listed season and episode; the authenticated playback endpoint validates and passes those identifiers to a future provider adapter. Playback authorization fails closed rather than authorizing access based only on sign-in. There are no download endpoints or invented playback links. A configured adapter must independently verify provider entitlements and rights before returning an allowlisted HTTPS stream. Guests can keep a device-local list; signed-in users can synchronize their list, favourites, profile, and authorized-playback history with Supabase.

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
- Separate AniList-powered anime catalogue and search; anime metadata never implies a playable source.
- Guest watchlist plus Supabase-synchronized user lists, favourites, profile and playback progress.
- Secure server-side user and admin endpoints, with migration-backed row-level security.
- Installable PWA with an offline shell and a bounded cache of public catalogue responses only.
- Capacitor Android and iOS source projects with branded native assets and HTTPS API-origin configuration.
- Keyboard support, semantic controls and reduced-motion preference.
- No framework migration or frontend bundler required.

## Database migrations

The existing `001_initial_auth_schema.sql` remains unchanged. Apply migrations in order, from a trusted Supabase SQL editor or migration runner, after reviewing each file:

1. `supabase/migrations/001_initial_auth_schema.sql` — existing authentication, profiles and roles.
2. `supabase/migrations/002_user_library.sql` — private watchlists, favourites and viewing history.
3. `supabase/migrations/003_catalogue_and_entitlements.sql` — curated metadata, rights/provider asset references, subscription records and payment-history records.

Do not run these automatically against production. The user-facing app cannot grant itself admin rights or create billing records. Each user's library, subscription and payment history is scoped by `auth.uid()`; administrative access is verified on every server route. Migration 003 stores provider asset identifiers and a rights-evidence reference, not stream URLs.

### Read-only readiness review

All three migration files are present. No migration was executed as part of this authentication/session work, and the live Supabase schema has not been queried; its correspondence with these files is unknown.

| Migration | Changes and dependencies | Readiness notes |
|---|---|---|
| `001_initial_auth_schema.sql` | Enables `pgcrypto`; creates profiles, roles, and user-role tables; adds the new-user trigger, admin-check function, and RLS policies. It is the prerequisite for the other migrations. | Verify `pgcrypto`, existing table columns/constraints, trigger/function definitions, grants, and policy names before applying. Its `CREATE POLICY` statements are not preceded by drops, so pre-existing policies with those names can conflict on rerun. `CREATE TABLE IF NOT EXISTS` does not reconcile an existing table with a different shape. |
| `002_user_library.sql` | Creates private user library and watch-history tables, indexes, grants, and per-user RLS. Depends on `public.profiles` from 001. | Check for existing table shapes, primary keys, constraints, indexes, and same-named policies. Existing tables are not altered to add missing columns or constraints. |
| `003_catalogue_and_entitlements.sql` | Creates catalogue entries, authorized video-source references, subscriptions, and payment records, with indexes, grants, and RLS. Depends on profiles and `public.is_user_admin()` from 001. | Check for existing table shapes, indexes, policy names, and required UUID support. Provider/payment records are schema only; they do not enable playback or payment processing. |

Recommended order is 001, then 002 and 003 (the latter two both depend on 001 and do not depend on one another). Before any future application, use read-only schema inspection to compare relevant `pg_tables`/`information_schema` columns and constraints, `pg_policies`, indexes, grants, functions, trigger definitions, and the `pgcrypto` extension against each migration. Resolve conflicts and obtain explicit database approval before any migration run. These checks have not been performed against a live project.

## Anime, payments and playback limitations

Anime discovery uses a server-side AniList GraphQL adapter for metadata. No AniEmbed integration is enabled: its licensing/embedding terms and a reliable provider contract have not been verified. Anime episodes and sub/dub playback are not advertised as available.

The subscription and payment schemas and read-only account/admin views are preparation only. There is no payment provider, checkout, webhook, or real transaction processing. Do not mark a subscription paid or enter fabricated payment history.

The responsive HTML5 video player and server authorization path accept only a configured authorized playback adapter. TV resolver requests include the selected `seasonNumber` and `episodeNumber`; movie requests cannot supply episode identifiers. No real stream provider is configured, so actual movie, TV, and anime playback, downloads, offline video, third-party subtitles/quality controls, and the permanent video watermark are not available. TMDB and AniList supply metadata, not content rights.

The current admin control center supports user/role review, curated movie/series/anime metadata, rights-reference records, and read-only subscription/payment history. Dedicated season/episode editing, analytics/reports, platform configuration, and a verified payment-provider workflow remain future work; the dashboard does not imply these systems are operational.

## PWA installation

Serve ZIVA over HTTPS (or localhost during development), then use the browser's **Install app** / **Add to Home Screen** action. The service worker precaches the public application shell and may cache up to 50 public TMDB/AniList metadata responses. Authentication, profile, library, history, billing, playback and admin APIs are excluded. The PWA does not make protected video available offline.

## Capacitor Android and iOS

Install Node.js 22+, Android Studio/Android SDK and a supported JDK for Android. iOS source generation/sync is cross-platform, but Xcode builds and simulator/device tests require macOS with Xcode. Copy `.env.example` to a local `.env` or export the values in the build environment. Set `ZIVA_API_BASE_URL` to the real deployed HTTPS ZIVA server origin (no path or credentials); do not substitute an invented production hostname. The web assets contain only this public API origin, never private credentials.

Configure the backend's `MOBILE_APP_ORIGINS` with the Capacitor origins in use (typically `https://localhost,capacitor://localhost`) and `APP_ORIGIN` with the deployed web origin. Native API calls require credentialed CORS, Secure `SameSite=None` cookies, and CSRF validation. HTTPS and a reachable backend are required. Validate session restoration and logout on real Android and iOS devices: WebView cookie persistence and platform privacy rules can differ from desktop-browser behavior.

```bash
npm install
npm run mobile:prepare
npm run android:build
```

`android:build` adds the Capacitor Android platform if it is missing, syncs the web assets, then builds a debug APK at `android/app/build/outputs/apk/debug/app-debug.apk`. The script requires `ZIVA_API_BASE_URL`, Java, and an Android SDK (`ANDROID_HOME` or `ANDROID_SDK_ROOT`). The native application ID is `com.ziva.platform`; change it before publishing if a different reverse-domain ID is required. iOS compilation requires macOS and Xcode.

Android signed release preparation:

1. From the `android` directory, generate the release keystore using `keytool -genkeypair -v -keystore ziva-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias ziva`. The keystore path is gitignored, but back it up securely.
2. Keep the keystore and passwords outside version control. Create local `android/keystore.properties` with `storeFile=ziva-release.jks`, `storePassword=...`, `keyAlias=ziva`, and `keyPassword=...`. This file and keystore extensions are gitignored.
3. Back up the keystore securely; losing it may prevent updating an app distributed outside Play App Signing.
4. On Windows, run `npm run mobile:prepare`, then `cd android` and `gradlew.bat bundleRelease`. The AAB will be in `android/app/build/outputs/bundle/release/`. Confirm the release is signed with the intended key before distribution. Google Play Console enrollment, app signing, privacy/data declarations, content rights and store review are separate requirements.

iOS source and branding:

```bash
npm run ios:add
# After adding once:
npm run ios:sync
npm run ios:open
```

`ios:add` creates the Capacitor Xcode project; `ios:sync` regenerates the ZIVA icon/splash assets and copies the shared frontend into it. On macOS, use Xcode to select the `App` target, set the Apple Developer Team and a unique production bundle identifier, configure automatic or manual signing, and select an iPhone/iPad simulator or device. For distribution, archive with Xcode and validate/export for App Store Connect or TestFlight. Apple Developer Program enrollment, certificates, provisioning profiles, App Store Connect metadata, privacy disclosures, age/content ratings, rights and App Review are required. No IPA or signed iOS build is created by the Windows workflow.

## Desktop and browser support

The shared responsive web/PWA app is the cross-desktop delivery path for Windows, macOS and Linux; it talks to the same Node/Supabase backend and does not create platform-specific accounts. The responsive stylesheet adapts navigation and catalog grids for narrow screens, supports keyboard-operable cards, visible focus, and reduced-motion preferences. Desktop browser engines remain distinct and should be tested on current Chrome, Edge, Firefox and Safari before release; only the browser actually used for a smoke run should be reported as tested.

Tauri v2 was evaluated for optional native desktop shells and is deliberately not added yet. It can reuse the web UI while packaging per-OS WebView runtimes, but requires Rust/Cargo and per-platform signing/installer pipelines. Windows uses WebView2, macOS uses WKWebView, and Linux depends on WebKitGTK; this adds engine-specific behavior and expands the native release matrix without improving the shared backend. Keep the browser/PWA as the supported desktop experience until desktop product requirements justify native packaging and cookie/auth compatibility is validated on each OS. Do not treat Tauri packaging as implemented or tested.

## Validation

```bash
npm test
npm run build
node --check server.js
node --check lib/supabase.js
node --check app.js
node --check admin/app.js
```

Tests use local mocks and static checks; they do not prove live Supabase, AniList, TMDB, email, payments, rights, browser rendering, or device builds.

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
