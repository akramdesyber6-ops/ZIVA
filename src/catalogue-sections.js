'use strict';

(function attachCatalogueSections(global) {
  const GENRES = {
    action: { movie: 28, tv: 10759 },
    comedy: { movie: 35, tv: 35 },
    family: { movie: 10751, tv: 10751 },
    adventure: { movie: 12 },
    animation: { movie: 16, tv: 16 },
    drama: { movie: 18, tv: 18 },
    horror: { movie: 27 },
    romance: { movie: 10749, tv: 10749 },
    'sci-fi': { movie: 878, tv: 10765 },
    thriller: { movie: 53 },
    documentary: { movie: 99, tv: 99 }
  };

  function resolveGenreId(slug, mediaType, genres = []) {
    const expectedId = GENRES[slug] && GENRES[slug][mediaType];
    if (!expectedId) return null;
    const genre = genres.find((item) => item.id === expectedId);
    return genre ? genre.id : null;
  }

  function createPageSection({ page, mediaType, genreId = null }) {
    const isGenre = page === 'genre';
    const path = page === 'home'
      ? 'trending/movie/week'
      : genreId
        ? `discover/${mediaType}`
        : `${mediaType}/popular`;
    const params = genreId ? { with_genres: genreId } : {};
    return {
      key: 'catalogue',
      title: page === 'home'
        ? 'Trending Movies'
        : isGenre
          ? 'Genre titles'
          : mediaType === 'tv' ? 'Popular Series' : 'Popular Movies',
      path,
      params,
      mediaType,
      items: [],
      page: 0,
      totalPages: 0,
      loading: false,
      error: ''
    };
  }

  function unique(items) {
    const seen = new Set();
    return items.filter((item) => !seen.has(item.id) && seen.add(item.id));
  }

  function nextPage(section) {
    if (!section || section.loading || section.page >= section.totalPages) return null;
    return section.page + 1;
  }

  const api = { GENRES, createPageSection, resolveGenreId, unique, nextPage };
  global.ZivaCatalogueSections = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
