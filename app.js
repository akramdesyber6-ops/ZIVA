
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
const favoritesKey = 'ziva-favorites';

let searchTerm = '';
let currentMovie = null;
let catalogueMode = 'unavailable';
let searchResults = null;
let searchTimer = null;
let searchError = '';
let watchlist = loadWatchlist();
let favorites = loadLocalCollection(favoritesKey);
let authMode = 'login';
let authStep = 'request';
let loginMethod = 'password';
let authUser = null;
let csrfToken = '';
let authEmail = '';
let resendSeconds = 0;
let resendTimer = null;
let catalogueSections = [];
let currentPage = 'home';
let currentMediaType = 'movie';
let currentGenreSlug = '';
let currentGenreId = null;
let selectedGenreId = '';
let watchlistFilter = 'all';
let searchPage = 1;
let searchTotalPages = 1;
let searchLoading = false;
let catalogueGenres = [];
let movieRequestId = 0;
let lastProgressSavedAt = 0;
let progressSavePending = false;
let progressRestoreFor = '';
let progressSyncWarningShown = false;

const knownMovies = new Map();

function getPageContext() {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
  const genreMatch = /^\/genres\/([a-z0-9-]+)$/.exec(pathname);
  if (genreMatch) {
    const params = new URLSearchParams(window.location.search);
    return {
      page: 'genre',
      genreSlug: genreMatch[1],
      mediaType: params.get('media') === 'tv' ? 'tv' : 'movie'
    };
  }
  if (pathname === '/movies') return { page: 'movies', mediaType: 'movie' };
  if (pathname === '/series') return { page: 'series', mediaType: 'tv' };
  if (pathname === '/watchlist') return { page: 'watchlist', mediaType: 'movie' };
  return { page: 'home', mediaType: 'movie' };
}

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

function loadLocalCollection(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? [...new Set(value.filter((id) => typeof id === 'string'))] : [];
  } catch {
    return [];
  }
}

