'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AniListError, ENDPOINT, normalizeAnime, parseRequest, requestAniList } = require('../lib/anilist');

test('AniList adapter normalizes metadata and strips description markup', () => {
  const anime = normalizeAnime({
    id: 21,
    title: { english: 'ZIVA Story', romaji: 'Ziva Monogatari' },
    description: 'A <b>story</b> &amp; a journey.',
    coverImage: { large: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large.jpg' },
    bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner.jpg',
    averageScore: 87,
    episodes: 12,
    season: 'FALL',
    seasonYear: 2025,
    genres: ['Adventure', 'Drama'],
    format: 'TV',
    status: 'FINISHED'
  });
  assert.equal(anime.id, 21);
  assert.equal(anime.title, 'ZIVA Story');
  assert.equal(anime.description, 'A story &amp; a journey.');
  assert.equal(anime.rating, 8.7);
  assert.equal(anime.episodes, 12);
  assert.equal(anime.year, 2025);
  assert.deepEqual(anime.genres, ['Adventure', 'Drama']);
});

test('AniList requests use fixed operations and validated variables', () => {
  const request = parseRequest(new URLSearchParams('mode=search&page=2&query=space%20opera'));
  assert.match(request.query, /query ZivaAnimePage/);
  assert.deepEqual(request.variables, { page: 2, search: 'space opera', sort: ['SEARCH_MATCH'], genres: null });
  assert.throws(() => parseRequest(new URLSearchParams('mode=delete')), (error) => error instanceof AniListError && error.status === 404);
  assert.throws(() => parseRequest(new URLSearchParams('mode=search&page=51&query=one')), /Page must be an integer/);
  assert.throws(() => parseRequest(new URLSearchParams('mode=search')), /search term/);
  assert.throws(() => parseRequest(new URLSearchParams('mode=popular&genre=unauthorized')), /genre is not supported/);
});

test('AniList catalogue requests return paginated metadata without provider links', async () => {
  let sent;
  const data = await requestAniList(new URLSearchParams('mode=trending'), async (url, options) => {
    assert.equal(url, ENDPOINT);
    sent = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        data: {
          Page: {
            pageInfo: { currentPage: 1, hasNextPage: true },
            media: [{ id: 5, title: { romaji: 'Title' }, averageScore: 80, episodes: 24 }]
          }
        }
      })
    };
  });
  assert.deepEqual(sent.variables.sort, ['TRENDING_DESC']);
  assert.equal(data.hasNextPage, true);
  assert.equal(data.items[0].title, 'Title');
  assert.equal(Object.hasOwn(data.items[0], 'streamUrl'), false);
});

test('AniList detail query validates its identifier and maps missing data', async () => {
  const detail = await requestAniList(new URLSearchParams('mode=detail&id=42'), async (_url, options) => {
    assert.equal(JSON.parse(options.body).variables.id, 42);
    return { ok: true, json: async () => ({ data: { Media: { id: 42, title: { english: 'Detail' } } } }) };
  });
  assert.equal(detail.title, 'Detail');
  await assert.rejects(
    requestAniList(new URLSearchParams('mode=detail&id=43'), async () => ({ ok: true, json: async () => ({ data: { Media: null } }) })),
    (error) => error instanceof AniListError && error.status === 404
  );
});
