
'use strict';

// ZIVA Stage 2B: live TMDB catalogue with a demo fallback.
const demoMovies = [
  {id:'horizon',title:'The Last Horizon',year:2026,genre:'Sci-Fi',rating:'8.9',type:'Movie',description:'A crew on a distant mission discovers a mysterious signal that challenges everything humanity believes about its place in the universe.',image:'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?auto=format&fit=crop&w=700&q=85'},
  {id:'protocol',title:'Shadow Protocol',year:2025,genre:'Action',rating:'8.2',type:'Movie',description:'An elite operative is pulled into a high-stakes conspiracy where every ally seems to have a secret.',image:'https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=700&q=85'},
  {id:'deep',title:'Beyond the Deep',year:2026,genre:'Drama',rating:'8.5',type:'Movie',description:'A moving story of courage, family and second chances set against the vastness of the ocean.',image:'https://images.unsplash.com/photo-1518837695005-2083093ee35b?auto=format&fit=crop&w=700&q=85'},
  {id:'neon',title:'Neon City',year:2025,genre:'Thriller',rating:'7.9',type:'Series',description:'In a city that never sleeps, one detective follows a trail of clues into a dangerous underworld.',image:'https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=700&q=85'},
  {id:'kingdom',title:'Kingdom of Ash',year:2026,genre:'Action',rating:'8.7',type:'Movie',description:'A forgotten heir must unite rival kingdoms before an ancient threat rises again.',image:'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=700&q=85'},
  {id:'little',title:'Little Big World',year:2025,genre:'Animation',rating:'8.4',type:'Movie',description:'An unlikely friendship takes two tiny adventurers on the biggest journey of their lives.',image:'https://images.unsplash.com/photo-1478720568477-152d9b164e26?auto=format&fit=crop&w=700&q=85'},
  {id:'silent',title:'The Silent Hour',year:2024,genre:'Thriller',rating:'7.8',type:'Movie',description:'A witness and a detective race against time when a quiet night turns into a mystery.',image:'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=700&q=85'},
  {id:'summer',title:'Summer Again',year:2025,genre:'Comedy',rating:'7.6',type:'Series',description:'One unexpected summer brings old friends together and changes the plans they thought they had.',image:'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?auto=format&fit=crop&w=700&q=85'},
  {id:'storm',title:'After the Storm',year:2026,genre:'Drama',rating:'8.1',type:'Movie',description:'A family rebuilds its life and discovers that hope can arrive from the most unexpected places.',image:'https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=700&q=85'},
  {id:'velocity',title:'Velocity',year:2025,genre:'Action',rating:'8.0',type:'Movie',description:'A street racer gets one final chance to settle a score and protect the people he loves.',image:'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=700&q=85'},
  {id:'parallel',title:'Parallel',year:2024,genre:'Sci-Fi',rating:'8.3',type:'Series',description:'Two strangers in different realities discover that their lives are connected by one impossible choice.',image:'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=700&q=85'},
  {id:'wild',title:'Wild Hearts',year:2025,genre:'Animation',rating:'8.6',type:'Movie',description:'A young explorer sets out to protect a magical forest and the creatures who call it home.',image:'https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=700&q=85'}
];

const $ = (selector) => document.querySelector(selector);
const watchlistKey = 'ziva-watchlist';
const legacyWatchlistKey = 'justwatch-demo-watchlist';

let activeGenre = 'All';
let searchTerm = '';
let currentMovie = null;
let catalogueMode = 'demo';
let movieData = [...demoMovies];
let seriesData = demoMovies.filter((item) => item.type === 'Series');
let searchResults = null;
let searchTimer = null;
let watchlist = loadWatchlist();

const knownMovies = new Map(demoMovies.map((movie) => [movie.id, movie]));

function loadWatchlist() {
  try {
    const current = localStorage.getItem(watchlistKey);
    const legacy = current === null ? localStorage.getItem(legacyWatchlistKey) : null;
    const parsed = JSON.parse(current ?? legacy ?? '[]');

    if (current === null && legacy !== null) {
      localStorage.setItem(watchlistKey, legacy);
    }

    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((id) => typeof id === 'string'))]
      : [];
  } catch {
    return [];
  }
}