function saveLocalCollection(key, values) {
  try {
    localStorage.setItem(key, JSON.stringify(values));
  } catch {
    showToast('Browser storage is unavailable in this session.');
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

function syncLibraryItem(movie, action, collection = 'watchlist') {
  if (!authUser || !window.ZivaLibrary || !movie) return;
  const mediaType = movie.tmdbType || (movie.id.startsWith('tmdb-tv-') ? 'tv' : 'movie');
  window.ZivaLibrary.save({
    mediaType,
    contentId: movie.id,
    metadata: {
      title: movie.title,
      year: Number(movie.year) || null,
      image: movie.image || ''
    }
  }, action, collection).catch(() => {
    showToast('Saved on this device. Cloud library sync is temporarily unavailable.');
  });
}

async function syncLocalWatchlist() {
  if (!authUser || !window.ZivaLibrary) return;
  const localItems = watchlist.map((id) => knownMovies.get(id)).filter(Boolean);
  for (const movie of localItems) {
    await window.ZivaLibrary.save({
      mediaType: movie.tmdbType || (movie.id.startsWith('tmdb-tv-') ? 'tv' : 'movie'),
      contentId: movie.id,
      metadata: { title: movie.title, year: Number(movie.year) || null, image: movie.image || '' }
    });
  }
  const localFavorites = favorites.map((id) => knownMovies.get(id)).filter(Boolean);
  for (const movie of localFavorites) {
    await window.ZivaLibrary.save({
      mediaType: movie.tmdbType || (movie.id.startsWith('tmdb-tv-') ? 'tv' : 'movie'),
      contentId: movie.id,
      metadata: { title: movie.title, year: Number(movie.year) || null, image: movie.image || '' }
    }, 'upsert', 'favorite');
  }
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
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value, window.location.origin);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function makeCard(movie) {
  const saved = watchlist.includes(movie.id);
  const favorite = favorites.includes(movie.id);

  return `
    <article class="movie-card"
      data-movie-id="${escapeHtml(movie.id)}"
      tabindex="0"
      aria-label="View ${escapeHtml(movie.title)} details">

      <div class="poster">
        ${safeImageUrl(movie.image)
          ? `<img src="${escapeHtml(safeImageUrl(movie.image))}" alt="${escapeHtml(movie.title)} poster" loading="lazy" onerror="this.style.opacity='.15'">`
          : '<span class="poster-placeholder" aria-hidden="true"></span>'}

        <span class="rating">★ ${escapeHtml(movie.rating || '—')}</span>

        <div class="card-actions">
          <button
            class="save-button ${saved ? 'saved' : ''}"
            data-save="${escapeHtml(movie.id)}"
            aria-label="${saved ? 'Remove from' : 'Add to'} watchlist"
            title="${saved ? 'Remove from' : 'Add to'} my list">
            ${saved ? '✓' : '+'}
          </button>
          <button class="favorite-button ${favorite ? 'saved' : ''}" type="button" data-favorite="${escapeHtml(movie.id)}" aria-label="${favorite ? 'Remove from' : 'Add to'} favourites" title="${favorite ? 'Remove from' : 'Add to'} favourites">♥</button>
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
  if (selectedGenreId && !movie.genreIds?.includes(Number(selectedGenreId))) return false;
  const text = `
    ${movie.title}
    ${movie.genre}
    ${(movie.genres || []).join(' ')}
    ${movie.year}
    ${movie.type}
  `.toLowerCase();

  return text.includes(searchTerm);
}

function render() {
  const sections = catalogueSections;
  const visible = sections.map((section) => ({ section, items: section.items }));

  visible.forEach(({ section, items }, index) => {
    const root = document.getElementById(`catalogue-${section.key}`);
    if (!root) return;
    if (section.heading) return;
    root.hidden = false;
    const title = root.querySelector('h2');
    const grid = root.querySelector('.movie-grid');
    const loadMore = root.querySelector('[data-load-section]');
    if (searchResults !== null && index === 0) {
      title.textContent = 'Search results';
      grid.innerHTML = searchResults.length
        ? searchResults.filter(matchesFilters).map(makeCard).join('')
        : `<p class="empty-state">${escapeHtml(searchError || 'No titles match that search.')}</p>`;
      loadMore.hidden = searchPage >= searchTotalPages || !searchResults.length;
      loadMore.disabled = searchLoading;
      loadMore.textContent = searchLoading ? 'Loading…' : 'Load more results';
      return;
    }

    title.textContent = section.title;
    if (section.loading && !section.items.length) {
      grid.innerHTML = '<div class="movie-skeleton"></div>'.repeat(6);
    } else {
      const filteredItems = items.filter(matchesFilters);
      grid.innerHTML = filteredItems.length
        ? filteredItems.map(makeCard).join('')
        : `<p class="empty-state">${escapeHtml(section.error || (section.page ? 'No titles match the current search in this section.' : 'This section loads as you browse.'))}</p>`;
    }
    loadMore.hidden = section.page >= section.totalPages && !section.error;
    loadMore.disabled = section.loading;
    loadMore.textContent = section.loading ? 'Loading…' : section.error ? 'Retry' : 'Load more';
  });

  const saved = watchlist
    .filter((id) => watchlistFilter === 'all' || id.startsWith(`tmdb-${watchlistFilter}-`))
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

function renderCatalogueShell(sections) {
  const root = $('#catalogue-sections');
  root.innerHTML = sections.map((section) => section.heading
    ? `<section class="content-section catalogue-section genre-group-heading" id="catalogue-${escapeHtml(section.key)}"><h2>${escapeHtml(section.title)}</h2></section>`
    : `
    <section class="content-section catalogue-section" id="catalogue-${escapeHtml(section.key)}" data-section="${escapeHtml(section.key)}">
      <div class="section-heading">
        <div><p class="section-kicker">${currentPage === 'home' ? "WHAT'S HOT" : 'DISCOVER'}</p><h2>${escapeHtml(section.title)}</h2><p class="section-subtitle">Explore ${escapeHtml(section.title.toLowerCase())} from TMDB.</p></div>
      </div>
      <div class="movie-grid" aria-live="polite"></div>
      <div class="section-pagination"><button class="ghost-button" type="button" data-load-section="${escapeHtml(section.key)}">Load more</button></div>
    </section>
  `).join('');
  render();
}

async function loadSection(section, page = null) {
  if (!section || section.loading) return;
  const requestedPage = page || (section.error
    ? Math.max(section.page, 1)
    : section.page ? window.ZivaCatalogueSections.nextPage(section) : 1);
  if (!requestedPage) return;
  section.loading = true;
  section.error = '';
  render();

  try {
    const response = await window.ZivaCatalogue.get(section.path, {
      ...section.params,
      page: requestedPage
    });
    const results = window.ZivaCatalogue.normalizeList(response.results || [], section.mediaType);
    section.items = window.ZivaCatalogue.unique(section.items.concat(results));
    section.page = requestedPage;
    section.totalPages = Math.min(Number(response.total_pages) || requestedPage, 500);
    section.error = '';
    rememberMovies(section.items);
  } catch (error) {
    section.error = error.message || 'This catalogue section is temporarily unavailable.';
  } finally {
    section.loading = false;
    render();
  }
}

function observeCatalogueSections() {
  const remaining = catalogueSections.slice(4).filter((section) => !section.heading);
  if (!('IntersectionObserver' in window)) {
    remaining.forEach((section) => loadSection(section));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      const section = catalogueSections.find((item) => item.key === entry.target.dataset.section);
      if (section) loadSection(section);
    }
  }, { rootMargin: '500px 0px' });
  remaining.forEach((section) => {
    const element = document.getElementById(`catalogue-${section.key}`);
    if (element) observer.observe(element);
  });
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

function updateAuthUi(user) {
  authUser = user;
  const signIn = $('#sign-in');
  const signOut = $('#sign-out');

  if (user) {
    const name = user.fullName || user.email || 'Account';
    signIn.textContent = name;
    signIn.setAttribute('aria-label', `Signed in as ${name}`);
    signIn.title = `View account: ${user.email || name}`;
    signOut.hidden = false;
  } else {
    signIn.textContent = 'Sign in';
    signIn.setAttribute('aria-label', 'Sign in');
    signIn.removeAttribute('title');
    signOut.hidden = true;
  }
}

function setAuthMode(mode) {
  authMode = mode;
  authStep = 'request';
  loginMethod = 'password';
  const creating = authMode === 'register';
  $('#auth-kicker').textContent = creating ? 'JOIN ZIVA' : 'WELCOME BACK';
  $('#auth-title').textContent = creating ? 'Create your account' : 'Sign in';
  $('#auth-description').textContent = creating
    ? 'Create your account with a password, then verify your email with a six-digit code.'
    : 'Sign in with your email and password, or choose email-code sign-in.';
  $('#auth-name-field').hidden = !creating;
  $('#auth-name').required = creating;
  $('#auth-password-field').hidden = false;
  $('#auth-password').required = true;
  $('#auth-password').autocomplete = creating ? 'new-password' : 'current-password';
  $('#auth-code-field').hidden = true;
  $('#auth-code').required = false;
  $('#auth-email').readOnly = false;
  $('#auth-email').value = authEmail;
  $('#auth-submit-label').textContent = creating ? 'Create account' : 'Sign in';
  $('#auth-switch-copy').textContent = creating ? 'Already have an account?' : 'New to ZIVA?';
  $('#auth-mode-toggle').textContent = creating ? 'Sign in' : 'Create an account';
  $('#auth-switch').hidden = false;
  $('#auth-resend').hidden = true;
  $('#auth-method-toggle').hidden = creating;
  $('#auth-method-toggle').textContent = 'Use a one-time email code instead';
  $('#auth-message').textContent = '';
  $('#auth-message').dataset.kind = '';
  $('#auth-code').value = '';
}

function showCodeEntry() {
  authStep = 'verify';
  $('#auth-kicker').textContent = 'EMAIL VERIFICATION';
  $('#auth-title').textContent = 'Check your email';
  $('#auth-description').textContent = `Enter the one-time code sent to ${authEmail}.`;
  $('#auth-name-field').hidden = true;
  $('#auth-password-field').hidden = true;
  $('#auth-email').value = authEmail;
  $('#auth-email').readOnly = true;
  $('#auth-code-field').hidden = false;
  $('#auth-code').required = true;
  $('#auth-code').value = '';
  $('#auth-submit-label').textContent = 'Verify code';
  $('#auth-switch').hidden = true;
  $('#auth-method-toggle').hidden = true;
  $('#auth-resend').hidden = false;
  $('#auth-message').textContent = 'Codes are single-use and expire according to the Supabase Auth email OTP settings.';
  $('#auth-message').dataset.kind = '';
  $('#auth-code').focus();
  startResendCountdown();
}

function startResendCountdown() {
  clearInterval(resendTimer);
  resendSeconds = 30;
  const button = $('#auth-resend');
  button.disabled = true;
  const update = () => {
    button.textContent = resendSeconds > 0 ? `Resend code in ${resendSeconds}s` : 'Resend code';
    button.disabled = resendSeconds > 0;
    if (resendSeconds <= 0) clearInterval(resendTimer);
    resendSeconds -= 1;
  };
  update();
  resendTimer = setInterval(update, 1000);
}

function openAuthDialog(mode = 'login') {
  setAuthMode(mode);
  const dialog = $('#auth-dialog');
  if (!dialog.open) dialog.showModal();
  (mode === 'register' ? $('#auth-name') : $('#auth-email')).focus();
}

async function restoreAuthSession() {
  try {
    const response = await fetch('/api/auth/session', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
    const payload = await response.json().catch(() => ({}));
    if (payload.csrfToken) csrfToken = payload.csrfToken;
    updateAuthUi(response.ok && payload.authenticated ? payload.user : null);
    if (response.ok && payload.authenticated) {
      syncLocalWatchlist().catch(() => showToast('Some items are still only saved on this device.'));
    }
  } catch {
    updateAuthUi(null);
  }
}

async function submitAuth(event) {
  event.preventDefault();
  const message = $('#auth-message');
  const email = authStep === 'verify' ? authEmail : $('#auth-email').value.trim().toLowerCase();
  const fullName = $('#auth-name').value.trim();
  const password = $('#auth-password').value;
  message.dataset.kind = '';

  if (authStep === 'request' && authMode === 'register' && (fullName.length < 2 || fullName.length > 80)) {
    message.textContent = 'Enter a name between 2 and 80 characters.';
    $('#auth-name').focus();
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    message.textContent = 'Enter a valid email address.';
    $('#auth-email').focus();
    return;
  }
  if (authStep === 'request' && (authMode === 'register' || loginMethod === 'password') &&
      (password.length < 8 || password.length > 128)) {
    message.textContent = authMode === 'register'
      ? 'Choose a password with at least 8 characters.'
      : 'Enter your password.';
    $('#auth-password').focus();
    return;
  }
  const code = $('#auth-code').value.trim();
  if (authStep === 'verify' && !/^\d{6}$/.test(code)) {
    message.textContent = 'Enter the six-digit code from your email.';
    $('#auth-code').focus();
    return;
  }

  const submitButton = $('#auth-submit');
  submitButton.disabled = true;
  submitButton.setAttribute('aria-busy', 'true');
  $('#auth-submit-label').textContent = authStep === 'verify'
    ? 'Verifying code…'
    : authMode === 'register' ? 'Creating account…' : loginMethod === 'password' ? 'Signing in…' : 'Sending code…';

  try {
    if (!csrfToken) await restoreAuthSession();
    if (!csrfToken) throw new Error('Unable to secure the request. Reload the page and try again.');

    const requestCode = authStep === 'request' &&
      (authMode === 'register' || loginMethod === 'code');
    const passwordLogin = authStep === 'request' && authMode === 'login' && loginMethod === 'password';
    const route = authStep === 'verify'
      ? '/api/auth/verify'
      : authMode === 'register'
        ? '/api/auth/register'
        : loginMethod === 'code' ? '/api/auth/login-code' : '/api/auth/login';
    const response = await fetch(route, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
      },
      body: JSON.stringify(authStep === 'verify'
        ? { email, code, type: authMode === 'register' ? 'signup' : 'email' }
        : authMode === 'register'
          ? { full_name: fullName, email, password }
          : passwordLogin ? { email, password } : { email })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || 'Authentication failed. Please try again.');

    if (requestCode) {
      authEmail = email;
      showCodeEntry();
      message.textContent = payload.message || 'If an account exists for this address, a code has been sent.';
    } else if (payload.authenticated && payload.user) {
      updateAuthUi(payload.user);
      syncLocalWatchlist().catch(() => showToast('Some items are still only saved on this device.'));
      $('#auth-dialog').close();
      $('#auth-form').reset();
      showToast(`Welcome${payload.user.fullName ? `, ${payload.user.fullName}` : ' to ZIVA'}.`);
    } else {
      throw new Error('Email verification could not be completed. Request a new code and try again.');
    }
  } catch (error) {
    message.textContent = error.message || 'Authentication failed. Please try again.';
  } finally {
    submitButton.disabled = false;
    submitButton.removeAttribute('aria-busy');
    if (authStep === 'request') {
      $('#auth-submit-label').textContent = authMode === 'register' ? 'Create account' : loginMethod === 'password' ? 'Sign in' : 'Send sign-in code';
    } else {
      $('#auth-submit-label').textContent = 'Verify code';
    }
  }
}

async function resendAuthCode() {
  if (resendSeconds > 0) return;
  authStep = 'request';
  $('#auth-email').value = authEmail;
  $('#auth-email').readOnly = true;
  $('#auth-name-field').hidden = true;
  $('#auth-password-field').hidden = true;
  $('#auth-code-field').hidden = true;
  $('#auth-submit').disabled = true;
  $('#auth-submit-label').textContent = 'Sending code…';
  try {
    if (!csrfToken) await restoreAuthSession();
    const response = await fetch(authMode === 'register' ? '/api/auth/resend' : '/api/auth/login-code', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
      },
      body: JSON.stringify({ email: authEmail })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || 'Unable to resend the code.');
    $('#auth-code-field').hidden = false;
    $('#auth-code').required = true;
    authStep = 'verify';
    $('#auth-message').textContent = payload.message || 'A new code has been sent if the account is eligible.';
    $('#auth-message').dataset.kind = 'success';
    startResendCountdown();
  } catch (error) {
    authStep = 'verify';
    $('#auth-code-field').hidden = false;
    $('#auth-code').required = true;
    $('#auth-message').textContent = error.message || 'Unable to resend the code.';
  } finally {
    $('#auth-submit').disabled = false;
    $('#auth-submit-label').textContent = 'Verify code';
  }
}

async function signOut() {
  const button = $('#sign-out');
  button.disabled = true;
  try {
    if (!csrfToken) await restoreAuthSession();
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
      },
      body: '{}'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || 'Unable to sign out.');
    updateAuthUi(null);
    showToast('You have signed out.');
  } catch (error) {
    showToast(error.message || 'Unable to sign out. Please try again.');
  } finally {
    button.disabled = false;
  }
}

function openMovie(movie) {
  if (!movie) return;

  currentMovie = movie;
  lastProgressSavedAt = 0;
  progressRestoreFor = '';
  const requestId = ++movieRequestId;
  const mediaType = movie.tmdbType || (movie.id.startsWith('tmdb-tv-') ? 'tv' : 'movie');
  const tmdbId = movie.tmdbId || Number(String(movie.id).replace(/^tmdb-(movie|tv)-/, ''));
  const url = new URL(window.location.href);
  if (Number.isInteger(tmdbId) && tmdbId > 0) {
    url.searchParams.set('movie', `tmdb-${mediaType}-${tmdbId}`);
    history.pushState({ movieId: `tmdb-${mediaType}-${tmdbId}` }, '', url);
  }

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
  $('#dialog-favorite').textContent = favorites.includes(movie.id) ? '♥ In favourites' : '♡ Add to favourites';
  $('#dialog-trailer').hidden = true;
  $('#dialog-providers').textContent = 'Checking official streaming availability…';
  $('#playback-status').textContent = 'Playback availability is checked when you choose Play.';
  $('#dialog-play').disabled = false;
  $('#dialog-play').textContent = 'Play title';
  $('#dialog-download').hidden = true;
  clearPlayer();

  $('#movie-dialog').showModal();
  if (!Number.isInteger(tmdbId) || tmdbId < 1) {
    $('#dialog-providers').textContent = 'Streaming availability is not available for this title.';
    return;
  }
  loadMovieLinks(movie, tmdbId, mediaType, requestId);
}

async function loadMovieLinks(movie, tmdbId, mediaType, requestId) {
  const region = (/^[a-z]{2}-([A-Z]{2})$/.exec(navigator.language || '') || [])[1] || 'US';
  const providerPath = mediaType === 'tv' ? `tv/${tmdbId}/watch/providers` : `movie/${tmdbId}/watch/providers`;
  const [detailResult, videosResult, providersResult] = await Promise.allSettled([
    window.ZivaCatalogue.get(`${mediaType}/${tmdbId}`),
    window.ZivaCatalogue.get(`${mediaType}/${tmdbId}/videos`),
    window.ZivaCatalogue.get(providerPath)
  ]);
  if (requestId !== movieRequestId || !$('#movie-dialog').open) return;

  if (detailResult.status === 'fulfilled') {
    const detail = window.ZivaCatalogue.normalize(detailResult.value, 'movie');
    if (detail) {
      Object.assign(movie, detail);
      $('#dialog-title').textContent = detail.title;
      $('#dialog-description').textContent = detail.description;
      $('#dialog-meta').textContent = `★ ${detail.rating} · ${detail.year || 'Release date unavailable'} · ${detail.voteCount.toLocaleString()} ratings`;
      $('#dialog-genre').textContent = (detail.genres || [detail.genre]).join(' · ').toUpperCase();
    }
  }

  if (videosResult.status === 'fulfilled') {
    const trailer = (videosResult.value.results || []).find((video) =>
      video.site === 'YouTube' && video.type === 'Trailer' && video.official && video.key
    ) || (videosResult.value.results || []).find((video) =>
      video.site === 'YouTube' && video.type === 'Trailer' && video.key
    );
    if (trailer) {
      const link = $('#dialog-trailer');
      link.href = `https://www.youtube.com/watch?v=${encodeURIComponent(trailer.key)}`;
      link.textContent = `Watch ${trailer.official ? 'official ' : ''}trailer ↗`;
      link.hidden = false;
    }
  }

  const regionProviders = providersResult.status === 'fulfilled'
    ? providersResult.value.results && providersResult.value.results[region]
    : null;
  const providerLink = regionProviders && regionProviders.link;
  const providerNames = regionProviders
    ? [...(regionProviders.flatrate || []), ...(regionProviders.free || []), ...(regionProviders.ads || []), ...(regionProviders.rent || []), ...(regionProviders.buy || [])]
      .map((provider) => provider.provider_name)
      .filter((name, index, list) => name && list.indexOf(name) === index)
    : [];
  const providerNode = $('#dialog-providers');
  if (providersResult.status === 'rejected') {
    providerNode.textContent = `Streaming availability could not be checked for ${region}. Try again later.`;
    return;
  }
  if (providerLink && providerNames.length) {
    const link = safeExternalUrl(providerLink);
    if (link) {
      providerNode.replaceChildren(
        document.createTextNode(`Streaming options in ${region}: ${providerNames.join(', ')}. `)
      );
      const anchor = document.createElement('a');
      anchor.href = link;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.textContent = 'View availability';
      providerNode.append(anchor);
      return;
    }
  }
  providerNode.textContent = `Currently unavailable for streaming in ${region}.`;
}

