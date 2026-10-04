const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
const WIKIDATA_ENTITY = 'https://www.wikidata.org/wiki/Special:EntityData';

function imdbSearchUrl(name) {
  const url = new URL('https://www.imdb.com/find/');
  url.searchParams.set('q', String(name || '').trim());
  url.searchParams.set('s', 'nm');
  return url.toString();
}

function selectWikipediaPage(payload, name) {
  const pages = Object.values(payload?.query?.pages || {}).filter((page) => page?.title && page?.extract);
  const normalized = String(name || '').trim().toLowerCase();
  return pages.find((page) => String(page.title).trim().toLowerCase() === normalized)
    || pages.find((page) => String(page.title).trim().toLowerCase().startsWith(`${normalized} (`))
    || pages[0]
    || null;
}

function imdbIdFromEntity(payload, entityId) {
  const values = payload?.entities?.[entityId]?.claims?.P345 || [];
  return values
    .map((claim) => claim?.mainsnak?.datavalue?.value)
    .find((value) => /^nm\d+$/i.test(String(value || ''))) || null;
}

async function jsonRequest(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Minova Cinema/1.0 (+https://github.com/minova-chromium/Minova-Cinema-Windows)',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Person metadata returned ${response.status}.`);
  return response.json();
}

async function lookupPersonBackground(name, fetchImpl = fetch) {
  const normalizedName = String(name || '').trim();
  if (!normalizedName) return null;
  const search = new URL(WIKIPEDIA_API);
  search.searchParams.set('action', 'query');
  search.searchParams.set('format', 'json');
  search.searchParams.set('formatversion', '2');
  search.searchParams.set('generator', 'search');
  search.searchParams.set('gsrsearch', `intitle:${normalizedName}`);
  search.searchParams.set('gsrnamespace', '0');
  search.searchParams.set('gsrlimit', '5');
  search.searchParams.set('prop', 'extracts|pageprops');
  search.searchParams.set('exintro', '1');
  search.searchParams.set('explaintext', '1');
  search.searchParams.set('exchars', '1600');
  search.searchParams.set('redirects', '1');

  try {
    const page = selectWikipediaPage(await jsonRequest(search, fetchImpl), normalizedName);
    const entityId = page?.pageprops?.wikibase_item || null;
    let imdbId = null;
    if (entityId && /^Q\d+$/i.test(entityId)) {
      const entityUrl = `${WIKIDATA_ENTITY}/${encodeURIComponent(entityId)}.json`;
      imdbId = imdbIdFromEntity(await jsonRequest(entityUrl, fetchImpl), entityId);
    }
    return {
      biography: page?.extract || null,
      sourceLabel: page ? 'Wikipedia' : null,
      sourceUrl: page ? `https://en.wikipedia.org/wiki/${encodeURIComponent(String(page.title).replace(/ /g, '_'))}` : null,
      imdbUrl: imdbId ? `https://www.imdb.com/name/${imdbId}/` : imdbSearchUrl(normalizedName),
      imdbId,
    };
  } catch {
    return {
      biography: null,
      sourceLabel: null,
      sourceUrl: null,
      imdbUrl: imdbSearchUrl(normalizedName),
      imdbId: null,
    };
  }
}

module.exports = { imdbIdFromEntity, imdbSearchUrl, lookupPersonBackground, selectWikipediaPage };
