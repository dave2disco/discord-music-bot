// ─── Ricerca canzone con cache ────────────────────────────────────────────────
const { exec } = require('child_process');
const { promisify } = require('util');
const { YTDLP_BIN } = require('./config');
const { isSpotifyUrl, getSpotifyTrackQuery } = require('./spotify'); // ← aggiunto

const execAsync = promisify(exec);

const searchCache = new Map();
const MAX_CACHE_SIZE = 50;

function isUrl(str) {
  try { new URL(str); return true; } catch { return false; }
}

async function search(query) {
  if (searchCache.has(query)) {
    return searchCache.get(query);
  }

  // ── Spotify: converte il link in una query testuale, poi prosegue normalmente
  if (isSpotifyUrl(query)) {
    query = await getSpotifyTrackQuery(query);
    // Da qui in poi viene trattato come una normale ricerca testuale su YouTube
  }

  let songInfo;

  if (isUrl(query)) {
    try {
      const cmd = `"${YTDLP_BIN}" --no-playlist --no-cache-dir --print "%(title)s" "${query}"`;
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

  searchCache.set(query, songInfo);
  if (searchCache.size > MAX_CACHE_SIZE) {
    searchCache.delete(searchCache.keys().next().value);
  }

  return songInfo;
}

module.exports = { search };