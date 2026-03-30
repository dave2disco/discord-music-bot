const { exec } = require('child_process');
const { promisify } = require('util');
const { YTDLP_BIN } = require('./config');
const { isSpotifyUrl, getSpotifyTrackQuery } = require('./spotify');

const execAsync = promisify(exec);

// Su Linux/Termux abbassa la priorità CPU dei processi di ricerca
// così ffmpeg (audio streaming) non viene privato di CPU durante il caricamento playlist.
// Su Windows nice non esiste, quindi non viene usato.
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

async function fetchYouTubePlaylist(url) {
  const cmd = `${NICE}"${YTDLP_BIN}" --flat-playlist --no-cache-dir --ignore-errors --print "%(title)s|||%(webpage_url)s|||%(duration)s" "${url}"`;
  const { stdout } = await execAsync(cmd, { ...EXEC_OPTIONS, timeout: 120000 });

  const tracks = [];
  for (const line of stdout.trim().split('\n').filter(Boolean)) {
    const [title, webUrl, durationStr] = line.split('|||');
    if (title && webUrl && webUrl.startsWith('http')) {
      tracks.push({
        title,
        webUrl,
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
    try {
      const cmd = `${NICE}"${YTDLP_BIN}" --no-playlist --no-cache-dir --print "%(title)s|||%(duration)s" "${query}"`;
      const { stdout } = await execAsync(cmd, EXEC_OPTIONS);
      const [title, durationStr] = stdout.trim().split('\n')[0].split('|||');
      songInfo = {
        title:    title || query,
        webUrl:   query,
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
        const cmd = `${NICE}"${YTDLP_BIN}" --no-playlist --no-cache-dir --print "%(title)s|||%(webpage_url)s|||%(duration)s" "${prefix}:${escaped}"`;
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

module.exports = { search, isYouTubePlaylistUrl, fetchYouTubePlaylist };