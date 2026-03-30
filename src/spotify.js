// ─── Supporto Spotify ─────────────────────────────────────────────────────────
// Usa l'endpoint oEmbed pubblico di Spotify (no API key, no Premium richiesto)
// per estrarre il titolo della traccia, poi cerca su YouTube come al solito.

const https = require('https');

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      // Gestisce redirect (301/302)
      if (res.statusCode === 301 || res.statusCode === 302) {
        return resolve(httpsGet(res.headers.location, headers));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Risposta oEmbed non valida')); }
      });
    }).on('error', reject);
  });
}

function isSpotifyUrl(str) {
  return (str.includes('spotify.com') && str.includes('/track/')) || str.startsWith('spotify:track:');
}

function normalizeSpotifyUrl(str) {
  // Converte spotify:track:ID in URL standard se necessario
  if (str.startsWith('spotify:track:')) {
    const id = str.split(':')[2];
    return `https://open.spotify.com/track/${id}`;
  }
  // Rimuove query string (?si=...) e locale (intl-it) che possono dare problemi
  const match = str.match(/track\/([A-Za-z0-9]+)/);
  return match ? `https://open.spotify.com/track/${match[1]}` : str;
}

async function getSpotifyTrackQuery(url) {
  const cleanUrl = normalizeSpotifyUrl(url);
  const oEmbedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`;

  const data = await httpsGet(oEmbedUrl);

  // oEmbed restituisce { title: "Think About Things", provider_name: "Spotify", ... }
  if (!data.title) {
    throw new Error('Impossibile leggere i metadati da Spotify.');
  }

  return data.title;
}

module.exports = { isSpotifyUrl, getSpotifyTrackQuery };