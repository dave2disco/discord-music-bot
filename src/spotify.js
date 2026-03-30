// ─── Supporto Spotify ─────────────────────────────────────────────────────────
// Usa la Spotify Web API (gratuita, no Premium) solo per leggere i metadati
// di una traccia (titolo + artista). L'audio viene poi cercato su YouTube
// tramite la funzione search() esistente, senza modificare audio.js.
//
// Il token OAuth usa il flusso Client Credentials: non richiede login utente.
// Viene cachato e rinnovato automaticamente alla scadenza (ogni 60 minuti).

const https = require('https');

let cachedToken = null;
let tokenExpiresAt = 0;

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Risposta Spotify non valida')); }
      });
    }).on('error', reject);
  });
}

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('[Spotify track raw]', data);
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Risposta Spotify non valida')); }
      });
    }).on('error', (err) => {
      console.error('[Spotify track error]', err.message, err.code); // ← aggiunto
      reject(err);
    });
  });
}

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } = process.env;
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    throw new Error('SPOTIFY_CLIENT_ID e SPOTIFY_CLIENT_SECRET mancanti nel .env');
  }

  const credentials = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const body = 'grant_type=client_credentials';

  const data = await httpsPost(
    'accounts.spotify.com',
    '/api/token',
    body,
    {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    }
  );

  if (!data.access_token) {
    throw new Error('Impossibile ottenere il token Spotify. Controlla Client ID e Secret.');
  }

  cachedToken = data.access_token;
  // Scade 60 secondi prima della scadenza reale per sicurezza
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;

  return cachedToken;
}

function extractTrackId(url) {
  // Supporta sia https://open.spotify.com/track/ID che spotify:track:ID
  const match = url.match(/track[/:]([A-Za-z0-9]+)/);
  return match ? match[1] : null;
}

function isSpotifyUrl(str) {
  return (str.includes('spotify.com') && str.includes('/track/')) || str.startsWith('spotify:track:');
}

async function getSpotifyTrackQuery(url) {
  const trackId = extractTrackId(url);
  if (!trackId) throw new Error('Link Spotify non valido. Usa un link a una singola traccia.');

  const token = await getToken();
  const data = await httpsGet(
    `https://api.spotify.com/v1/tracks/${trackId}`,
    { 'Authorization': `Bearer ${token}` }
  );

  if (!data.name || !data.artists) {
    throw new Error('Impossibile leggere i metadati da Spotify.');
  }

  const artist = data.artists[0].name;
  const title = data.name;

  // Restituisce la query da passare a yt-dlp, es: "Daði Freyr Think About Things"
  return `${artist} - ${title}`;
}

module.exports = { isSpotifyUrl, getSpotifyTrackQuery };