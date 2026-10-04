const test = require('node:test');
const assert = require('node:assert/strict');
const { imdbIdFromEntity, imdbSearchUrl, lookupPersonBackground, selectWikipediaPage } = require('../src/person-metadata.cjs');

test('selects the exact encyclopedia profile and reads its IMDb identity', () => {
  const page = selectWikipediaPage({ query: { pages: [
    { title: 'Example (film)', extract: 'A film.' },
    { title: 'Example Actor', extract: 'An actor.', pageprops: { wikibase_item: 'Q42' } },
  ] } }, 'Example Actor');
  assert.equal(page.title, 'Example Actor');
  assert.equal(imdbIdFromEntity({ entities: { Q42: { claims: { P345: [
    { mainsnak: { datavalue: { value: 'nm1234567' } } },
  ] } } } }, 'Q42'), 'nm1234567');
});

test('builds a complete person background without scraping IMDb pages', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const entity = String(url).includes('Special:EntityData');
    return {
      ok: true,
      json: async () => entity
        ? { entities: { Q7: { claims: { P345: [{ mainsnak: { datavalue: { value: 'nm7654321' } } }] } } } }
        : { query: { pages: [{ title: 'Ava Stone', extract: 'Ava Stone is an actor.', pageprops: { wikibase_item: 'Q7' } }] } },
    };
  };
  const result = await lookupPersonBackground('Ava Stone', fetchImpl);
  assert.equal(result.biography, 'Ava Stone is an actor.');
  assert.equal(result.imdbUrl, 'https://www.imdb.com/name/nm7654321/');
  assert.equal(calls.length, 2);
  assert.match(imdbSearchUrl('Ava Stone'), /imdb\.com\/find/);
});
