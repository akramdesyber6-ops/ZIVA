'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = process.cwd();
for (const file of ['index.html', 'styles.css', 'app.js']) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Run this script from the ZIVA project root. Missing ${file}`);
}
for (const file of ['server.js', 'api/tmdb.js', 'api/status.js', 'lib/tmdb.js', 'src/catalogue.js', 'tests/tmdb.test.js']) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing ${file}. Extract the complete ZIP into the ZIVA folder first.`);
}
function replace(file, oldText, newText, label) {
  const full = path.join(root, file);
  let text = fs.readFileSync(full, 'utf8');
  if (text.includes(newText)) { console.log('Already applied:', label); return; }
  if (!text.includes(oldText)) throw new Error(`Cannot find expected ${label} in ${file}. No more files will be patched.`);
  text = text.replace(oldText, newText);
  fs.writeFileSync(full, text, 'utf8');
  console.log('Patched', file, '-', label);
}

replace('index.html',
  '<div class="movie-grid" id="trending-grid" aria-live="polite"></div>',
  '<p class="catalogue-status" id="catalogue-status" role="status" aria-live="polite">Loading ZIVA catalogue…</p><div class="movie-grid" id="trending-grid" aria-live="polite"></div>',
  'catalogue status message');
replace('index.html',
  '<div class="promo-mark">JW<span>+</span></div>',
  '<div class="promo-mark">ZIVA</div>',
  'promo branding');
replace('index.html',
  '<small>© 2026 ZIVA · LIGHT UP YOUR SCREEN</small>',
  '<small>© 2026 ZIVA · LIGHT UP YOUR SCREEN</small><small id="tmdb-attribution" hidden>This product uses the TMDB API but is not endorsed or certified by TMDB. <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">The Movie Database</a></small>',
  'TMDB attribution notice');
replace('index.html',
  '<script src="app.js" defer></script>',
  '<script src="src/catalogue.js" defer></script>\n  <script src="app.js" defer></script>',
  'catalogue browser adapter');

const stylesPath = path.join(root, 'styles.css');
let styles = fs.readFileSync(stylesPath, 'utf8');
if (!styles.includes('.catalogue-status{')) {
  styles += '\n.catalogue-status{margin:-8px 0 18px;color:var(--muted);font-size:11px;min-height:16px}.catalogue-status[data-mode="live"]{color:var(--brand-orange)}#tmdb-attribution{flex-basis:100%;font-size:10px;color:var(--muted)}#tmdb-attribution[hidden]{display:none}#tmdb-attribution a{color:var(--brand-orange)}\n';
  fs.writeFileSync(stylesPath, styles, 'utf8');
  console.log('Patched styles.css - catalogue and attribution styles');
}

