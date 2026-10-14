const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBecauseRows, similarity } = require('../src/recommendations.js');

function title(ratingKey, name, genres, summary, options = {}) {
  return {
    ratingKey, title: name, genres, summary, kind: options.kind || 'movie', year: options.year || 2020,
    audienceRating: options.audienceRating || 7, collections: options.collections || [], credits: options.credits || [],
    isWatched: Boolean(options.isWatched), lastViewedAt: options.lastViewedAt || null,
  };
}

test('Walking Dead recommendations prioritize horror and survival instead of generic drama', () => {
  const walkingDead = title('walking-dead', 'The Walking Dead', ['Drama', 'Horror', 'Thriller'],
    'Survivors fight zombies after an apocalypse destroys society.', { kind: 'show', isWatched: true, lastViewedAt: 100 });
  const fear = title('fear', 'Fear the Walking Dead', ['Drama', 'Horror', 'Thriller'],
    'A family survives the beginning of a zombie apocalypse.', { kind: 'show' });
  const daysLater = title('days-later', '28 Days Later', ['Horror', 'Science Fiction', 'Thriller'],
    'A survivor wakes after an infection causes a terrifying apocalypse.');
  const lastOfUs = title('last-of-us', 'The Last of Us', ['Drama', 'Action', 'Adventure'],
    'Two survivors cross an apocalyptic country after a deadly infection.', { kind: 'show' });
  const devilWearsPrada = title('prada', 'The Devil Wears Prada', ['Comedy', 'Drama'],
    'A young assistant works for a demanding fashion editor.');
  const otto = title('otto', 'A Man Called Otto', ['Comedy', 'Drama'],
    'A grumpy widower forms an unlikely friendship with his neighbor.');

  const rows = buildBecauseRows([walkingDead, fear, daysLater, lastOfUs, devilWearsPrada, otto], 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Because you watched The Walking Dead');
  assert.deepEqual(rows[0].items.map((item) => item.ratingKey), ['fear', 'days-later', 'last-of-us']);
});

test('one broad genre alone is not considered a meaningful match', () => {
  const anchor = title('anchor', 'Crime Story', ['Drama', 'Crime'], 'A detective investigates a serial murder.',
    { kind: 'show', isWatched: true, lastViewedAt: 50 });
  const romance = title('romance', 'Summer Hearts', ['Drama', 'Romance'], 'Two people fall in love during a summer holiday.');
  const family = title('family', 'Family Home', ['Drama', 'Family'], 'A family rebuilds their relationship.');
  assert.equal(buildBecauseRows([anchor, romance, family], 1).length, 0);
});

test('shared collections or cast can establish similarity across genres', () => {
  const anchor = title('anchor', 'Original', ['Drama'], 'A difficult journey.', {
    isWatched: true, lastViewedAt: 20, collections: ['Saga'], credits: [{ name: 'Ava Stone' }],
  });
  const sequel = title('sequel', 'Sequel', ['Action'], 'The journey continues.', { collections: ['Saga'] });
  const castMate = title('cast', 'Another Story', ['Mystery'], 'A hidden truth.', { credits: [{ name: 'Ava Stone' }] });
  const unrelated = title('unrelated', 'Cooking Time', ['Reality'], 'A cooking contest.');
  const rows = buildBecauseRows([anchor, sequel, castMate, unrelated], 1);
  assert.deepEqual(rows[0].items.map((item) => item.ratingKey), ['sequel', 'cast']);
  assert.equal(similarity(unrelated, anchor, { librarySize: 4, genreFrequency: new Map() }).strongSignal, false);
});
