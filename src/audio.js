const { spawn } = require('child_process');
const { createAudioResource, StreamType, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const { YTDLP_BIN, FFMPEG_BIN } = require('./config');
const { queues } = require('./queue');

function formatTime(seconds) {
  if (!seconds || seconds <= 0) return '?:??';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─── Silence buffer ──────────────────────────────────────────────────────────
// Genera `durationMs` ms di silenzio OggOpus usando ffmpeg + anullsrc.
// Scopo: svuotare il jitter buffer lato client di Discord tra una canzone e
// l'altra. Il jitter buffer può contenere fino a ~500-1000 ms di audio residuo
// della canzone precedente; riproducendo questo silenzio lo spingiamo fuori
// prima che parta la canzone successiva, eliminando il "millisecondo di canzone
// vecchia" che si sentiva all'inizio di ogni nuova traccia.
function createSilenceResource(durationMs = 500) {
  const proc = spawn(FFMPEG_BIN, [
    '-f', 'lavfi',
    '-i', `anullsrc=channel_layout=stereo:sample_rate=48000`,
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
  const ytdlp = spawn(YTDLP_BIN, [
    '--no-playlist',
    '--no-cache-dir',
    '-f', 'bestaudio[abr<=96]/bestaudio[abr<=160]/bestaudio',
    '--no-warnings',
    '-o', '-',
    webUrl,
  ], {
    stdio: ['ignore', 'pipe', 'ignore'],
    highWaterMark: 512 * 1024,
  });

  const ffmpeg = spawn(FFMPEG_BIN, [
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
    queue.killCurrentProcesses();
    const { stream, processes } = createAudioStream(song.webUrl, song.title, guildId);
    queue.currentProcesses = processes;
    queue.startedAt = Date.now();

    const durStr = song.duration ? ` [${formatTime(song.duration)}]` : '';
    console.log(`▶ "${song.title}" — ${song.platform}${durStr}`);

    const resource = createAudioResource(stream, { inputType: StreamType.OggOpus });
    queue.player.play(resource);

  } catch (err) {
    console.error(`✗ Errore riproduzione "${song.title}": ${err.message}`);
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
