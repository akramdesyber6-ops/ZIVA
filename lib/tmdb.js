'use strict';
const API_BASE = 'https://api.themoviedb.org/3';
const ALLOWED_QUERY = new Set(['query','page','language','region','year','primary_release_year','first_air_date_year','with_genres','sort_by','include_adult','append_to_response']);
const ALLOWED_APPEND = new Set(['credits','videos','recommendations','similar','release_dates','external_ids']);
const ROUTES = [
  /^trending\/(movie|tv|all)\/(day|week)$/,
  /^(movie|tv)\/(popular|top_rated|now_playing|upcoming|on_the_air|airing_today)$/,
  /^search\/(multi|movie|tv|person)$/,
  /^genre\/(movie|tv)\/list$/,
  /^(movie|tv)\/\d+(\/(credits|videos|recommendations|similar))?$/
];
class TmdbError extends Error {
  constructor(message, status = 400, code = 'TMDB_REQUEST_ERROR') { super(message); this.status = status; this.code = code; }
}
function validatePath(raw) {
  if (typeof raw !== 'string' || raw.length > 180) throw new TmdbError('A valid TMDB path is required.');
  const route = raw.replace(/^\/+|\/+$/g, '');
  if (!route || route.includes('..') || route.includes('\\') || route.includes('%') || !ROUTES.some((re) => re.test(route))) {
    throw new TmdbError('This TMDB endpoint is not allowed.', 404, 'TMDB_ENDPOINT_NOT_ALLOWED');
  }
  return route;
}
function buildUrl(raw, input = {}) {
  const route = validatePath(raw);
  const url = new URL(`${API_BASE}/${route}`);
  const params = input instanceof URLSearchParams ? input : new URLSearchParams(input);
  for (const [key, value] of params.entries()) {
    if (!ALLOWED_QUERY.has(key) || value === '') continue;
    if (key === 'page') {
      const page = Number(value);
      if (!Number.isInteger(page) || page < 1 || page > 500) throw new TmdbError('Page must be an integer between 1 and 500.');
    }
    if (key === 'query' && value.length > 100) throw new TmdbError('Search query is too long.');
    if (key === 'language' && !/^[a-z]{2}-[A-Z]{2}$/.test(value)) throw new TmdbError('Language must look like en-US.');
    if (key === 'region' && !/^[A-Z]{2}$/.test(value)) throw new TmdbError('Region must be a two-letter country code.');
    if (['year','primary_release_year','first_air_date_year'].includes(key) && !/^\d{4}$/.test(value)) throw new TmdbError(`${key} must be a four-digit year.`);
    if (key === 'append_to_response') {
      const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
      if (!parts.length || parts.some((part) => !ALLOWED_APPEND.has(part))) throw new TmdbError('Unsupported append_to_response value.');
      url.searchParams.set(key, parts.join(','));
    } else url.searchParams.set(key, value);
  }
  if (!url.searchParams.has('language')) url.searchParams.set('language', 'en-US');
  return url;
}
async function requestTmdb(raw, params, token, fetchImpl = fetch) {
  if (!token) throw new TmdbError('TMDB is not configured. Add TMDB_API_READ_ACCESS_TOKEN to the server environment.', 503, 'TMDB_NOT_CONFIGURED');
  const response = await fetchImpl(buildUrl(raw, params), {
    method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(12000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const status = response.status === 429 ? 429 : response.status >= 500 ? 502 : response.status;
    throw new TmdbError(body.status_message || `TMDB request failed (${response.status}).`, status, 'TMDB_UPSTREAM_ERROR');
  }
  return body;
}
module.exports = { API_BASE, TmdbError, validatePath, buildUrl, requestTmdb };
