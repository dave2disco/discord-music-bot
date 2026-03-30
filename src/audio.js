const { spawn } = require('child_process');
const { createAudioResource, StreamType } = require('@discordjs/voice');
const { EmbedBuilder } = require('discord.js');
const { YTDLP_BIN, FFMPEG_BIN } = require('./config');
const { queues } = require('./queue');

function formatTime(seconds) {
  if (!seconds || seconds <= 0) return '?:??';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
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
    highWaterMark: 128 * 1024,
  });

  const ffmpeg = spawn(FFMPEG_BIN, [
    '-analyzeduration', '0',
    '-probesize', '32',
    '-i', 'pipe:0',
    '-vn',
    '-c:a', 'libopus',
    '-b:a', '96k',
    '-ar', '48000',
    '-ac', '2',
    '-f', 'ogg',
    '-bufsize', '64k',
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

  ytdlp.on('error',  (err) => console.error(`[ytdlp]  ${title}:`, err.message));
  ffmpeg.on('error', (err) => console.error(`[ffmpeg] ${title}:`, err.message));

  ffmpeg.on('exit', (code, signal) => {
    if (signal === 'SIGKILL') {

      const queue = queues.get(guildId);
      if (queue) queue.oomKilled = true;
      console.warn(`⚠  OOM killer su "${title}" — termino yt-dlp`);
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
        console.log(`⏾  Disconnessione per inattività (5 min) — guild ${guildId}`);
        try { queue.connection.destroy(); } catch (_) {}
        queues.delete(guildId);
        channel.send('👋 Disconnesso per inattività.').catch(() => {});
      });
    }
    return;
  }

  if (queue.playing) return;

  queue.cancelInactivityTimer();

  const song = queue.songs[0];
  queue.playing = true;

  try {
    queue.killCurrentProcesses();
    const { stream, processes } = createAudioStream(song.webUrl, song.title, guildId);
    queue.currentProcesses = processes;
    queue.startedAt = Date.now();

    const durStr = song.duration ? ` [${formatTime(song.duration)}]` : '';
    console.log(`▶  "${song.title}" — ${song.platform}${durStr}`);

    const resource = createAudioResource(stream, { inputType: StreamType.OggOpus });
    queue.player.play(resource);

    const embed = new EmbedBuilder()
      .setColor(0x1DB954)
      .setTitle('🎵 In riproduzione')
      .setDescription(`**${song.title}**`)
      .setFooter({ text: `Richiesto da ${song.requestedBy} • ${song.platform}` });

    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error(`✗  Errore riproduzione "${song.title}": ${err.message}`);
    await channel.send(`❌ Errore durante la riproduzione: ${err.message}`);
    queue.songs.shift();
    queue.playing = false;
    playNext(guildId, channel);
  }
}

module.exports = { createAudioStream, playNext, formatTime };