'use strict';
(function attachZivaCatalogue(global) {
  const cache = new Map();
  const requests = new Map();
  const CACHE_TTL_MS = 30_000;
  const MAX_CACHE_ENTRIES = 200;
  const GENRES = {
    12:'Adventure',14:'Fantasy',16:'Animation',18:'Drama',27:'Horror',28:'Action',35:'Comedy',36:'History',37:'Western',53:'Thriller',80:'Crime',99:'Documentary',878:'Sci-Fi',9648:'Mystery',10402:'Music',10749:'Romance',10751:'Family',10752:'War',10759:'Action',10762:'Kids',10763:'News',10764:'Reality',10765:'Sci-Fi',10766:'Drama',10767:'Talk',10768:'War'
  };
  const genreNames = { ...GENRES };
  function imageUrl(file, size = 'w500') { return file ? `https://image.tmdb.org/t/p/${size}${file}` : ''; }
  function setGenres(genres) {
    for (const genre of genres || []) {
      if (Number.isInteger(genre.id) && typeof genre.name === 'string') genreNames[genre.id] = genre.name;
    }
  }
  function normalize(item, hint) {
    const kind = item.media_type || hint || (item.first_air_date && !item.release_date ? 'tv' : 'movie');
    const title = item.title || item.name;
    if (!['movie','tv'].includes(kind) || !item.id || typeof title !== 'string' || !title.trim()) return null;
    const date = item.release_date || item.first_air_date || '';
    const genreId = Array.isArray(item.genre_ids) ? item.genre_ids[0] : Array.isArray(item.genres) ? item.genres[0]?.id : null;
    const rating = Number(item.vote_average);
    return {
      id: `tmdb-${kind}-${item.id}`, tmdbId: item.id, tmdbType: kind,
      title: title.trim(), originalTitle: item.original_title || item.original_name || '',
      year: date ? Number(date.slice(0,4)) || '' : '', releaseDate: date,
      genre: item.genres?.[0]?.name || genreNames[genreId] || (kind === 'tv' ? 'Series' : 'Movie'),
      genres: (item.genre_ids || item.genres?.map((g) => g.id) || []).map((id) => genreNames[id]).filter(Boolean),
      genreIds: item.genre_ids || item.genres?.map((g) => g.id) || [],
      rating: Number.isFinite(rating) && rating > 0 ? rating.toFixed(1) : '', voteCount: item.vote_count || 0,
      popularity: item.popularity || 0, type: kind === 'tv' ? 'Series' : 'Movie',
      description: item.overview || 'No description is available yet.',
      image: imageUrl(item.poster_path), backdrop: imageUrl(item.backdrop_path, 'w1280')
    };
  }
  function makeCacheKey(route, params) {
    const ordered = Object.keys(params).sort().map((key) => `${key}=${String(params[key])}`).join('&');
    return `${route}?${ordered}`;
  }
  async function get(route, params = {}, { signal, forceRefresh = false } = {}) {
    const cacheKey = makeCacheKey(route, params);
    const cached = cache.get(cacheKey);
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.value;
    if (!signal && requests.has(cacheKey)) return requests.get(cacheKey);

    const url = new URL('/api/tmdb', global.location.origin);
    url.searchParams.set('path', route);
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    const headers = { Accept:'application/json' };
    if (forceRefresh) headers['Cache-Control'] = 'no-cache';
    const request = (async () => {
      const response = await fetch(url, { headers, signal });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || `Catalogue request failed (${response.status})`);
      cache.delete(cacheKey);
      cache.set(cacheKey, { value: body, expiresAt: Date.now() + CACHE_TTL_MS });
      while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
      return body;
    })();

    if (signal) return request;
    requests.set(cacheKey, request);
    try {
      return await request;
    } finally {
      if (requests.get(cacheKey) === request) requests.delete(cacheKey);
    }
  }
  function normalizeList(items, hint) { return unique((items || []).map((item) => normalize(item, hint)).filter(Boolean)); }
  function unique(items) { const seen = new Set(); return items.filter((item) => !seen.has(item.id) && seen.add(item.id)); }
  async function search(query, page = 1, mediaType = 'movie', options = {}) {
    if (!['movie', 'tv'].includes(mediaType)) throw new Error('Unsupported catalogue type.');
    const data = await get(`search/${mediaType}`, { query, page, include_adult:false }, options);
    return {
      items: normalizeList(data.results, mediaType),
      page: Number(data.page) || page,
      totalPages: Math.min(Number(data.total_pages) || 1, 500)
    };
  }
  global.ZivaCatalogue = { get, normalize, normalizeList, unique, search, imageUrl, setGenres };
})(window);