let activeHlsPlayer = null;
function clearPlayer() {
  if (activeHlsPlayer) {
    activeHlsPlayer.destroy();
    activeHlsPlayer = null;
  }
  const video = $('#movie-player');
  delete video.dataset.contentId;
  video.pause();
  video.removeAttribute('src');
  video.load();
  $('#video-frame').hidden = true;
}

async function restorePlaybackProgress() {
  const video = $('#movie-player');
  const contentId = currentMovie && currentMovie.id;
  if (!authUser || !window.ZivaLibrary || !contentId || video.dataset.contentId !== contentId || progressRestoreFor === contentId) return;
  progressRestoreFor = contentId;
  try {
    const library = await window.ZivaLibrary.getLibrary();
    const history = (library.history || []).find((item) => item.content_id === contentId);
    if (history && history.position_seconds > 0 && video.duration > history.position_seconds + 5
        && currentMovie && currentMovie.id === contentId && video.dataset.contentId === contentId) {
      video.currentTime = history.position_seconds;
      $('#playback-status').textContent = `Resuming from ${Math.floor(history.position_seconds / 60)} min.`;
    }
  } catch {
    if (!progressSyncWarningShown) {
      showToast('Playback progress sync is unavailable until your library is configured.');
      progressSyncWarningShown = true;
    }
  }
}

