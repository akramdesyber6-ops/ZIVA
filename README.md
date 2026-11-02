# JUSTWATCH — Cinema Discovery

A responsive dark-themed cinema discovery website built with **HTML, CSS and vanilla JavaScript**. This is a clean-room recreation inspired by the reference website supplied by the project owner. It is not the original site's source code and is not affiliated with any streaming provider.

## Run locally

No build tools or package installation are needed. Open `index.html` in a browser, or run a local server:

```bash
python -m http.server 5500
```

Then visit `http://localhost:5500`.

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
justwatch/
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
