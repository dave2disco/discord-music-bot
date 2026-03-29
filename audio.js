// ─── Streaming audio ─────────────────────────────────────────────────────────
// Pipeline: yt-dlp → (pipe) → ffmpeg → OggOpus → @discordjs/voice
//
// Scelte tecniche:
//   - Output OggOpus invece di PCM grezzo: riduce il throughput di ~85×,
//     eliminando la causa principale di buffer underrun e gracchiamento.
//   - highWaterMark 512 KB: riduce i micro-stall durante picchi di latenza di rete.
//   - Formato yt-dlp flessibile: preferisce audio ≤160 kbps, fallback su bestaudio.
//   - -reconnect NON usato: funziona solo con input HTTP diretti, non con pipe:0.

const { spawn } = require('child_process');
const { createAudioResource, StreamType } = require('@discordjs/voice');
const { EmbedBuilder } = require('discord.js');
const { YTDLP_BIN, FFMPEG_BIN } = require('./config');
const { queues } = require('./queue');

function createAudioStream(webUrl, title) {
  const ytdlp = spawn(YTDLP_BIN, [
    '--no-playlist',
    '-f', 'bestaudio[abr<=160]/bestaudio',
    '--no-warnings',
    '-o', '-',
    webUrl,
  ], {
    stdio: ['ignore', 'pipe', 'ignore'],
    highWaterMark: 512 * 1024,
  });

  const ffmpeg = spawn(FFMPEG_BIN, [
    '-i', 'pipe:0',
    '-vn',
    '-c:a', 'libopus',
    '-b:a', '128k',
    '-ar', '48000',
    '-ac', '2',
    '-f', 'ogg',
    '-loglevel', 'error',
    'pipe:1',
  ], {
    stdio: ['pipe', 'pipe', 'ignore'],
    highWaterMark: 512 * 1024,
  });

  ytdlp.stdout.pipe(ffmpeg.stdin);

  ytdlp.stdout.on('error', (err) => console.error(`[ytdlp stdout] ${title}:`, err.message));
  ffmpeg.stdin.on('error', (err) => console.error(`[ffmpeg stdin] ${title}:`, err.message));
  ffmpeg.stdout.on('error', (err) => console.error(`[ffmpeg stdout] ${title}:`, err.message));
  ytdlp.on('error', (err) => console.error(`[ytdlp] ${title}:`, err.message));
  ffmpeg.on('error', (err) => console.error(`[ffmpeg] ${title}:`, err.message));

  ytdlp.on('exit', (code, signal) =>
    console.log(`✅ yt-dlp completato: "${title}" (code=${code}, signal=${signal})`));
  ffmpeg.on('exit', (code, signal) =>
    console.log(`✅ ffmpeg completato: "${title}" (code=${code}, signal=${signal})`));

  return { stream: ffmpeg.stdout, processes: [ytdlp, ffmpeg] };
}

async function playNext(guildId, channel) {
  const queue = queues.get(guildId);
  if (!queue || queue.songs.length === 0) {
    if (queue?.connection) {
      setTimeout(() => {
        try { queue.connection.destroy(); } catch (_) {}
        queues.delete(guildId);
      }, 5000);
    }
    return;
  }

  const song = queue.songs[0];
  queue.playing = true;

  try {
    queue.killCurrentProcesses();
    const { stream, processes } = createAudioStream(song.webUrl, song.title);
    queue.currentProcesses = processes;

    const resource = createAudioResource(stream, { inputType: StreamType.OggOpus });
    queue.player.play(resource);

    const embed = new EmbedBuilder()
      .setColor(0x1DB954)
      .setTitle('🎵 In riproduzione')
      .setDescription(`**${song.title}**`)
      .setFooter({ text: `Richiesto da ${song.requestedBy} • ${song.platform}` });

    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error(`❌ Errore riproduzione [${song.title}]:`, err.message);
    await channel.send(`❌ Errore durante la riproduzione: ${err.message}`);
    queue.songs.shift();
    queue.playing = false;
    playNext(guildId, channel);
  }
}

module.exports = { createAudioStream, playNext };
