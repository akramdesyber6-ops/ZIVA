# ZIVA — Light up your screen

A responsive dark-themed cinema discovery website built with **HTML, CSS and vanilla JavaScript**. This is a clean-room recreation inspired by the reference website supplied by the project owner. It is not the original site's source code and is not affiliated with any streaming provider.

## Run locally

No build tools or package installation are needed. Open `index.html` in a browser, or run a local server:

```bash
python -m http.server 5500
```

Then visit `http://localhost:5500`.

## Supabase Phase 1 setup

This repository now includes a server-side Supabase integration for Phase 1 authentication and admin authorization while preserving the existing public ZIVA demo site and TMDB proxy.

Required environment variables:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
TMDB_API_READ_ACCESS_TOKEN=your-tmdb-read-token
PORT=5500
```

Keep these values in a local `.env` file and never expose them in browser code, app.js, index.html, or GitHub. The real `.env` file is not tracked and should not be overwritten.

The Supabase schema is defined in `supabase/migrations/001_initial_auth_schema.sql`. It creates:

- `public.profiles` for user profile data
- `public.roles` and `public.user_roles` for the admin RBAC model
- a `public.handle_new_user()` trigger that creates a profile when a Supabase Auth user signs up
- row-level security policies for user profile access and admin-only role management
- a `public.is_user_admin()` function used by the server to authorize admin routes

The server-side API routes in `server.js` expose:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/session`
- `POST /api/auth/logout`
- `GET /api/admin/permissions`
- `GET /api/playback/authorize`

The public website itself remains unchanged while authentication is enforced server-side for protected content routes.

## Features

- Responsive cinema-style landing page for desktop, tablet and mobile.
- Movie and series cards with genre, year and sample rating labels.
- Live search and genre filtering.
- Movie detail dialog.
- Personal watchlist saved in browser local storage.
- Keyboard support, semantic controls and reduced-motion preference.
- No framework, build step or API key required for the demo.

## Project structure

```text
ZIVA/
├── index.html
├── styles.css
├── app.js
└── README.md
```

## Deploy on Vercel

1. Import this GitHub repository in Vercel.
2. Select **Other** as the framework preset (or leave the static-site defaults).
3. Leave the build command and output directory empty; the site is served from the repository root.
4. Deploy.

You can also enable GitHub Pages from **Settings → Pages**, selecting the `main` branch and `/(root)`.

## Connect real catalogue data

The current catalogue in `app.js` is sample data. Replace it with data from a licensed movie metadata API such as TMDB, following that provider's API terms, attribution and image rules. Keep private API credentials on a server-side endpoint rather than exposing them in browser JavaScript.

The **Watch options** control is a placeholder. Real playback or provider availability requires a lawful streaming source, the required rights and a provider integration. This project does not scrape third-party streaming sites or include copyrighted movie files.

## Customize

- Edit titles, descriptions, ratings and image URLs in `app.js`.
- Change design tokens at the top of `styles.css`.
- Update hero copy, navigation and page sections in `index.html`.

## License

No license is specified. Add a license before redistributing this project for reuse.
