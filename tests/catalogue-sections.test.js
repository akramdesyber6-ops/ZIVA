'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createPageSection,
  resolveGenreId,
  unique,
  nextPage
} = require('../src/catalogue-sections');
const { validatePath, buildUrl } = require('../lib/tmdb');

test('home, movies, series and genre catalogues use distinct TMDB endpoints', () => {
  assert.equal(createPageSection({ page: 'home', mediaType: 'movie' }).path, 'trending/movie/week');
  assert.equal(createPageSection({ page: 'movies', mediaType: 'movie' }).path, 'movie/popular');
  assert.equal(createPageSection({ page: 'series', mediaType: 'tv' }).path, 'tv/popular');
  const movieGenre = createPageSection({ page: 'genre', mediaType: 'movie', genreId: 28 });
  const tvGenre = createPageSection({ page: 'genre', mediaType: 'tv', genreId: 10759 });
  assert.equal(movieGenre.path, 'discover/movie');
  assert.equal(movieGenre.params.with_genres, 28);
  assert.equal(tvGenre.path, 'discover/tv');
  assert.equal(tvGenre.params.with_genres, 10759);
});

test('genre filters use the matching movie or TV genre taxonomy', () => {
  const movieGenres = [{ id: 28, name: 'Action' }, { id: 878, name: 'Science Fiction' }];
  const tvGenres = [{ id: 10759, name: 'Action & Adventure' }, { id: 10765, name: 'Sci-Fi & Fantasy' }];
  assert.equal(resolveGenreId('action', 'movie', movieGenres), 28);
  assert.equal(resolveGenreId('action', 'tv', tvGenres), 10759);
  assert.equal(resolveGenreId('sci-fi', 'movie', movieGenres), 878);
  assert.equal(resolveGenreId('sci-fi', 'tv', tvGenres), 10765);
  assert.equal(resolveGenreId('horror', 'tv', tvGenres), null);
  assert.equal(resolveGenreId('action', 'tv', movieGenres), null);
});

test('catalogue result deduplication preserves first occurrence and media identity', () => {
  const movies = [{ id: 'tmdb-movie-1' }, { id: 'tmdb-movie-2' }];
  const series = [{ id: 'tmdb-tv-1' }, { id: 'tmdb-tv-2' }];
  assert.deepEqual(unique(movies.concat([{ id: 'tmdb-movie-1' }])).map((item) => item.id), ['tmdb-movie-1', 'tmdb-movie-2']);
  assert.deepEqual(unique(movies.concat(series)).map((item) => item.id), [
    'tmdb-movie-1', 'tmdb-movie-2', 'tmdb-tv-1', 'tmdb-tv-2'
  ]);
});

test('pagination advances until the reported final page and blocks concurrent requests', () => {
  const section = { page: 0, totalPages: 4, loading: false };
  assert.equal(nextPage(section), 1);
  section.page = 1;
  assert.equal(nextPage(section), 2);
  section.loading = true;
  assert.equal(nextPage(section), null);
  section.loading = false;
  section.page = 4;
  assert.equal(nextPage(section), null);
});

test('TMDB allowlist supports movie and TV browse, detail, genre and provider routes', () => {
  for (const route of [
    'discover/movie', 'discover/tv', 'movie/popular', 'tv/popular',
    'genre/movie/list', 'genre/tv/list', 'movie/123/watch/providers',
    'tv/123/watch/providers', 'movie/123/videos', 'tv/123/videos',
    'search/movie', 'search/tv'
  ]) {
    assert.equal(validatePath(route), route);
  }
  assert.equal(validatePath('search/multi'), 'search/multi');
  assert.throws(() => validatePath('discover/person'));
});

test('TMDB query validation supports numeric genre filters and pagination', () => {
  const url = buildUrl('discover/tv', { with_genres: '10759', page: '2', sort_by: 'popularity.desc' });
  assert.equal(url.searchParams.get('with_genres'), '10759');
  assert.equal(url.searchParams.get('page'), '2');
  assert.throws(() => buildUrl('discover/movie', { with_genres: '28 OR 1=1' }));
  assert.throws(() => buildUrl('discover/tv', { page: '501' }));
});
