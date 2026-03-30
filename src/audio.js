// ─── Streaming audio ─────────────────────────────────────────────────────────
// Pipeline: yt-dlp → (pipe) → ffmpeg → OggOpus → @discordjs/voice
//
// Scelte tecniche:
//   - Output OggOpus invece di PCM grezzo: riduce il throughput di ~85×,
//     eliminando la causa principale di buffer underrun e gracchiamento.
//   - highWaterMark ridotto a 128 KB (yt-dlp) / 64 KB (ffmpeg): l'output
//     Opus è già compresso, buffer grandi non danno vantaggi e consumano RAM.
//   - -analyzeduration 0 / -probesize 32: impedisce a ffmpeg di caricare
//     in memoria metadati dell'intero file prima di iniziare lo stream.
//   - -bufsize 64k: limite esplicito del buffer di output di ffmpeg.
//   - --no-cache-dir: yt-dlp non accumula cache su disco nel tempo.
//   - Gestione SIGKILL: quando Android OOM-killa ffmpeg, yt-dlp viene
//     terminato esplicitamente per evitare che continui a bufferizzare.
//   - EPIPE su ffmpeg.stdin è atteso e silenziato: accade ogni volta che
//     ffmpeg muore prima che yt-dlp finisca di inviare dati.

const { spawn } = require('child_process');
const { createAudioResource, StreamType } = require('@discordjs/voice');
const { EmbedBuilder } = require('discord.js');
const { YTDLP_BIN, FFMPEG_BIN } = require('./config');
const { queues } = require('./queue');

function createAudioStream(webUrl, title) {
  const ytdlp = spawn(YTDLP_BIN, [
    '--no-playlist',
    '--no-cache-dir',                              // ← non accumula cache su disco nel tempo
    '-f', 'bestaudio[abr<=96]/bestaudio[abr<=160]/bestaudio', // ← preferisce bitrate basso
    '--no-warnings',
    '-o', '-',
    webUrl,
  ], {
    stdio: ['ignore', 'pipe', 'ignore'],
    highWaterMark: 128 * 1024,                     // ← ridotto da 512 KB a 128 KB
  });

  const ffmpeg = spawn(FFMPEG_BIN, [
    '-analyzeduration', '0',                       // ← non analizza l'intero file in RAM all'avvio
    '-probesize', '32',                            // ← riduce ulteriormente la memoria di probe
    '-i', 'pipe:0',
    '-vn',
    '-c:a', 'libopus',
    '-b:a', '96k',                                 // ← ridotto da 128k: inudibile su Discord
    '-ar', '48000',
    '-ac', '2',
    '-f', 'ogg',
    '-bufsize', '64k',                             // ← limite esplicito buffer output ffmpeg
    '-loglevel', 'error',
    'pipe:1',
  ], {
    stdio: ['pipe', 'pipe', 'ignore'],
    highWaterMark: 64 * 1024,                      // ← ridotto da 512 KB a 64 KB
  });

  ytdlp.stdout.pipe(ffmpeg.stdin);

  // EPIPE su ffmpeg.stdin è atteso ogni volta che ffmpeg termina prima di yt-dlp.
  // Loggarla come errore era fuorviante: la si silenzia.
  ffmpeg.stdin.on('error', (err) => {
    if (err.code !== 'EPIPE') {
      console.error(`[ffmpeg stdin] ${title}:`, err.message);
    }
  });

  // ERR_STREAM_DESTROYED accade quando il pipe viene distrutto ordinatamente.
  ytdlp.stdout.on('error', (err) => {
    if (err.code !== 'EPIPE' && err.code !== 'ERR_STREAM_DESTROYED') {
      console.error(`[ytdlp stdout] ${title}:`, err.message);
    }
  });

  ffmpeg.stdout.on('error', (err) => console.error(`[ffmpeg stdout] ${title}:`, err.message));
  ytdlp.on('error',  (err) => console.error(`[ytdlp] ${title}:`, err.message));
  ffmpeg.on('error', (err) => console.error(`[ffmpeg] ${title}:`, err.message));

  ytdlp.on('exit', (code, signal) => {
    const status = signal ? `signal=${signal}` : `code=${code}`;
    console.log(`✅ yt-dlp completato: "${title}" (${status})`);
  });

  ffmpeg.on('exit', (code, signal) => {
    const status = signal ? `signal=${signal}` : `code=${code}`;
    console.log(`✅ ffmpeg completato: "${title}" (${status})`);

    if (signal === 'SIGKILL') {
      // Android OOM killer ha ucciso ffmpeg.
      // Senza questo, yt-dlp continua a scrivere su una pipe chiusa
      // e bufferizza in memoria finché non viene killato a sua volta.
      console.warn(`[OOM] Android ha ucciso ffmpeg durante "${title}". Termino yt-dlp.`);
      try { ytdlp.kill('SIGTERM'); } catch (_) {}
    }
  });

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