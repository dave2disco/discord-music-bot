const https = require('https');

function fetchJson(url, redirects = 0) {
  if (redirects > 5) return Promise.reject(new Error('Troppi redirect'));
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return resolve(fetchJson(res.headers.location, redirects + 1));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Risposta oEmbed non valida')); }
      });
    }).on('error', reject);
  });
}

function fetchHtml(url, redirects = 0) {
  if (redirects > 5) return Promise.reject(new Error('Troppi redirect'));
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept':          'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return resolve(fetchHtml(res.headers.location, redirects + 1));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function isSpotifyUrl(str) {
  return (str.includes('spotify.com') && str.includes('/track/')) ||
         str.startsWith('spotify:track:');
}

function normalizeSpotifyTrackUrl(str) {
  if (str.startsWith('spotify:track:')) {
    return `https://open.spotify.com/track/${str.split(':')[2]}`;
  }
  const match = str.match(/track\/([A-Za-z0-9]+)/);
  return match ? `https://open.spotify.com/track/${match[1]}` : str;
}

async function getSpotifyTrackQuery(url) {
  const cleanUrl = normalizeSpotifyTrackUrl(url);
  const data = await fetchJson(
    `https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`
  );
  if (!data.title) throw new Error('Impossibile leggere i metadati da Spotify.');
  return data.title;
}

function isSpotifyPlaylistUrl(str) {
  return str.includes('spotify.com') && str.includes('/playlist/');
}

async function fetchSpotifyPlaylistTracks(url) {
  const id = url.match(/playlist\/([A-Za-z0-9]+)/)?.[1];
  if (!id) throw new Error('Link playlist Spotify non valido.');

  const html = await fetchHtml(`https://open.spotify.com/embed/playlist/${id}`);

  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Impossibile leggere la playlist Spotify (struttura pagina non riconosciuta).');

  let json;
  try { json = JSON.parse(match[1]); }
  catch { throw new Error('Impossibile parsare i dati della playlist Spotify.'); }

  const trackList = json?.props?.pageProps?.state?.data?.entity?.trackList;
  if (!Array.isArray(trackList) || trackList.length === 0) {
    throw new Error('Playlist Spotify vuota o non accessibile.');
  }

  return trackList
    .filter(t => t?.title)
    .map(t => ({
      searchQuery:  t.subtitle ? `${t.subtitle} ${t.title}` : t.title,
      displayTitle: t.subtitle ? `${t.title} — ${t.subtitle}` : t.title,
    }));
}

module.exports = {
  isSpotifyUrl,
  isSpotifyPlaylistUrl,
  getSpotifyTrackQuery,
  fetchSpotifyPlaylistTracks,
};