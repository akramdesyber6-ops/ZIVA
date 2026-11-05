'use strict';

(() => {
  const $ = (selector) => document.querySelector(selector);
  const grid = $('#anime-grid');
  const status = $('#anime-status');
  const search = $('#anime-search');
  const genre = $('#anime-genre');
  const sort = $('#anime-sort');
  const more = $('#anime-more');
  const cards = new Map();
  const savedKey = 'ziva-anime-watchlist';
  const favoritesKey = 'ziva-anime-favorites';
  let page = 1;
  let hasNextPage = false;
  let timer;
  let loading = false;
  let selectedAnime = null;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[character]));
  }

  function savedAnime() {
    try {
      const value = JSON.parse(localStorage.getItem(savedKey) || '[]');
      return new Set(Array.isArray(value) ? value.filter(Number.isSafeInteger) : []);
    } catch {
      return new Set();
    }
  }

  function animeFavorites() {
    try {
      const value = JSON.parse(localStorage.getItem(favoritesKey) || '[]');
      return new Set(Array.isArray(value) ? value.filter(Number.isSafeInteger) : []);
    } catch {
      return new Set();
    }
  }

  function render(items, append = false) {
    if (!append) cards.clear();
    for (const item of items) cards.set(item.id, item);
    const saved = savedAnime();
    const favorites = animeFavorites();
    const markup = items.map((item) => `
      <article class="movie-card anime-card" data-anime-id="${item.id}" tabindex="0" aria-label="View ${escapeHtml(item.title)} details">
        <div class="poster">
          ${item.image ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)} poster" loading="lazy">` : '<span class="poster-placeholder"></span>'}
          <span class="rating">${item.rating === null ? '—' : `★ ${item.rating.toFixed(1)}`}</span>
          <button class="save-button ${saved.has(item.id) ? 'saved' : ''}" type="button" data-anime-save="${item.id}" aria-label="${saved.has(item.id) ? 'Remove from' : 'Add to'} anime watchlist">${saved.has(item.id) ? '✓' : '+'}</button>
          <button class="favorite-button ${favorites.has(item.id) ? 'saved' : ''}" type="button" data-anime-favorite="${item.id}" aria-label="${favorites.has(item.id) ? 'Remove from' : 'Add to'} anime favourites">♥</button>
          <span class="poster-label">${escapeHtml(item.format || 'Anime')}</span>
        </div>
        <h3>${escapeHtml(item.title)}</h3>
        <small>${item.year || 'Release year unknown'}${item.episodes ? ` · ${item.episodes} episodes` : ''}</small>
      </article>
    `).join('');
    grid.insertAdjacentHTML(append ? 'beforeend' : 'afterbegin', markup);
    if (append) {
      const empty = grid.querySelector('.empty-state');
      if (empty) empty.remove();
    }
  }

  async function load({ next = false } = {}) {
    if (loading) return;
    loading = true;
    const requestedPage = next ? page + 1 : 1;
    if (!next) {
      page = 1;
      grid.replaceChildren();
    }
    status.textContent = 'Loading anime catalogue…';
    more.hidden = true;
    try {
      const params = new URLSearchParams({
        mode: search.value.trim() ? 'search' : sort.value,
        page: String(requestedPage)
      });
      if (search.value.trim()) params.set('query', search.value.trim());
      if (genre.value) params.set('genre', genre.value);
      const response = await fetch(window.zivaApiUrl(`/api/anime?${params}`), { headers: { Accept: 'application/json' } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || `Anime catalogue request failed (${response.status}).`);
      const items = data.items || [];
      if (!items.length && !next) {
        grid.innerHTML = '<p class="empty-state">No anime titles matched those filters.</p>';
      } else {
        render(items, next);
      }
      page = data.page || requestedPage;
      hasNextPage = Boolean(data.hasNextPage);
      more.hidden = !hasNextPage;
      status.textContent = search.value.trim()
        ? `Search results for “${search.value.trim()}”`
        : `Showing ${sort.value} anime${genre.value ? ` · ${genre.value}` : ''}.`;
    } catch (error) {
      if (!next) grid.innerHTML = '<p class="empty-state">Anime could not be loaded. Check your connection and try again.</p>';
      status.textContent = error.message || 'The anime catalogue is temporarily unavailable.';
    } finally {
      loading = false;
    }
  }

  function openDetail(item) {
    selectedAnime = item;
    const dialog = $('#anime-dialog');
    $('#anime-detail-title').textContent = item.title;
    $('#anime-detail-meta').textContent = [
      item.rating === null ? 'Rating unavailable' : `★ ${item.rating.toFixed(1)}`,
      item.year || 'Release year unavailable',
      item.episodes ? `${item.episodes} episodes` : 'Episode count unavailable',
      item.season,
      item.status
    ].filter(Boolean).join(' · ');
    $('#anime-detail-description').textContent = item.description || 'No description is available from AniList.';
    $('#anime-detail-genres').textContent = item.genres.join(' · ') || 'Genres unavailable';
    $('#anime-favorite').textContent = animeFavorites().has(item.id) ? '♥ In favourites' : '♡ Add to favourites';
    const art = $('#anime-detail-art');
    art.style.backgroundImage = item.banner ? `url("${item.banner}")` : item.image ? `url("${item.image}")` : 'none';
    dialog.showModal();
  }

  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => load(), 300);
  });
  genre.addEventListener('change', () => load());
  sort.addEventListener('change', () => load());
  more.addEventListener('click', () => load({ next: true }));
  grid.addEventListener('click', (event) => {
    const saveButton = event.target.closest('[data-anime-save]');
    if (saveButton) {
      event.stopPropagation();
      const id = Number(saveButton.dataset.animeSave);
      const saved = savedAnime();
      if (saved.has(id)) saved.delete(id);
      else saved.add(id);
      try {
        localStorage.setItem(savedKey, JSON.stringify([...saved]));
        saveButton.classList.toggle('saved', saved.has(id));
        saveButton.textContent = saved.has(id) ? '✓' : '+';
        saveButton.setAttribute('aria-label', `${saved.has(id) ? 'Remove from' : 'Add to'} anime watchlist`);
        const item = cards.get(id);
        if (window.ZivaLibrary && item) {
          window.ZivaLibrary.save({
            mediaType: 'anime',
            contentId: `anilist-${id}`,
            metadata: { title: item.title, year: item.year, image: item.image }
          }, saved.has(id) ? 'upsert' : 'remove').catch(() => {
            status.textContent = 'Saved on this device. Cloud library sync is temporarily unavailable.';
          });
        }
      } catch {
        status.textContent = 'This browser cannot save the anime watchlist.';
      }
      return;
    }
    const favoriteButton = event.target.closest('[data-anime-favorite]');
    if (favoriteButton) {
      event.stopPropagation();
      const id = Number(favoriteButton.dataset.animeFavorite);
      const favorites = animeFavorites();
      const removing = favorites.has(id);
      if (removing) favorites.delete(id);
      else favorites.add(id);
      try {
        localStorage.setItem(favoritesKey, JSON.stringify([...favorites]));
        favoriteButton.classList.toggle('saved', !removing);
        favoriteButton.setAttribute('aria-label', `${removing ? 'Add to' : 'Remove from'} anime favourites`);
        $('#anime-favorite').textContent = removing ? '♡ Add to favourites' : '♥ In favourites';
        const item = cards.get(id);
        if (window.ZivaLibrary && item) {
          window.ZivaLibrary.save({
            mediaType: 'anime',
            contentId: `anilist-${id}`,
            metadata: { title: item.title, year: item.year, image: item.image }
          }, removing ? 'remove' : 'upsert', 'favorite').catch(() => {
            status.textContent = 'Saved on this device. Cloud library sync is temporarily unavailable.';
          });
        }
      } catch {
        status.textContent = 'This browser cannot save anime favourites.';
      }
      return;
    }
    const card = event.target.closest('[data-anime-id]');
    if (card) openDetail(cards.get(Number(card.dataset.animeId)));
  });
  grid.addEventListener('keydown', (event) => {
    if (event.target.matches('[data-anime-id]') && ['Enter', ' '].includes(event.key)) {
      event.preventDefault();
      openDetail(cards.get(Number(event.target.dataset.animeId)));
    }
  });
  $('#anime-dialog-close').addEventListener('click', () => $('#anime-dialog').close());
  $('#anime-favorite').addEventListener('click', () => {
    if (!selectedAnime) return;
    const favorites = animeFavorites();
    const removing = favorites.has(selectedAnime.id);
    if (removing) favorites.delete(selectedAnime.id);
    else favorites.add(selectedAnime.id);
    try {
      localStorage.setItem(favoritesKey, JSON.stringify([...favorites]));
      $('#anime-favorite').textContent = removing ? '♡ Add to favourites' : '♥ In favourites';
      const button = grid.querySelector(`[data-anime-favorite="${selectedAnime.id}"]`);
      if (button) button.classList.toggle('saved', !removing);
      if (window.ZivaLibrary) {
        window.ZivaLibrary.save({
          mediaType: 'anime',
          contentId: `anilist-${selectedAnime.id}`,
          metadata: { title: selectedAnime.title, year: selectedAnime.year, image: selectedAnime.image }
        }, removing ? 'remove' : 'upsert', 'favorite').catch(() => {
          status.textContent = 'Saved on this device. Cloud library sync is temporarily unavailable.';
        });
      }
    } catch {
      status.textContent = 'This browser cannot save anime favourites.';
    }
  });
  $('#anime-dialog').addEventListener('click', (event) => {
    if (event.target === $('#anime-dialog')) $('#anime-dialog').close();
  });
  $('#anime-menu-toggle').addEventListener('click', () => {
    const expanded = $('#anime-menu-toggle').getAttribute('aria-expanded') === 'true';
    document.querySelector('.anime-page .nav').classList.toggle('open', !expanded);
    $('#anime-menu-toggle').setAttribute('aria-expanded', String(!expanded));
  });

  load();
})();
