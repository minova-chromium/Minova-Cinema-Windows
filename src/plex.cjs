const { randomUUID } = require('node:crypto');

const PRODUCT_VERSION = '1.0.0';
const CLIENT_ID = 'MinovaCinemaDesktop';
const PAGE_SIZE = 200;
const TRUSTED_ARTWORK_DOMAINS = ['plex.tv', 'themoviedb.org', 'tmdb.org', 'thetvdb.com', 'fanart.tv'];

function isPlexOwnedHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'plex.tv' || host.endsWith('.plex.tv');
}

function isTrustedExternalArtworkUrl(input) {
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return TRUSTED_ARTWORK_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch { return false; }
}

function normalizeServer(input) {
  let value = String(input || '').trim().replace(/\/+$/, '');
  if (!value) throw new Error('Enter your Plex server address.');
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  const hasExplicitPort = /^https?:\/\/[^/]+:\d+(?:\/|$)/i.test(value);
  const url = new URL(value);
  if (!url.hostname) throw new Error('The Plex server address is not valid.');
  // Portless HTTPS addresses are commonly reverse proxies or Tailscale Serve
  // endpoints and must stay on the standard HTTPS port. A bare host or an
  // HTTP address still receives Plex's conventional 32400 port.
  if (!url.port && !hasExplicitPort && url.protocol === 'http:') url.port = '32400';
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function plexHeaders(token, extra = {}) {
  return {
    Accept: 'application/json',
    'X-Plex-Token': token,
    'X-Plex-Client-Identifier': CLIENT_ID,
    'X-Plex-Product': 'Minova Cinema',
    'X-Plex-Version': PRODUCT_VERSION,
    'X-Plex-Platform': 'Windows',
    'X-Plex-Device': 'PC',
    'X-Plex-Device-Name': 'Minova Cinema Desktop',
    'X-Plex-Provides': 'player,controller',
    'X-Plex-Language': 'en',
    ...extra,
  };
}

function metadataList(payload) {
  const container = payload?.MediaContainer || {};
  if (Array.isArray(container.Metadata)) return container.Metadata;
  if (Array.isArray(container.Hub)) return container.Hub.flatMap((hub) => hub.Metadata || []);
  return [];
}

function tags(values) {
  return (values || []).map((entry) => entry?.tag).filter(Boolean);
}

function identityKeys(metadata) {
  const values = [metadata.guid, metadata.primaryGuid, ...(metadata.Guid || []).map((item) => item?.id)];
  return values.filter(Boolean).map((value) => String(value).trim().replace(/\/$/, '').toLowerCase());
}

function proxyPath(path) {
  return path && String(path).trim() ? String(path) : null;
}

function mapMetadata(metadata = {}) {
  const kind = ({ show: 'show', season: 'season', episode: 'episode', clip: 'extra' })[metadata.type] || 'movie';
  const media = (metadata.Media || [])[0] || {};
  const part = (metadata.Media || []).flatMap((item) => item.Part || []).find((item) => item.key) || null;
  const streams = part?.Stream || [];
  const poster = kind === 'episode'
    ? metadata.grandparentThumb || metadata.parentThumb || metadata.thumb
    : metadata.thumb || metadata.parentThumb || metadata.grandparentThumb;
  const secondaryTitle = kind === 'episode'
    ? [metadata.grandparentTitle || metadata.parentTitle, metadata.parentIndex != null && metadata.index != null ? `S${metadata.parentIndex} E${metadata.index}` : null].filter(Boolean).join('  •  ')
    : kind === 'season' ? metadata.parentTitle || null : null;
  const durationMs = metadata.duration || part?.duration || null;
  const viewOffsetMs = metadata.viewOffset || 0;
  const seasonComplete = metadata.leafCount > 0 && metadata.viewedLeafCount === metadata.leafCount;
  return {
    ratingKey: String(metadata.ratingKey || ''),
    providerRatingKey: String(metadata.guid || '').split('/').filter(Boolean).at(-1) || null,
    identities: identityKeys(metadata),
    title: metadata.title || 'Untitled',
    secondaryTitle,
    summary: metadata.summary || '',
    tagline: metadata.tagline || '',
    year: metadata.year || null,
    addedAt: metadata.addedAt || null,
    releaseDate: metadata.originallyAvailableAt || null,
    durationMs,
    viewOffsetMs,
    progress: durationMs > 0 ? Math.max(0, Math.min(1, viewOffsetMs / durationMs)) : 0,
    posterPath: proxyPath(poster),
    backdropPath: proxyPath(metadata.art || metadata.grandparentArt || metadata.parentArt),
    themePath: proxyPath(metadata.theme),
    contentRating: metadata.contentRating || null,
    kind,
    genres: tags(metadata.Genre),
    collections: tags(metadata.Collection),
    seasonNumber: kind === 'season' ? metadata.index : metadata.parentIndex || null,
    episodeNumber: kind === 'episode' ? metadata.index : null,
    childCount: metadata.childCount ?? metadata.leafCount ?? null,
    parentRatingKey: metadata.parentRatingKey || null,
    grandparentRatingKey: metadata.grandparentRatingKey || null,
    isWatched: kind === 'show' || kind === 'season' ? seasonComplete : (metadata.viewCount || 0) > 0,
    audienceRating: metadata.audienceRating ?? metadata.rating ?? null,
    credits: [
      ...(metadata.Role || []).map((person) => ({ name: person.tag, role: person.role || 'Cast', imagePath: proxyPath(person.thumb) })),
      ...(metadata.Director || []).map((person) => ({ name: person.tag, role: 'Director', imagePath: proxyPath(person.thumb) })),
      ...(metadata.Writer || []).map((person) => ({ name: person.tag, role: 'Writer', imagePath: proxyPath(person.thumb) })),
      ...(metadata.Producer || []).map((person) => ({ name: person.tag, role: 'Producer', imagePath: proxyPath(person.thumb) })),
    ].filter((person) => person.name).filter((person, index, people) =>
      people.findIndex((candidate) => candidate.name === person.name && candidate.role === person.role) === index
    ),
    technical: {
      container: media.container || part?.container || null,
      videoCodec: media.videoCodec || null,
      audioCodec: media.audioCodec || null,
      videoResolution: media.videoResolution || null,
      width: media.width || null,
      height: media.height || null,
      bitrate: media.bitrate || null,
    },
    playback: part ? {
      directPath: part.key,
      partId: part.id || null,
      audioStreams: streams.filter((stream) => stream.streamType === 2 && stream.id).map((stream) => ({
        id: stream.id,
        label: stream.displayTitle || stream.title || stream.language || `Audio ${stream.id}`,
        selected: Boolean(stream.selected),
      })),
      subtitleStreams: streams.filter((stream) => stream.streamType === 3 && stream.id).map((stream) => ({
        id: stream.id,
        label: stream.displayTitle || stream.title || stream.language || `Subtitle ${stream.id}`,
        selected: Boolean(stream.selected),
      })),
    } : null,
  };
}

class PlexClient {
  constructor(server, token) {
    this.server = normalizeServer(server);
    this.token = token;
  }

  async request(path, { method = 'GET', origin = this.server, extraHeaders = {} } = {}) {
    const url = /^https?:\/\//i.test(path) ? path : new URL(String(path).replace(/^\//, ''), `${origin}/`).toString();
    let response;
    try {
      response = await fetch(url, { method, headers: plexHeaders(this.token, extraHeaders), signal: AbortSignal.timeout(45000) });
    } catch (error) {
      const target = new URL(url);
      const reason = error?.name === 'TimeoutError' ? 'The connection timed out.' : 'The server could not be reached.';
      throw new Error(`${reason} Check that ${target.origin} opens on this PC and that its VPN or Tailscale connection is active.`);
    }
    if (!response.ok) throw new Error(`Plex returned ${response.status} ${response.statusText}.`);
    if (response.status === 204) return {};
    const type = response.headers.get('content-type') || '';
    return type.includes('json') ? response.json() : {};
  }

  async paged(path, origin = this.server, pageSize = PAGE_SIZE) {
    const output = [];
    for (let start = 0; start < 200000; start += pageSize) {
      const url = new URL(path.replace(/^\//, ''), `${origin}/`);
      url.searchParams.set('X-Plex-Container-Start', String(start));
      url.searchParams.set('X-Plex-Container-Size', String(pageSize));
      const payload = await this.request(url.toString(), {
        extraHeaders: { 'X-Plex-Container-Start': String(start), 'X-Plex-Container-Size': String(pageSize) },
      });
      const page = metadataList(payload);
      output.push(...page);
      const total = payload?.MediaContainer?.totalSize;
      if (!page.length || page.length < pageSize || (Number.isFinite(total) && output.length >= total)) break;
    }
    return output;
  }

  async test() {
    const payload = await this.request('/library/sections');
    return payload?.MediaContainer?.friendlyName || new URL(this.server).hostname;
  }

  async loadCatalog() {
    const sectionPayload = await this.request('/library/sections');
    const sections = sectionPayload?.MediaContainer?.Directory || [];
    const movieSections = sections.filter((section) => section.type === 'movie');
    const showSections = sections.filter((section) => section.type === 'show');
    const loadSections = async (items) => (await Promise.all(items.map((section) =>
      this.paged(`/library/sections/${encodeURIComponent(section.key)}/all?includeGuids=1&includeCollections=1`)
    ))).flat().map(mapMetadata);
    const loadCollections = async () => (await Promise.all([...movieSections, ...showSections].map(async (section) => {
      try {
        const rows = await this.paged(`/library/sections/${encodeURIComponent(section.key)}/collections`);
        return rows.map((item) => ({
          ratingKey: String(item.ratingKey || ''), title: item.title || 'Untitled', posterPath: proxyPath(item.thumb),
          libraryTitle: section.title || '', childCount: item.childCount ?? null,
        }));
      } catch { return []; }
    }))).flat();
    const [movies, shows, continueRows, collections] = await Promise.all([
      loadSections(movieSections), loadSections(showSections),
      this.request('/hubs/continueWatching').then(metadataList).catch(() => []).then((items) => items.map(mapMetadata)),
      loadCollections(),
    ]);
    const all = [...movies, ...shows];
    // Avoid an unnecessary Plex Discover request when this server has no
    // movie or series libraries. This also makes first-run recovery instant
    // for a newly configured or temporarily empty server.
    const watchlist = all.length ? await this.loadWatchlist(all).catch(() => []) : [];
    return {
      serverName: sectionPayload?.MediaContainer?.friendlyName || new URL(this.server).hostname,
      movies, shows, continueWatching: continueRows, watchlist,
      collections: collections.filter((item, index, values) => values.findIndex((other) => other.ratingKey === item.ratingKey) === index),
    };
  }

  async loadWatchlist(localMedia) {
    const discover = 'https://discover.provider.plex.tv';
    const rows = await this.paged('/library/sections/watchlist/all?includeCollections=1&includeExternalMedia=1', discover, 10);
    const byIdentity = new Map();
    for (const item of localMedia) for (const identity of item.identities || []) byIdentity.set(identity, item);
    const byTitleYear = new Map(localMedia.map((item) => [`${item.kind}|${item.title.toLowerCase()}|${item.year}`, item]));
    const matched = [];
    for (const row of rows) {
      const identities = identityKeys(row);
      if (row.ratingKey) identities.push(`plex://${row.type}/${row.ratingKey}`.toLowerCase());
      const item = identities.map((identity) => byIdentity.get(identity)).find(Boolean)
        || byTitleYear.get(`${row.type === 'show' ? 'show' : 'movie'}|${String(row.title || '').toLowerCase()}|${row.year}`);
      if (item && !matched.some((entry) => entry.ratingKey === item.ratingKey)) matched.push(item);
    }
    return matched;
  }

  async details(ratingKey) {
    const payload = await this.request(`/library/metadata/${encodeURIComponent(ratingKey)}?includeExtras=1&includeMarkers=1&includeChapters=1&includePeople=1`);
    return metadataList(payload).map(mapMetadata)[0] || null;
  }

  async children(ratingKey) {
    return metadataList(await this.request(`/library/metadata/${encodeURIComponent(ratingKey)}/children`)).map(mapMetadata);
  }

  async collection(ratingKey) {
    return (await this.paged(`/library/collections/${encodeURIComponent(ratingKey)}/children`)).map(mapMetadata);
  }

  async setWatched(ratingKey, watched) {
    await this.request(`/:/${watched ? 'scrobble' : 'unscrobble'}?key=${encodeURIComponent(ratingKey)}&identifier=com.plexapp.plugins.library`);
    return true;
  }

  async setWatchlisted(providerRatingKey, watchlisted) {
    if (!providerRatingKey) throw new Error('This item does not expose a Plex Watchlist identity.');
    await this.request(`/actions/${watchlisted ? 'addToWatchlist' : 'removeFromWatchlist'}?ratingKey=${encodeURIComponent(providerRatingKey)}`, {
      method: 'PUT', origin: 'https://discover.provider.plex.tv',
    });
    return true;
  }

  async timeline(item, state, timeMs) {
    const params = new URLSearchParams({
      ratingKey: item.ratingKey, key: `/library/metadata/${item.ratingKey}`, state,
      time: String(Math.max(0, Math.round(timeMs))), duration: String(item.durationMs || 0),
    });
    await this.request(`/:/timeline?${params}`);
  }

  transcodePath(ratingKey, quality = '1080') {
    const profile = {
      '4k': ['3840x2160', '40000'], '1080': ['1920x1080', '12000'],
      '720': ['1280x720', '4000'], '480': ['854x480', '2000'],
    }[quality] || ['1920x1080', '12000'];
    const params = new URLSearchParams({
      path: `http://127.0.0.1:32400/library/metadata/${ratingKey}`,
      mediaIndex: '0', partIndex: '0', protocol: 'hls', offset: '0', fastSeek: '1',
      directPlay: '0', directStream: '1', videoQuality: '100', videoResolution: profile[0],
      maxVideoBitrate: profile[1], subtitleSize: '100', audioBoost: '100', location: 'lan',
      session: randomUUID(), 'X-Plex-Client-Identifier': CLIENT_ID, 'X-Plex-Product': 'Minova Cinema',
      'X-Plex-Version': PRODUCT_VERSION, 'X-Plex-Platform': 'Windows', skipSubtitles: '1',
    });
    return `/video/:/transcode/universal/start.m3u8?${params}`;
  }
}

function rewritePlaylist(text, sourceUrl, wrap) {
  return String(text).split(/\r?\n/).map((line) => {
    if (!line) return line;
    if (!line.startsWith('#')) return wrap(new URL(line, sourceUrl).toString());
    return line.replace(/URI="([^"]+)"/g, (_match, uri) => `URI="${wrap(new URL(uri, sourceUrl).toString())}"`);
  }).join('\n');
}

module.exports = { PlexClient, CLIENT_ID, isPlexOwnedHost, isTrustedExternalArtworkUrl, mapMetadata, normalizeServer, plexHeaders, rewritePlaylist };