async function savePlaybackProgress(force = false) {
  const video = $('#movie-player');
  const movie = currentMovie;
  const contentId = movie && movie.id;
  if (!authUser || !window.ZivaLibrary || !contentId || video.dataset.contentId !== contentId
      || progressSavePending || !Number.isFinite(video.duration) || video.duration <= 0
      || (!force && Date.now() - lastProgressSavedAt < 15000)) return;
  const positionSeconds = Math.min(Math.floor(video.currentTime), Math.floor(video.duration));
  if (positionSeconds <= 0) return;
  progressSavePending = true;
  lastProgressSavedAt = Date.now();
  try {
    await window.ZivaLibrary.recordProgress({
      mediaType: movie.tmdbType || 'movie',
      contentId,
      title: movie.title,
      positionSeconds,
      durationSeconds: Math.floor(video.duration)
    });
  } catch {
    if (!progressSyncWarningShown) {
      showToast('Playback is working, but watch history could not be synchronized.');
      progressSyncWarningShown = true;
    }
  } finally {
    progressSavePending = false;
  }
}

async function requestMoviePlayback() {
  if (!currentMovie) return;
  const button = $('#dialog-play');
  const status = $('#playback-status');
  button.disabled = true;
  button.textContent = 'Checking…';
  status.textContent = 'Checking your account and provider availability…';
  $('#dialog-download').hidden = true;

  try {
    const url = new URL('/api/playback/authorize', window.location.origin);
    url.searchParams.set('tmdbId', String(currentMovie.tmdbId));
    url.searchParams.set('mediaType', currentMovie.tmdbType || 'movie');
    const response = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
      status.textContent = 'Sign in with a verified account to check protected playback.';
      openAuthDialog('login');
      $('#auth-message').textContent = 'A verified account is required for playback. Sign in or use email-code sign-in.';
      return;
    }
    if (!response.ok || !payload.authorized || !payload.stream) {
      status.textContent = payload.message || 'This title is not currently available for playback.';
      return;
    }

    const streamUrl = safeExternalUrl(payload.stream.url);
    const streamType = payload.stream.type;
    if (!streamUrl || !['application/vnd.apple.mpegurl', 'application/x-mpegURL', 'video/mp4'].includes(streamType)) {
      status.textContent = 'The provider returned an unsupported playback source.';
      return;
    }
    const video = $('#movie-player');
    $('#video-frame').hidden = false;
    video.dataset.contentId = currentMovie.id;
    if (streamType.toLowerCase().includes('mpegurl') && !video.canPlayType(streamType)) {
      if (window.Hls && window.Hls.isSupported()) {
        activeHlsPlayer = new window.Hls();
        activeHlsPlayer.loadSource(streamUrl);
        activeHlsPlayer.attachMedia(video);
        activeHlsPlayer.on(window.Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) status.textContent = 'Playback failed. Please try again later.';
        });
      } else {
        $('#video-frame').hidden = true;
        status.textContent = 'HLS playback is not supported by this browser.';
        return;
      }
    } else {
      video.src = streamUrl;
    }
    status.textContent = 'Authorized stream ready. Playback begins when you press Play.';
    video.play().catch(() => {
      status.textContent = 'The stream is ready. Press Play to start playback.';
    });

    const download = payload.download;
    if (download && download.allowed === true && safeExternalUrl(download.url)) {
      const link = $('#dialog-download');
      link.href = safeExternalUrl(download.url);
      link.hidden = false;
    }
  } catch {
    status.textContent = 'Playback could not be checked. Please try again.';
  } finally {
    button.disabled = false;
    button.textContent = 'Play title';
  }
}