function saveWatchlist() {
  try {
    localStorage.setItem(watchlistKey, JSON.stringify(watchlist));
  } catch {
    showToast('Browser storage is unavailable in this session.');
  }

  updateWatchlistCount();
}

function updateWatchlistCount() {
  const node = $('#watchlist-count');
  if (node) node.textContent = String(watchlist.length);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

function safeImageUrl(value) {
  try {
    const url = new URL(value, window.location.origin);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function makeCard(movie) {
  const saved = watchlist.includes(movie.id);

  return `
    <article class="movie-card"
      data-movie-id="${escapeHtml(movie.id)}"
      tabindex="0"
      aria-label="View ${escapeHtml(movie.title)} details">

      <div class="poster">
        <img
          src="${escapeHtml(safeImageUrl(movie.image))}"
          alt="${escapeHtml(movie.title)} poster"
          loading="lazy"
          onerror="this.style.opacity='.15'">

        <span class="rating">★ ${escapeHtml(movie.rating || '—')}</span>

        <div class="card-actions">
          <button
            class="save-button ${saved ? 'saved' : ''}"
            data-save="${escapeHtml(movie.id)}"
            aria-label="${saved ? 'Remove from' : 'Add to'} watchlist"
            title="${saved ? 'Remove from' : 'Add to'} my list">
            ${saved ? '✓' : '+'}
          </button>
        </div>

        <span class="poster-label">${escapeHtml(movie.type)}</span>
      </div>

      <h3>${escapeHtml(movie.title)}</h3>
      <small>
        ${escapeHtml(movie.year || 'Year unknown')}
        &nbsp;·&nbsp;
        ${escapeHtml(movie.genre || 'Unclassified')}
      </small>
    </article>
  `;
}

function renderGrid(selector, items, emptyMessage) {
  const grid = $(selector);
  if (!grid) return;

  grid.innerHTML = items.length
    ? items.map(makeCard).join('')
    : `<p class="empty-state">${escapeHtml(emptyMessage)}</p>`;
}

function matchesFilters(movie) {
  const genreMatch =
    activeGenre === 'All' ||
    movie.genre === activeGenre ||
    (movie.genres || []).includes(activeGenre);

  const text = `
    ${movie.title}
    ${movie.genre}
    ${(movie.genres || []).join(' ')}
    ${movie.year}
    ${movie.type}
  `.toLowerCase();

  return genreMatch && text.includes(searchTerm);
}

function render() {
  const filtered = (searchResults || movieData).filter(matchesFilters);

  const filteredSeries = searchResults
    ? []
    : seriesData.filter(matchesFilters);

  renderGrid(
    '#trending-grid',
    filtered.slice(0, 12),
    'No titles match that search. Try another keyword or genre.'
  );

  renderGrid(
    '#popular-grid',
    searchResults
      ? []
      : (
          filteredSeries.length
            ? filteredSeries.slice(0, 12)
            : (catalogueMode === 'demo' ? demoMovies.slice(6) : [])
        ),
    searchResults
      ? 'Search results are shown above.'
      : 'More titles are coming soon.'
  );

  const saved = watchlist
    .map((id) => knownMovies.get(id))
    .filter(Boolean);

  const missing = watchlist.length - saved.length;

  renderGrid(
    '#watchlist-grid',
    saved,
    missing
      ? 'Some saved titles are not currently loaded. Search for them again to restore their cards.'
      : 'Your list is empty. Add a title using the + button on any movie.'
  );

  updateWatchlistCount();
}

function setCatalogueStatus(message, mode = catalogueMode) {
  const status = $('#catalogue-status');

  if (status) {
    status.textContent = message;
    status.dataset.mode = mode;
  }
}

function showToast(message) {
  const toast = $('#toast');
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add('show');

  clearTimeout(showToast.timer);

  showToast.timer = setTimeout(() => {
    toast.classList.remove('show');
  }, 2600);
}

function openMovie(movie) {
  if (!movie) return;

  currentMovie = movie;

  const art = $('#dialog-art');
  const backdrop = safeImageUrl(movie.backdrop || movie.image);

  art.style.backgroundImage = backdrop
    ? `url("${backdrop}")`
    : 'none';

  $('#dialog-genre').textContent =
    `${String(movie.genre || 'Title').toUpperCase()} · ${String(movie.type || 'Movie').toUpperCase()}`;

  $('#dialog-title').textContent = movie.title;

  $('#dialog-meta').textContent =
    `★ ${movie.rating || '—'} · ${movie.year || 'Year unknown'}`;

  $('#dialog-description').textContent =
    movie.description || 'No description is available yet.';

  $('#dialog-save').textContent = watchlist.includes(movie.id)
    ? '✓ In my list'
    : '＋ Add to my list';

  $('#movie-dialog').showModal();
}

function rememberMovies(items) {
  items.forEach((movie) => knownMovies.set(movie.id, movie));
}

function toggleWatchlist(id) {
  const movie = knownMovies.get(id);
  if (!movie) return;

  if (watchlist.includes(id)) {
    watchlist = watchlist.filter((item) => item !== id);
    showToast(`Removed ${movie.title} from your list.`);
  } else {
    watchlist.push(id);
    showToast(`Added ${movie.title} to your list.`);
  }

  saveWatchlist();
  render();

  if (currentMovie?.id === id) {
    $('#dialog-save').textContent = watchlist.includes(id)
      ? '✓ In my list'
      : '＋ Add to my list';
  }
}

function updateGenreButtons() {
  document.querySelectorAll('.genre-chip').forEach((button) => {
    button.classList.toggle(
      'selected',
      button.dataset.genre === activeGenre
    );
  });
}

async function restoreSavedTmdbTitles() {
  if (!window.ZivaCatalogue) return;

  const missing = watchlist.filter((id) => !knownMovies.has(id));

  await Promise.all(missing.map(async (id) => {
    const match = /^tmdb-(movie|tv)-(\d+)$/.exec(id);
    if (!match) return;

    try {
      const raw = await window.ZivaCatalogue.get(
        `${match[1]}/${match[2]}`
      );

      const normalized = window.ZivaCatalogue.normalize(
        raw,
        match[1]
      );

      if (normalized) {
        knownMovies.set(normalized.id, normalized);
      }
    } catch {
      // Keep the saved ID if TMDB is temporarily unavailable.
    }
  }));
}

async function loadLiveCatalogue() {
  if (!window.ZivaCatalogue) {
    throw new Error('ZIVA catalogue client did not load.');
  }

  const [movieResponse, tvResponse] = await Promise.all([
    window.ZivaCatalogue.get('trending/movie/week'),
    window.ZivaCatalogue.get('trending/tv/week')
  ]);

  const movies = window.ZivaCatalogue.normalizeList(
    movieResponse.results || []
  );

  const series = window.ZivaCatalogue.normalizeList(
    tvResponse.results || []
  );

  if (!movies.length && !series.length) {
    throw new Error('TMDB returned no titles.');
  }

  movieData = movies;
  seriesData = series;

  rememberMovies([...movies, ...series]);

  catalogueMode = 'live';

  $('#tmdb-attribution').hidden = false;

  setCatalogueStatus(
    `Showing trending movies and series from TMDB · ${movies.length + series.length} titles`,
    'live'
  );

  await restoreSavedTmdbTitles();
  render();
}

async function runSearch(query) {
  if (!query) {
    searchResults = null;
    render();
    return;
  }

  if (catalogueMode !== 'live' || !window.ZivaCatalogue) {
    searchResults = null;
    render();
    return;
  }

  setCatalogueStatus(
    `Searching TMDB for “${query}”…`,
    'live'
  );

  try {
    const results = await window.ZivaCatalogue.search(query);

    if ($('#search-input').value.trim() !== query) return;

    searchResults = results;
    rememberMovies(results);

    setCatalogueStatus(
      `${results.length} search results from TMDB`,
      'live'
    );

    render();
  } catch {
    searchResults = null;

    setCatalogueStatus(
      'TMDB search is temporarily unavailable. Showing local catalogue results.',
      'demo'
    );

    render();
  }
}

async function initializeCatalogue() {
  try {
    const response = await fetch('/api/status', {
      headers: { Accept: 'application/json' }
    });

    if (!response.ok) {
      throw new Error('Could not read API status.');
    }

    const status = await response.json();

    if (!status.tmdbConfigured) {
      catalogueMode = 'demo';

      setCatalogueStatus(
        'Demo catalogue · Add a TMDB access token to enable live movies and series.',
        'demo'
      );

      render();
      return;
    }

    await loadLiveCatalogue();

  } catch {
    catalogueMode = 'demo';
    movieData = [...demoMovies];
    seriesData = demoMovies.filter((item) => item.type === 'Series');

    rememberMovies(demoMovies);

    setCatalogueStatus(
      'Demo catalogue · Live movie data is currently unavailable.',
      'demo'
    );

    render();
  }
}

// Delegated card interactions.
document.addEventListener('click', (event) => {
  const saveButton = event.target.closest('[data-save]');

  if (saveButton) {
    event.stopPropagation();
    toggleWatchlist(saveButton.dataset.save);
    return;
  }

  const card = event.target.closest('[data-movie-id]');

  if (card) {
    openMovie(knownMovies.get(card.dataset.movieId));
  }
});

document.addEventListener('keydown', (event) => {
  const card = event.target.closest?.('[data-movie-id]');

  if (card && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    openMovie(knownMovies.get(card.dataset.movieId));
  }

  if (event.key === 'Escape') {
    $('#search-strip').classList.remove('open');
  }
});

$('#genres').addEventListener('click', (event) => {
  const chip = event.target.closest('[data-genre]');
  if (!chip) return;

  activeGenre = chip.dataset.genre;
  updateGenreButtons();
  render();
});

$('#search-toggle').addEventListener('click', () => {
  $('#search-strip').classList.toggle('open');

  if ($('#search-strip').classList.contains('open')) {
    $('#search-input').focus();
  }
});

$('#search-input').addEventListener('input', (event) => {
  searchTerm = event.target.value.trim().toLowerCase();

  searchResults = null;
  render();

  clearTimeout(searchTimer);

  const query = event.target.value.trim();

  if (!query) {
    setCatalogueStatus(
      catalogueMode === 'live'
        ? 'Showing trending movies and series from TMDB.'
        : 'Demo catalogue.',
      catalogueMode
    );

    return;
  }

  if (catalogueMode === 'live') {
    searchTimer = setTimeout(() => runSearch(query), 350);
  }
});

$('#menu-toggle').addEventListener('click', () => {
  $('#navigation').classList.toggle('open');
});

$('#navigation').addEventListener('click', (event) => {
  if (event.target.closest('a')) {
    $('#navigation').classList.remove('open');
  }
});

$('#dialog-close').addEventListener('click', () => {
  $('#movie-dialog').close();
});

$('#movie-dialog').addEventListener('click', (event) => {
  if (event.target === $('#movie-dialog')) {
    $('#movie-dialog').close();
  }
});

$('#dialog-save').addEventListener('click', () => {
  if (currentMovie) {
    toggleWatchlist(currentMovie.id);
  }
});

$('#dialog-watch').addEventListener('click', () => {
  showToast(
    'Connect a licensed streaming provider to add real watch options.'
  );
});

$('#featured-button').addEventListener('click', () => {
  openMovie(movieData[0] || demoMovies[0]);
});

$('#sign-in').addEventListener('click', () => {
  showToast(
    'Sign-in is a demo action. Add an authentication provider to enable accounts.'
  );
});

// Render demo cards immediately; replace them with TMDB results when configured.
rememberMovies(demoMovies);
render();
initializeCatalogue();
