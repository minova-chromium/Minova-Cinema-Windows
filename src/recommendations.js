(function exposeRecommendations(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MinovaRecommendations = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const BROAD_GENRES = new Set(['action', 'adventure', 'animation', 'comedy', 'drama', 'family']);
  const STOP_WORDS = new Set([
    'about', 'after', 'again', 'against', 'also', 'among', 'another', 'around', 'back', 'become', 'before',
    'being', 'between', 'both', 'could', 'during', 'each', 'from', 'have', 'into', 'more', 'most', 'must',
    'only', 'other', 'over', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'through', 'under',
    'very', 'when', 'where', 'which', 'while', 'with', 'without', 'world', 'young',
  ]);
  const THEME_TERMS = new Set([
    'alien', 'apocalypse', 'apocalyptic', 'assassin', 'christmas', 'crime', 'detective', 'dinosaur', 'dystopia',
    'espionage', 'ghost', 'heist', 'infection', 'magic', 'monster', 'murder', 'music', 'police', 'prison',
    'revenge', 'robot', 'serial', 'space', 'spy', 'superhero', 'supernatural', 'survival', 'undead', 'vampire',
    'war', 'western', 'witch', 'zombie',
  ]);

  function normalized(value) {
    return String(value || '').trim().toLocaleLowerCase();
  }

  function normalizedSet(values) {
    return new Set((values || []).map(normalized).filter(Boolean));
  }

  function intersections(left, right) {
    return [...left].filter((value) => right.has(value));
  }

  function stem(word) {
    if (word.endsWith('ies') && word.length > 5) return `${word.slice(0, -3)}y`;
    if (word.endsWith('ing') && word.length > 6) return word.slice(0, -3);
    if (word.endsWith('ed') && word.length > 5) return word.slice(0, -2);
    if (word.endsWith('s') && word.length > 4) return word.slice(0, -1);
    return word;
  }

  function canonicalTheme(word) {
    const value = stem(word);
    if (value.startsWith('apocalyp')) return 'apocalypse';
    if (value.startsWith('infect')) return 'infection';
    if (value.startsWith('surviv')) return 'survival';
    if (value.startsWith('zombi')) return 'zombie';
    return value;
  }

  function themeWords(item) {
    const text = [item?.title, item?.tagline, item?.summary].filter(Boolean).join(' ').toLocaleLowerCase();
    const words = text.match(/[\p{L}\p{N}]+/gu) || [];
    return new Set(words.map(canonicalTheme).filter((word) => word.length >= 4 && !STOP_WORDS.has(word)
      && THEME_TERMS.has(word)));
  }

  function creditNames(item) {
    return normalizedSet((item?.credits || []).map((credit) => credit.name));
  }

  function genreFrequency(items) {
    const counts = new Map();
    for (const item of items) {
      for (const genre of normalizedSet(item?.genres)) counts.set(genre, (counts.get(genre) || 0) + 1);
    }
    return counts;
  }

  function similarity(candidate, anchor, context) {
    const candidateGenres = normalizedSet(candidate?.genres);
    const anchorGenres = normalizedSet(anchor?.genres);
    const sharedGenres = intersections(candidateGenres, anchorGenres);
    const specificGenres = sharedGenres.filter((genre) => !BROAD_GENRES.has(genre));
    const sharedCollections = intersections(normalizedSet(candidate?.collections), normalizedSet(anchor?.collections));
    const sharedCredits = intersections(creditNames(candidate), creditNames(anchor));
    const sharedThemes = intersections(themeWords(candidate), themeWords(anchor));
    const sameKind = candidate?.kind === anchor?.kind;
    const strongGenreMatch = sharedGenres.length >= 2 || specificGenres.length >= 1;
    const broadGenreWithSupport = sharedGenres.length >= 1 && (sharedThemes.length >= 1 || sharedCollections.length >= 1 || sharedCredits.length >= 1);
    const strongSignal = strongGenreMatch || broadGenreWithSupport || sharedThemes.length >= 2
      || sharedCollections.length >= 1 || sharedCredits.length >= 1;

    let score = 0;
    for (const genre of sharedGenres) {
      const frequency = Math.max(1, context.genreFrequency.get(genre) || context.librarySize);
      score += 90 + Math.min(150, (context.librarySize / frequency) * 24);
    }
    score += specificGenres.length * 80;
    score += sharedCollections.length * 180;
    score += sharedCredits.length * 95;
    score += sharedThemes.length * 70;
    if (sameKind) score += 35;
    const yearDistance = Math.abs(Number(candidate?.year || 0) - Number(anchor?.year || 0));
    if (candidate?.year && anchor?.year) score += Math.max(0, 20 - yearDistance);
    score += Math.min(20, Number(candidate?.audienceRating || 0) * 2);
    return { score, strongSignal, sharedGenres, specificGenres, sharedCollections, sharedCredits, sharedThemes };
  }

  function viewingActivity(item) {
    return Number(item?.lastViewedAt || 0) || (item?.isWatched || Number(item?.viewedCount || 0) > 0 ? 1 : 0);
  }

  function buildBecauseRows(items, maximum = 2, limit = 24) {
    const library = (items || []).filter((item) => item?.ratingKey);
    const context = { librarySize: Math.max(1, library.length), genreFrequency: genreFrequency(library) };
    const anchors = library.filter((item) => viewingActivity(item) > 0)
      .sort((left, right) => viewingActivity(right) - viewingActivity(left));
    const used = new Set();
    const rows = [];

    for (const anchor of anchors) {
      const candidates = library
        .filter((candidate) => candidate.ratingKey !== anchor.ratingKey && !candidate.isWatched && !used.has(candidate.ratingKey))
        .map((candidate) => ({ candidate, match: similarity(candidate, anchor, context) }))
        .filter(({ match }) => match.strongSignal)
        .sort((left, right) => right.match.score - left.match.score
          || Number(right.candidate.audienceRating || 0) - Number(left.candidate.audienceRating || 0))
        .slice(0, limit)
        .map(({ candidate }) => candidate);
      if (candidates.length < 2) continue;
      candidates.forEach((candidate) => used.add(candidate.ratingKey));
      rows.push({ title: `Because you watched ${anchor.title}`, anchor, items: candidates });
      if (rows.length >= maximum) break;
    }
    return rows;
  }

  return { buildBecauseRows, similarity };
}));