$('#movie-player').addEventListener('loadedmetadata', restorePlaybackProgress);
$('#movie-player').addEventListener('timeupdate', () => savePlaybackProgress());
$('#movie-player').addEventListener('pause', () => savePlaybackProgress(true));
$('#movie-player').addEventListener('ended', () => savePlaybackProgress(true));

function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

async function restoreSharedMovieLink() {
  const movieId = new URL(window.location.href).searchParams.get('movie');
  const match = /^tmdb-(movie|tv)-(\d+)$/.exec(movieId || '');
  if (!match || !window.ZivaCatalogue) return;
  try {
    const response = await window.ZivaCatalogue.get(`${match[1]}/${match[2]}`);
    const movie = window.ZivaCatalogue.normalize(response, match[1]);
    if (movie) {
      rememberMovies([movie]);
      openMovie(movie);
    }
  } catch {
    showToast('This shared movie page is temporarily unavailable.');
  }
}

async function shareMovie() {
  if (!currentMovie) return;
  const url = new URL(window.location.href);
  try {
    if (navigator.share) {
      await navigator.share({ title: currentMovie.title, url: url.href });
    } else {
      await navigator.clipboard.writeText(url.href);
      showToast('Movie link copied.');
    }
  } catch (error) {
    if (error.name !== 'AbortError') showToast('Unable to share this movie link.');
  }
}

