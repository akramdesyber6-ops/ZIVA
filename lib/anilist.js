'use strict';

const ENDPOINT = 'https://graphql.anilist.co';
const PAGE_QUERY = `
  query ZivaAnimePage($page: Int!, $search: String, $sort: [MediaSort!], $genres: [String!]) {
    Page(page: $page, perPage: 24) {
      pageInfo { currentPage hasNextPage }
      media(type: ANIME, search: $search, sort: $sort, genre_in: $genres) {
        id
        title { romaji english native }
        description(asHtml: false)
        coverImage { large }
        bannerImage
        averageScore
        episodes
        season
        seasonYear
        genres
        format
        status
      }
    }
  }
`;
const DETAIL_QUERY = `
  query ZivaAnimeDetail($id: Int!) {
    Media(id: $id, type: ANIME) {
      id
      title { romaji english native }
      description(asHtml: false)
      coverImage { large }
      bannerImage
      averageScore
      episodes
      season
      seasonYear
      genres
      format
      status
    }
  }
`;
const SORTS = Object.freeze({
  trending: ['TRENDING_DESC'],
  popular: ['POPULARITY_DESC'],
  search: ['SEARCH_MATCH']
});
const ALLOWED_GENRES = new Set([
  'Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Horror', 'Music',
  'Mystery', 'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller'
]);

class AniListError extends Error {
  constructor(message, status = 400, code = 'ANILIST_REQUEST_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function normalizeAnime(item) {
  if (!item || !Number.isSafeInteger(item.id)) return null;
  const title = item.title || {};
  const cover = item.coverImage && item.coverImage.large;
  return {
    id: item.id,
    title: title.english || title.romaji || title.native || `Anime ${item.id}`,
    alternateTitle: title.romaji || title.native || '',
    description: String(item.description || '').replace(/<[^>]*>/g, '').trim(),
    image: typeof cover === 'string' && /^https:\/\/(s[0-9]+\.)?anilist\.co\//.test(cover) ? cover : '',
    banner: typeof item.bannerImage === 'string' && /^https:\/\/(s[0-9]+\.)?anilist\.co\//.test(item.bannerImage)
      ? item.bannerImage
      : '',
    rating: Number.isFinite(item.averageScore) ? item.averageScore / 10 : null,
    episodes: Number.isSafeInteger(item.episodes) && item.episodes > 0 ? item.episodes : null,
    season: typeof item.season === 'string' ? item.season : '',
    year: Number.isSafeInteger(item.seasonYear) ? item.seasonYear : null,
    genres: Array.isArray(item.genres) ? item.genres.filter((genre) => typeof genre === 'string') : [],
    format: typeof item.format === 'string' ? item.format : '',
    status: typeof item.status === 'string' ? item.status : ''
  };
}

function parseRequest(params) {
  const mode = params.get('mode') || 'trending';
  if (!['trending', 'popular', 'search', 'detail'].includes(mode)) {
    throw new AniListError('This anime catalogue request is not supported.', 404, 'ANILIST_MODE_NOT_ALLOWED');
  }

  if (mode === 'detail') {
    const id = Number(params.get('id'));
    if (!Number.isSafeInteger(id) || id < 1) throw new AniListError('A valid AniList ID is required.');
    return { mode, query: DETAIL_QUERY, variables: { id } };
  }

  const page = Number(params.get('page') || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 50) {
    throw new AniListError('Page must be an integer between 1 and 50.');
  }
  const search = params.get('query') || '';
  const genre = params.get('genre') || '';
  if (genre && !ALLOWED_GENRES.has(genre)) throw new AniListError('This anime genre is not supported.');
  if (mode === 'search' && (!search.trim() || search.length > 100)) {
    throw new AniListError('Enter an anime search term of 1 to 100 characters.');
  }
  return {
    mode,
    query: PAGE_QUERY,
    variables: {
      page,
      search: mode === 'search' ? search.trim() : null,
      sort: SORTS[mode],
      genres: genre ? [genre] : null
    }
  };
}

async function requestAniList(params, fetchImpl = fetch) {
  const request = parseRequest(params);
  let response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: request.query, variables: request.variables }),
      signal: AbortSignal.timeout(12000)
    });
  } catch (error) {
    if (error && error.name === 'TimeoutError') {
      throw new AniListError('The anime data service timed out.', 504, 'ANILIST_TIMEOUT');
    }
    throw new AniListError('The anime data service is temporarily unavailable.', 502, 'ANILIST_UNAVAILABLE');
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok || (Array.isArray(body.errors) && body.errors.length)) {
    const status = response.status === 429 ? 429 : response.status >= 500 ? 502 : 503;
    throw new AniListError('The anime data service could not complete this request.', status, 'ANILIST_UPSTREAM_ERROR');
  }

  if (request.mode === 'detail') {
    const anime = normalizeAnime(body.data && body.data.Media);
    if (!anime) throw new AniListError('Anime details were not found.', 404, 'ANILIST_NOT_FOUND');
    return anime;
  }

  const page = body.data && body.data.Page;
  const items = page && Array.isArray(page.media) ? page.media.map(normalizeAnime).filter(Boolean) : [];
  const pageInfo = page && page.pageInfo;
  return {
    items,
    page: Number(pageInfo && pageInfo.currentPage) || request.variables.page,
    hasNextPage: Boolean(pageInfo && pageInfo.hasNextPage)
  };
}

async function animeHandler(req, res, fetchImpl = fetch) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'METHOD_NOT_ALLOWED', message: 'Only GET requests are supported.' }));
  }
  try {
    const result = await requestAniList(new URL(req.url, 'http://localhost').searchParams, fetchImpl);
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.statusCode = 200;
    return res.end(JSON.stringify(result));
  } catch (error) {
    const known = error instanceof AniListError;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.statusCode = known ? error.status : 502;
    return res.end(JSON.stringify({
      error: known ? error.code : 'ANILIST_UPSTREAM_ERROR',
      message: known ? error.message : 'The anime data service is temporarily unavailable.'
    }));
  }
}

module.exports = { AniListError, ENDPOINT, normalizeAnime, parseRequest, requestAniList, animeHandler };
