// ─── Ricerca canzone con cache ────────────────────────────────────────────────
// Usa yt-dlp per cercare su YouTube Music e YouTube.
// Mantiene una cache LRU delle ultime MAX_CACHE_SIZE ricerche.
//
// Note:
//   - MAX_CACHE_SIZE ridotto da 200 a 50: ogni voce vive in RAM per l'intera
//     sessione. 200 voci dopo ore di utilizzo accumulano memoria inutilmente.
//   - --no-cache-dir aggiunto a tutte le chiamate yt-dlp: impedisce l'accumulo
//     di centinaia di MB in ~/.cache/yt-dlp nel corso della sessione.

const { exec } = require('child_process');
const { promisify } = require('util');
const { YTDLP_BIN } = require('./config');

const execAsync = promisify(exec);

const searchCache = new Map();
const MAX_CACHE_SIZE = 50;                         // ← ridotto da 200

function isUrl(str) {
  try { new URL(str); return true; } catch { return false; }
}

async function search(query) {
  if (searchCache.has(query)) {
    return searchCache.get(query);
  }

  let songInfo;

  if (isUrl(query)) {
    try {
      const cmd = `"${YTDLP_BIN}" --no-playlist --no-cache-dir --print "%(title)s" "${query}"`;
      // ↑ --no-cache-dir aggiunto
      const { stdout } = await execAsync(cmd, {
        timeout: 30000,
        encoding: 'utf8',
        env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
      });
      const title = stdout.trim().split('\n')[0] || query;
      songInfo = { title, webUrl: query, platform: 'Link diretto' };
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
        const cmd = `"${YTDLP_BIN}" --no-playlist --no-cache-dir --print "%(title)s|||%(webpage_url)s" "${prefix}:${escaped}"`;
        // ↑ --no-cache-dir aggiunto
        const { stdout } = await execAsync(cmd, {
          timeout: 30000,
          encoding: 'utf8',
          env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
        });
        const lines = stdout.trim().split('\n').filter(Boolean);
        if (lines.length > 0) {
          const [title, webUrl] = lines[0].split('|||');
          if (title && webUrl) {
            songInfo = { title, webUrl, platform };
            break;
          }
        }
      } catch (_) { continue; }
    }

    if (!songInfo) throw new Error(`Canzone non trovata: ${query}`);
  }

  // Cache LRU: rimuove la voce più vecchia se supera il limite
  searchCache.set(query, songInfo);
  if (searchCache.size > MAX_CACHE_SIZE) {
    searchCache.delete(searchCache.keys().next().value);
  }

  return songInfo;
}

module.exports = { search };