function rememberMovies(items) {
  items.forEach((movie) => knownMovies.set(movie.id, movie));
}

function toggleWatchlist(id) {
  const movie = knownMovies.get(id);
  if (!movie) return;

  const removing = watchlist.includes(id);
  if (removing) {
    watchlist = watchlist.filter((item) => item !== id);
    showToast(`Removed ${movie.title} from your list.`);
  } else {
    watchlist.push(id);
    showToast(`Added ${movie.title} to your list.`);
  }

  saveWatchlist();
  syncLibraryItem(movie, removing ? 'remove' : 'upsert');
  render();

  if (currentMovie?.id === id) {
    $('#dialog-save').textContent = watchlist.includes(id)
      ? '✓ In my list'
      : '＋ Add to my list';
  }
}

function toggleFavorite(id) {
  const movie = knownMovies.get(id);
  if (!movie) return;
  const removing = favorites.includes(id);
  favorites = removing ? favorites.filter((item) => item !== id) : [...favorites, id];
  saveLocalCollection(favoritesKey, favorites);
  syncLibraryItem(movie, removing ? 'remove' : 'upsert', 'favorite');
  if (currentMovie && currentMovie.id === id) {
    $('#dialog-favorite').textContent = favorites.includes(id) ? '♥ In favourites' : '♡ Add to favourites';
  }
  render();
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

const genreLabels = {
  action: 'Action', comedy: 'Comedy', family: 'Family', adventure: 'Adventure',
  animation: 'Animation', drama: 'Drama', horror: 'Horror', romance: 'Romance',
  'sci-fi': 'Sci-Fi', thriller: 'Thriller', documentary: 'Documentary'
};

function configurePage() {
  const context = getPageContext();
  currentPage = context.page;
  currentMediaType = context.mediaType;
  currentGenreSlug = context.genreSlug || '';
  selectedGenreId = '';
  const home = currentPage === 'home';
  const watchlistPage = currentPage === 'watchlist';
  const genrePage = currentPage === 'genre';
  const pageTitles = {
    movies: ['Movies', 'Explore movies, ratings, release dates and more.'],
    series: ['Series', 'Explore television series and their latest details.'],
    genre: [genreLabels[currentGenreSlug] || 'Genre', 'Browse this genre as movies or series.'],
    watchlist: ['My Watchlist', 'Your saved movies and series on this device.']
  };
  $('.hero').hidden = !home;
  $('.promo').hidden = !home;
  $('#watchlist').hidden = !watchlistPage;
  $('#catalogue-sections').hidden = watchlistPage;
  $('#page-heading').hidden = home || watchlistPage;
  $('#catalogue-controls').hidden = !(currentPage === 'movies' || currentPage === 'series' || genrePage);
  $('#genre-filter-wrap').hidden = genrePage;
  $('#media-switch').hidden = !genrePage;
  if (!home && !watchlistPage) {
    $('#page-title').textContent = pageTitles[currentPage][0];
    $('#page-description').textContent = pageTitles[currentPage][1];
  }
  if (watchlistPage) {
    $('#page-heading').hidden = false;
    $('#page-title').textContent = pageTitles.watchlist[0];
    $('#page-description').textContent = pageTitles.watchlist[1];
    $('#watchlist').hidden = false;
  }
  for (const link of $('#navigation').querySelectorAll('a[href]')) {
    const active = link.pathname === window.location.pathname;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  $('#media-switch').querySelectorAll('[data-media-type]').forEach((button) => {
    const active = button.dataset.mediaType === currentMediaType;
    button.setAttribute('aria-pressed', String(active));
  });
}

function setGenreOptions(genres) {
  const select = $('#genre-filter');
  select.replaceChildren(new Option('All genres', ''));
  for (const genre of genres) {
    select.add(new Option(genre.name, String(genre.id)));
  }
  select.value = selectedGenreId;
}

async function loadLiveCatalogue() {
  if (!window.ZivaCatalogue) {
    throw new Error('ZIVA catalogue client did not load.');
  }

  const genresResponse = await window.ZivaCatalogue.get(`genre/${currentMediaType}/list`);
  catalogueGenres = genresResponse.genres || [];
  window.ZivaCatalogue.setGenres(catalogueGenres);
  setGenreOptions(catalogueGenres);
  if (currentPage === 'genre') {
    currentGenreId = window.ZivaCatalogueSections.resolveGenreId(currentGenreSlug, currentMediaType, catalogueGenres);
    selectedGenreId = currentGenreId ? String(currentGenreId) : '';
  } else {
    selectedGenreId = $('#genre-filter').value;
    currentGenreId = selectedGenreId ? Number(selectedGenreId) : null;
  }
  catalogueSections = [window.ZivaCatalogueSections.createPageSection({
    page: currentPage === 'home' ? 'home' : currentPage === 'genre' ? 'genre' : currentPage,
    mediaType: currentMediaType,
    genreId: currentGenreId
  })];
  if (currentPage === 'genre') catalogueSections[0].title = pageTitlesForGenre(currentGenreSlug);
  renderCatalogueShell(catalogueSections);
  catalogueMode = 'live';

  $('#tmdb-attribution').hidden = false;
  if (currentPage === 'genre' && !currentGenreId) {
    catalogueSections[0].error = `TMDB has no matching ${currentMediaType === 'tv' ? 'series' : 'movie'} genre for ${pageTitlesForGenre(currentGenreSlug)}.`;
    render();
    setCatalogueStatus(catalogueSections[0].error, 'error');
  } else {
    setCatalogueStatus(`Showing live ${currentMediaType === 'tv' ? 'series' : 'movie'} metadata from TMDB.`, 'live');
    await loadSection(catalogueSections[0], 1);
  }
  await restoreSavedTmdbTitles();
  render();
  await restoreSharedMovieLink();
}

function pageTitlesForGenre(slug) {
  return genreLabels[slug] || 'Genre';
}

async function runSearch(query, page = 1) {
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

  searchLoading = true;
  searchError = '';
  render();
  setCatalogueStatus(`Searching TMDB for “${query}”…`, 'live');

  try {
    const response = await window.ZivaCatalogue.search(query, page, currentMediaType);

    if ($('#search-input').value.trim() !== query) return;

    searchResults = page === 1
      ? response.items
      : window.ZivaCatalogue.unique((searchResults || []).concat(response.items));
    searchPage = response.page;
    searchTotalPages = response.totalPages;
    rememberMovies(response.items);

    setCatalogueStatus(
      `${searchResults.length} search results from TMDB`,
      'live'
    );
  } catch {
    searchError = 'TMDB search is temporarily unavailable. Try again shortly.';
    if (page === 1) searchResults = [];
    setCatalogueStatus(searchError, 'error');
  } finally {
    searchLoading = false;
    render();
  }
}

async function loadMoreSearch() {
  const query = $('#search-input').value.trim();
  if (query && searchPage < searchTotalPages && !searchLoading) {
    await runSearch(query, searchPage + 1);
  }
}

async function initializeCatalogue() {
  configurePage();
  render();
  try {
    const response = await fetch('/api/status', {
      headers: { Accept: 'application/json' }
    });

    if (!response.ok) {
      throw new Error('Could not read API status.');
    }

    const status = await response.json();

    if (!status.tmdbConfigured) {
      catalogueMode = 'unavailable';
      setCatalogueStatus('The live TMDB catalogue is unavailable. Configure TMDB_API_READ_ACCESS_TOKEN on the server.', 'error');
      return;
    }

    if (currentPage === 'watchlist') {
      catalogueMode = 'live';
      $('#tmdb-attribution').hidden = false;
      setCatalogueStatus('Your saved titles are stored on this device.', 'live');
      await restoreSavedTmdbTitles();
      render();
      return;
    }

    await loadLiveCatalogue();

  } catch (error) {
    catalogueMode = 'unavailable';
    setCatalogueStatus(error.message || 'The live movie catalogue is temporarily unavailable.', 'error');
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

  const favoriteButton = event.target.closest('[data-favorite]');
  if (favoriteButton) {
    event.stopPropagation();
    toggleFavorite(favoriteButton.dataset.favorite);
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
    if ($('#auth-dialog').open) $('#auth-dialog').close();
  }
});

document.addEventListener('click', (event) => {
  const sectionButton = event.target.closest('[data-load-section]');
  if (sectionButton) {
    const section = catalogueSections.find((item) => item.key === sectionButton.dataset.loadSection);
    if (searchResults !== null && section && section.key === 'trending') loadMoreSearch();
    else if (section) loadSection(section);
    return;
  }
  if (event.target.closest('#catalogue-trending [data-load-section]') && searchResults !== null) {
    loadMoreSearch();
  }
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
        ? `Showing live TMDB ${currentMediaType === 'tv' ? 'series' : 'movie'} metadata.`
        : 'Live catalogue is not configured.',
      catalogueMode
    );

    return;
  }

  if (catalogueMode === 'live') {
    searchTimer = setTimeout(() => runSearch(query), 350);
  }
});