const appPath = path.join(root, 'app.js');
let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes('const demoMovieData = movieData.slice();')) {
  if (!app.includes('const movieData = [')) throw new Error('Cannot find sample movie catalogue in app.js');
  app = app.replace('const movieData = [', 'let movieData = [');
  const arrayEnd = '\n];\n\nconst $ = selector => document.querySelector(selector);';
  if (!app.includes(arrayEnd)) throw new Error('Cannot find the end of the sample movie catalogue in app.js');
  app = app.replace(arrayEnd, '\n];\n\nconst demoMovieData = movieData.slice();\nlet remoteCatalogueEnabled = false;\nlet liveCatalogue = null;\nlet catalogueSearchTimer = null;\n\nconst $ = selector => document.querySelector(selector);');
}
const oldSearch = '$("#search-input").addEventListener("input", event => { searchTerm = event.target.value.trim().toLowerCase(); render(); });';
const newSearch = `$("#search-input").addEventListener("input", event => {
  searchTerm = event.target.value.trim().toLowerCase();
  window.clearTimeout(catalogueSearchTimer);
  if (!remoteCatalogueEnabled || searchTerm.length < 2) {
    movieData = liveCatalogue || demoMovieData;
    render();
    return;
  }
  render();
  catalogueSearchTimer = window.setTimeout(async () => {
    try { movieData = await window.ZivaCatalogue.search(searchTerm); render(); }
    catch (error) { movieData = liveCatalogue || demoMovieData; render(); showToast('Live search is unavailable. Showing the saved catalogue.'); }
  }, 350);
});`;
if (!app.includes(newSearch)) {
  if (!app.includes(oldSearch)) throw new Error('Cannot find current search input handler in app.js');
  app = app.replace(oldSearch, newSearch);
}
const init = `
async function initializeRemoteCatalogue() {
  const status = document.getElementById('catalogue-status');
  try {
    const statusResponse = await fetch('/api/status');
    if (!statusResponse.ok) throw new Error('Could not read API status.');
    const config = await statusResponse.json();
    if (!config.tmdbConfigured) {
      if (status) { status.textContent = 'Demo mode: showing the built-in ZIVA catalogue. Add a TMDB Read Access Token to enable live movie data.'; status.dataset.mode = 'demo'; }
      return;
    }
    const results = await Promise.allSettled([
      window.ZivaCatalogue.get('trending/all/week'),
      window.ZivaCatalogue.get('movie/popular'),
      window.ZivaCatalogue.get('tv/popular')
    ]);
    const lists = results.filter(item => item.status === 'fulfilled').map(item => window.ZivaCatalogue.normalizeList(item.value.results));
    const combined = window.ZivaCatalogue.unique(lists.flat());
    if (!combined.length) throw new Error('TMDB returned no catalogue results.');
    liveCatalogue = combined;
    movieData = liveCatalogue;
    remoteCatalogueEnabled = true;
    if (status) { status.textContent = 'Live movie and TV catalogue powered by TMDB.'; status.dataset.mode = 'live'; }
    const attribution = document.getElementById('tmdb-attribution');
    if (attribution) attribution.hidden = false;
    render();
  } catch (error) {
    if (status) { status.textContent = 'Live catalogue unavailable. ZIVA is using its built-in demo titles.'; status.dataset.mode = 'demo'; }
    movieData = demoMovieData;
    render();
  }
}
`;
if (!app.includes('async function initializeRemoteCatalogue()')) {
  const finalRender = app.lastIndexOf('\nrender();');
  if (finalRender < 0) throw new Error('Cannot find final render() call in app.js');
  app = app.slice(0, finalRender) + '\n' + init + '\nrender();\ninitializeRemoteCatalogue();' + app.slice(finalRender + '\nrender();'.length);
}
fs.writeFileSync(appPath, app, 'utf8');
console.log('Patched app.js - optional live TMDB catalogue and debounced search');

if (!fs.existsSync(path.join(root, 'package.json'))) throw new Error('package.json from the ZIP is missing. Extract the complete ZIP into the ZIVA root.');
if (!fs.existsSync(path.join(root, '.env.example'))) throw new Error('.env.example from the ZIP is missing. Extract the complete ZIP into the ZIVA root.');
const gitignorePath = path.join(root, '.gitignore');
let gitignore = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
for (const line of ['.env', '.env.*', '!.env.example', 'node_modules/', '*.log']) if (!gitignore.split(/\r?\n/).includes(line)) gitignore += `${line}\n`;
fs.writeFileSync(gitignorePath, gitignore, 'utf8');

const readmePath = path.join(root, 'README.md');
let readme = fs.readFileSync(readmePath, 'utf8');
if (!readme.includes('## TMDB live catalogue')) {
  readme += [
    '',
    '## TMDB live catalogue',
    '',
    'ZIVA continues to work in demo mode without an API credential. To enable live movie and TV metadata, use Node.js 20 or newer. Copy .env.example to .env and set TMDB_API_READ_ACCESS_TOKEN to your TMDB API Read Access Token. Never put this token in browser JavaScript or commit .env to GitHub.',
    '',
    'Run locally with npm start and open http://127.0.0.1:5500. Run automated checks with npm test. The browser calls the same-origin server-side proxy at /api/tmdb?path=...; the secret stays on the server. Vercel can use api/tmdb.js and api/status.js as serverless functions. Set TMDB_API_READ_ACCESS_TOKEN under Vercel Project Settings → Environment Variables. For local use, server.js reads the .env file.',
    '',
    '### TMDB attribution',
    '',
    'When using TMDB data or images, display an approved TMDB logo in an About/Credits area and include this notice: “This product uses the TMDB API but is not endorsed or certified by TMDB.” Follow TMDB current logo and attribution guidance. ZIVA is an independent project and is not affiliated with TMDB.',
    ''
  ].join('\n');
  fs.writeFileSync(readmePath, readme, 'utf8');
}
console.log('\nZIVA Stage 2A setup complete. Demo mode remains available without an API token.');
console.log('Next run: node --check app.js && npm test && npm start');
