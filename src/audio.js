const { spawn } = require('child_process');
const { createAudioResource, StreamType, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const { YTDLP_BIN, FFMPEG_BIN } = require('./config');
const { queues } = require('./queue');
const { normalizeYouTubeUrl } = require('./search');

const IS_WIN = process.platform === 'win32';

function formatTime(seconds) {
  if (!seconds || seconds <= 0) return '?:??';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function spawnNice(bin, args, opts) {
  if (IS_WIN) return spawn(bin, args, opts);
  return spawn('nice', ['-n', '10', bin, ...args], opts);
}

function createSilenceResource(durationMs = 300) {
  const proc = spawnNice(FFMPEG_BIN, [
    '-f', 'lavfi',
    '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-t', String(durationMs / 1000),
    '-c:a', 'libopus',
    '-b:a', '96k',
    '-ar', '48000',
    '-ac', '2',
    '-f', 'ogg',
    '-loglevel', 'error',
    'pipe:1',
  ], {
    stdio: ['ignore', 'pipe', 'ignore'],
    highWaterMark: 16 * 1024,
  });

  proc.on('error', (err) => console.error('[silence ffmpeg]', err.message));
  proc.stdout.on('error', (err) => {
    if (err.code !== 'ERR_STREAM_DESTROYED') {
      console.error('[silence stdout]', err.message);
    }
  });

  const resource = createAudioResource(proc.stdout, { inputType: StreamType.OggOpus });
  return { resource, process: proc };
}

function createAudioStream(webUrl, title, guildId) {

  const cleanUrl = normalizeYouTubeUrl(webUrl);

  const ytdlp = spawnNice(YTDLP_BIN, [
    '--no-playlist',
    '--no-cache-dir',
    '-f', 'bestaudio[abr<=96]/bestaudio[abr<=160]/bestaudio',
    '--no-warnings',

    '--extractor-args', 'youtube:skip=dash,translated_subs',

    '--socket-timeout', '15',

    '--retries', '3',
    '-o', '-',
    cleanUrl,
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    highWaterMark: 512 * 1024,
  });

  const ffmpeg = spawnNice(FFMPEG_BIN, [
    '-analyzeduration', '0',
    '-probesize', '32K',
    '-i', 'pipe:0',
    '-vn',
    '-c:a', 'libopus',
    '-b:a', '96k',
    '-ar', '48000',
    '-ac', '2',
    '-f', 'ogg',
    '-bufsize', '512k',
    '-loglevel', 'error',
    'pipe:1',
  ], {
    stdio: ['pipe', 'pipe', 'ignore'],
    highWaterMark: 64 * 1024,
  });

  ytdlp.stdout.pipe(ffmpeg.stdin);

  ffmpeg.stdin.on('error', (err) => {
    if (err.code !== 'EPIPE') console.error(`[ffmpeg stdin] ${title}:`, err.message);
  });
  ytdlp.stdout.on('error', (err) => {
    if (err.code !== 'EPIPE' && err.code !== 'ERR_STREAM_DESTROYED') {
      console.error(`[ytdlp stdout] ${title}:`, err.message);
    }
  });
  ffmpeg.stdout.on('error', (err) => {
    if (err.code !== 'ERR_STREAM_DESTROYED') {
      console.error(`[ffmpeg stdout] ${title}:`, err.message);
    }
  });

  let ytdlpStderr = '';
  ytdlp.stderr.on('data', (chunk) => { ytdlpStderr += chunk.toString(); });
  ytdlp.on('exit', (code) => {
    if (code !== 0 && code !== null && ytdlpStderr.trim()) {
      console.error(`[ytdlp exit ${code}] ${title}: ${ytdlpStderr.trim().split('\n').pop()}`);
    }
  });

  ytdlp.on('error', (err) => console.error(`[ytdlp] ${title}:`, err.message));
  ffmpeg.on('error', (err) => console.error(`[ffmpeg] ${title}:`, err.message));

  ffmpeg.on('exit', (code, signal) => {
    if (signal === 'SIGKILL') {
      const queue = queues.get(guildId);
      if (queue) queue.oomKilled = true;
      console.warn(`⚠ OOM killer su "${title}" — termino yt-dlp`);
      try { ytdlp.kill('SIGTERM'); } catch (_) {}
      try { ffmpeg.stdout.destroy(); } catch (_) {}
    }
  });

  return { stream: ffmpeg.stdout, processes: [ytdlp, ffmpeg] };
}

async function playNext(guildId, channel) {
  const queue = queues.get(guildId);

  if (!queue || queue.songs.length === 0) {
    if (queue?.connection) {
      queue.startInactivityTimer(() => {
        console.log(`⏾ Disconnessione per inattività (5 min) — guild ${guildId}`);
        try { queue.connection.destroy(); } catch (_) {}
        queues.delete(guildId);
        channel.send('👋 Disconnesso per inattività.').catch(() => {});
      });
    }
    return;
  }

  if (queue.playing) return;

  queue.cancelInactivityTimer();

  if (queue.connection.state.status !== VoiceConnectionStatus.Ready) {
    console.log(`⏳ Aspetto connessione vocale prima di riprodurre...`);
    try {
      await entersState(queue.connection, VoiceConnectionStatus.Ready, 15_000);
    } catch {
      await channel.send('❌ Impossibile stabilire la connessione vocale. Riprova il comando.').catch(() => {});
      queues.delete(guildId);
      return;
    }
  }

  const song = queue.songs[0];
  queue.playing = true;

  try {
    let stream, processes;

    if (queue.prefetchedStream) {

      console.log(`⚡ Stream prefetchato pronto per "${song.title}"`);
      ({ stream, processes } = queue.prefetchedStream);
      queue.prefetchedStream = null;
    } else {

      queue.killCurrentProcesses();
      ({ stream, processes } = createAudioStream(song.webUrl, song.title, guildId));
    }

    queue.currentProcesses = processes;
    queue.startedAt = Date.now();

    const durStr = song.duration ? ` [${formatTime(song.duration)}]` : '';
    console.log(`▶ "${song.title}" — ${song.platform}${durStr}`);

    const resource = createAudioResource(stream, { inputType: StreamType.OggOpus });
    queue.player.play(resource);

  } catch (err) {
    console.error(`✗ Errore riproduzione "${song.title}": ${err.message}`);
    queue.prefetchedStream = null;
    await channel.send(`❌ Errore durante la riproduzione: ${err.message}`).catch(() => {});
    queue.songs.shift();
    queue.playing = false;
    queue.consecutiveFailures++;
    if (queue.consecutiveFailures >= 3) {
      queue.consecutiveFailures = 0;
      channel.send('❌ Troppi errori consecutivi. Riproduzione interrotta.').catch(() => {});
      return;
    }
    playNext(guildId, channel);
  }
}

module.exports = { createAudioStream, createSilenceResource, playNext, formatTime };