$('#menu-toggle').addEventListener('click', () => {
  const expanded = $('#menu-toggle').getAttribute('aria-expanded') === 'true';
  $('#navigation').classList.toggle('open', !expanded);
  $('#menu-toggle').setAttribute('aria-expanded', String(!expanded));
});

$('#navigation').addEventListener('click', (event) => {
  if (event.target.closest('a')) {
    $('#navigation').classList.remove('open');
    $('#menu-toggle').setAttribute('aria-expanded', 'false');
  }
});

$('#genre-filter').addEventListener('change', async (event) => {
  selectedGenreId = event.target.value;
  currentGenreId = selectedGenreId ? Number(selectedGenreId) : null;
  searchResults = null;
  searchError = '';
  searchPage = 1;
  if ($('#search-input').value.trim()) {
    await runSearch($('#search-input').value.trim());
    return;
  }
  catalogueSections = [window.ZivaCatalogueSections.createPageSection({
    page: currentPage,
    mediaType: currentMediaType,
    genreId: currentGenreId
  })];
  if (currentPage === 'home') catalogueSections[0].path = 'trending/movie/week';
  renderCatalogueShell(catalogueSections);
  setCatalogueStatus(`Loading ${currentMediaType === 'tv' ? 'series' : 'movies'}…`, 'live');
  await loadSection(catalogueSections[0], 1);
});

