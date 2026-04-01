const { exec } = require('child_process');
const { promisify } = require('util');
const { YTDLP_BIN } = require('./config');
const { isSpotifyUrl, getSpotifyTrackQuery } = require('./spotify');

const execAsync = promisify(exec);

const NICE = process.platform === 'win32' ? '' : 'nice -n 10 ';

const searchCache = new Map();
const MAX_CACHE_SIZE = 50;

const EXEC_OPTIONS = {
  timeout: 30000,
  encoding: 'utf8',
  env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
};

function isUrl(str) {
  try { new URL(str); return true; } catch { return false; }
}

function isYouTubePlaylistUrl(str) {
  try {
    const url = new URL(str);
    return url.hostname.includes('youtube.com') && url.searchParams.has('list');
  } catch { return false; }
}

// ─── Normalizzazione URL YouTube ─────────────────────────────────────────────
// Converte qualsiasi variante di link YouTube in un URL canonico pulito.
//
// Problemi risolti:
//   • youtu.be/ID?si=...  → youtube.com/watch?v=ID
//     Il parametro ?si= è un token di tracking condivisione. Alcune versioni
//     di yt-dlp (specie su Termux/Android) non gestiscono correttamente il
//     redirect che genera, facendo fallire silenziosamente l'estrazione.
//   • youtube.com/watch?v=ID&pp=...&feature=...
//     Parametri di tracking aggiuntivi che possono causare comportamenti
//     inattesi con certi estrattori.
//
// Vengono preservati solo i parametri semanticamente rilevanti: `v` (video id).
// `list` viene intenzionalmente scartato perché a questo punto siamo già
// in fase di riproduzione di una singola traccia (le playlist sono già state
// espanse in fetchYouTubePlaylist).
function normalizeYouTubeUrl(url) {
  try {
    const u = new URL(url);

    // youtu.be/VIDEO_ID[?qualsiasi_cosa]
    if (u.hostname === 'youtu.be') {
      const videoId = u.pathname.slice(1); // rimuove lo '/' iniziale
      if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
    }

    // youtube.com/watch?v=VIDEO_ID[&si=...&pp=...&feature=...]
    if (u.hostname.includes('youtube.com') && u.pathname === '/watch') {
      const v = u.searchParams.get('v');
      if (v) return `https://www.youtube.com/watch?v=${v}`;
    }
  } catch (_) {}

  return url; // URL non YouTube: restituisce invariato
}

async function fetchYouTubePlaylist(url) {
  const cmd = `${NICE}"${YTDLP_BIN}" --flat-playlist --no-cache-dir --ignore-errors --extractor-args "youtube:player_client=ios,mweb" --print "%(title)s|||%(webpage_url)s|||%(duration)s" "${url}"`;
  const { stdout } = await execAsync(cmd, { ...EXEC_OPTIONS, timeout: 120000 });

  const tracks = [];
  for (const line of stdout.trim().split('\n').filter(Boolean)) {
    const [title, webUrl, durationStr] = line.split('|||');
    if (title && webUrl && webUrl.startsWith('http')) {
      tracks.push({
        title,
        // Normalizziamo subito: i webUrl delle playlist possono contenere
        // parametri ?si= o altri token spuri che causano problemi in streaming.
        webUrl: normalizeYouTubeUrl(webUrl),
        platform: 'YouTube',
        duration: parseInt(durationStr) || 0,
      });
    }
  }
  return tracks;
}

async function search(query) {
  if (searchCache.has(query)) return searchCache.get(query);

  if (isSpotifyUrl(query)) {
    query = await getSpotifyTrackQuery(query);
  }

  let songInfo;

  if (isUrl(query)) {
    // Normalizziamo prima di passare a yt-dlp: rimuove ?si=, ?pp=, converte
    // youtu.be → youtube.com/watch?v= ecc.
    const cleanUrl = normalizeYouTubeUrl(query);
    try {
      const cmd = `${NICE}"${YTDLP_BIN}" --no-playlist --no-cache-dir --extractor-args "youtube:player_client=ios,mweb" --print "%(title)s|||%(duration)s" "${cleanUrl}"`;
      const { stdout } = await execAsync(cmd, EXEC_OPTIONS);
      const [title, durationStr] = stdout.trim().split('\n')[0].split('|||');
      songInfo = {
        title: title || cleanUrl,
        webUrl: cleanUrl,
        platform: 'Link diretto',
        duration: parseInt(durationStr) || 0,
      };
    } catch {
      throw new Error('Non riesco a riprodurre quel link.');
    }
  } else {
    const searches = [
      { prefix: 'ytmsearch1', platform: 'YouTube Music', suffix: ' official audio' },
      { prefix: 'ytmsearch1', platform: 'YouTube Music', suffix: '' },
      { prefix: 'ytsearch1',  platform: 'YouTube',       suffix: ' official audio' },
      { prefix: 'ytsearch1',  platform: 'YouTube',       suffix: '' },
    ];

    for (const { prefix, platform, suffix } of searches) {
      try {
        const escaped = (query + suffix).replace(/"/g, '\\"');
        const cmd = `${NICE}"${YTDLP_BIN}" --no-playlist --no-cache-dir --extractor-args "youtube:player_client=ios,mweb" --print "%(title)s|||%(webpage_url)s|||%(duration)s" "${prefix}:${escaped}"`;
        const { stdout } = await execAsync(cmd, EXEC_OPTIONS);
        const lines = stdout.trim().split('\n').filter(Boolean);
        if (lines.length > 0) {
          const [title, webUrl, durationStr] = lines[0].split('|||');
          if (title && webUrl) {
            songInfo = { title, webUrl, platform, duration: parseInt(durationStr) || 0 };
            break;
          }
        }
      } catch (_) { continue; }
    }

    if (!songInfo) throw new Error(`Canzone non trovata: ${query}`);
  }

  searchCache.set(query, songInfo);
  if (searchCache.size > MAX_CACHE_SIZE) {
    searchCache.delete(searchCache.keys().next().value);
  }

  return songInfo;
}

module.exports = { search, isYouTubePlaylistUrl, fetchYouTubePlaylist, normalizeYouTubeUrl };