$('#media-switch').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-media-type]');
  if (!button || button.dataset.mediaType === currentMediaType) return;
  currentMediaType = button.dataset.mediaType;
  const url = new URL(window.location.href);
  url.searchParams.set('media', currentMediaType);
  url.searchParams.delete('movie');
  history.pushState({}, '', url);
  $('#media-switch').querySelectorAll('[data-media-type]').forEach((item) => {
    item.setAttribute('aria-pressed', String(item.dataset.mediaType === currentMediaType));
  });
  searchResults = null;
  searchPage = 1;
  await loadLiveCatalogue();
});

$('.watchlist-filter').addEventListener('click', (event) => {
  const button = event.target.closest('[data-watchlist-type]');
  if (!button) return;
  watchlistFilter = button.dataset.watchlistType;
  $('.watchlist-filter').querySelectorAll('[data-watchlist-type]').forEach((item) => {
    item.setAttribute('aria-pressed', String(item === button));
  });
  render();
});

$('#dialog-close').addEventListener('click', () => {
  $('#movie-dialog').close();
});

$('#movie-dialog').addEventListener('click', (event) => {
  if (event.target === $('#movie-dialog')) {
    $('#movie-dialog').close();
  }
});
$('#movie-dialog').addEventListener('close', clearPlayer);

$('#dialog-save').addEventListener('click', () => {
  if (currentMovie) {
    toggleWatchlist(currentMovie.id);
  }
});

$('#dialog-favorite').addEventListener('click', () => {
  if (currentMovie) toggleFavorite(currentMovie.id);
});

$('#dialog-share').addEventListener('click', shareMovie);
$('#dialog-play').addEventListener('click', requestMoviePlayback);

$('#featured-button').addEventListener('click', () => {
  const trending = catalogueSections.find((section) => section.key === 'trending');
  if (trending && trending.items.length) openMovie(trending.items[0]);
  else showToast('Featured movies are not available right now.');
});

$('#sign-in').addEventListener('click', () => {
  if (authUser) {
    $('#profile-name').textContent = authUser.fullName || 'ZIVA member';
    $('#profile-email').textContent = authUser.email || '';
    $('#profile-dialog').showModal();
  } else {
    openAuthDialog('login');
  }
});

$('#sign-out').addEventListener('click', signOut);
$('#profile-logout').addEventListener('click', async () => {
  await signOut();
  if (!authUser) $('#profile-dialog').close();
});
$('#profile-close').addEventListener('click', () => $('#profile-dialog').close());
$('#auth-form').addEventListener('submit', submitAuth);
$('#auth-mode-toggle').addEventListener('click', () => {
  setAuthMode(authMode === 'login' ? 'register' : 'login');
  (authMode === 'register' ? $('#auth-name') : $('#auth-email')).focus();
});
$('#auth-method-toggle').addEventListener('click', () => {
  loginMethod = loginMethod === 'password' ? 'code' : 'password';
  const useCode = loginMethod === 'code';
  $('#auth-password-field').hidden = useCode;
  $('#auth-password').required = !useCode;
  $('#auth-password').value = '';
  $('#auth-method-toggle').textContent = useCode
    ? 'Use your password instead'
    : 'Use a one-time email code instead';
  $('#auth-description').textContent = useCode
    ? 'We’ll send a one-time code to your email address.'
    : 'Sign in with your email and password, or choose email-code sign-in.';
  $('#auth-submit-label').textContent = useCode ? 'Send sign-in code' : 'Sign in';
  $('#auth-message').textContent = '';
  $('#auth-email').focus();
});
$('#auth-password-toggle').addEventListener('click', () => {
  const input = $('#auth-password');
  const visible = input.type === 'password';
  input.type = visible ? 'text' : 'password';
  $('#auth-password-toggle').textContent = visible ? 'Hide' : 'Show';
  $('#auth-password-toggle').setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
  $('#auth-password-toggle').setAttribute('aria-pressed', String(visible));
});
$('#auth-resend').addEventListener('click', resendAuthCode);
$('#auth-close').addEventListener('click', () => $('#auth-dialog').close());
$('#auth-dialog').addEventListener('click', (event) => {
  if (event.target === $('#auth-dialog')) $('#auth-dialog').close();
});
$('#movie-dialog').addEventListener('close', () => {
  const url = new URL(window.location.href);
  if (url.searchParams.has('movie')) {
    url.searchParams.delete('movie');
    history.replaceState({}, '', url);
  }
});
window.addEventListener('popstate', () => {
  const movieId = new URL(window.location.href).searchParams.get('movie');
  const match = /^tmdb-(movie|tv)-(\d+)$/.exec(movieId || '');
  if (!match) {
    if ($('#movie-dialog').open) $('#movie-dialog').close();
    return;
  }
  if ($('#movie-dialog').open) $('#movie-dialog').close();
  window.ZivaCatalogue.get(`${match[1]}/${match[2]}`).then((raw) => {
    const movie = window.ZivaCatalogue.normalize(raw, match[1]);
    if (movie) {
      rememberMovies([movie]);
      openMovie(movie);
    }
  }).catch(() => showToast('This shared movie page is temporarily unavailable.'));
});

render();
initializeCatalogue();
restoreAuthSession();
const requestedAuthMode = new URLSearchParams(window.location.search).get('auth');
if (requestedAuthMode === 'login' || requestedAuthMode === 'register') openAuthDialog(requestedAuthMode);
