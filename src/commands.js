const {
  joinVoiceChannel,
  createAudioPlayer,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');
const { EmbedBuilder } = require('discord.js');
const { queues, ServerQueue } = require('./queue');
const { search, isYouTubePlaylistUrl, fetchYouTubePlaylist } = require('./search');
const { isSpotifyPlaylistUrl, fetchSpotifyPlaylistTracks } = require('./spotify');
const { playNext, formatTime, createSilenceResource } = require('./audio');

function buildSong(info, requestedBy) {
  return {
    title: info.title,
    webUrl: info.webUrl,
    platform: info.platform || 'Link diretto',
    duration: info.duration || 0,
    requestedBy,
  };
}

function getOrCreateQueue(guildId, voiceChannel, message) {
  const existing = queues.get(guildId);
  if (existing) return existing;

  const queue = new ServerQueue();
  queues.set(guildId, queue);

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId,
    adapterCreator: message.guild.voiceAdapterCreator,
  });
  const player = createAudioPlayer();
  connection.subscribe(player);
  queue.connection = connection;
  queue.player = player;

  const channel = message.channel;
  queue.textChannel = channel;

  // ─── "In riproduzione" solo quando l'audio parte davvero ─────────────────
  // Buffering→Playing = nuova canzone vera.
  // Paused→Playing = resume (già gestito da cmdResume).
  // Il silence buffer non deve generare embed (q.silencing è true in quel momento).
  player.on(AudioPlayerStatus.Playing, (oldState) => {
    if (oldState.status !== AudioPlayerStatus.Buffering) return;

    const q = queues.get(guildId);
    if (!q || !q.songs[0] || q.silencing) return;

    const song = q.songs[0];
    const embed = new EmbedBuilder()
      .setColor(0x1DB954)
      .setTitle('🎵 In riproduzione')
      .setDescription(`**${song.title}**`)
      .setFooter({ text: `Richiesto da ${song.requestedBy} • ${song.platform}` });

    channel.send({ embeds: [embed] }).catch(() => {});
  });

  // ─── Handler Idle ─────────────────────────────────────────────────────────
  player.on(AudioPlayerStatus.Idle, (oldState) => {
    if (oldState.status === AudioPlayerStatus.Idle) return;

    const q = queues.get(guildId);
    if (!q) return;

    // ── SILENCE BUFFER TERMINATO → avvia la canzone successiva ──────────────
    if (q.silencing) {
      q.silencing = false;
      q.killCurrentProcesses();
      q.playing = false;
      playNext(guildId, channel);
      return;
    }

    // ── FINE CANZONE / SKIP ───────────────────────────────────────────────────
    const finished = q.songs[0];
    if (finished) {
      if (q.skipping)       console.log(`⏭ "${finished.title}" — skippata`);
      else if (q.oomKilled) console.log(`↻ Riprendo dopo OOM killer`);
      else                  console.log(`✓ "${finished.title}" — completata`);
    }

    let shouldStop = false;

    if (!q.skipping && !q.oomKilled) {
      const playedMs = q.startedAt ? Date.now() - q.startedAt : 0;
      if (playedMs < 3000) {
        q.consecutiveFailures++;
        console.warn(`⚠ Fallimento rapido #${q.consecutiveFailures} per "${finished?.title}" (durata: ${playedMs}ms)`);
        if (q.consecutiveFailures >= 3) {
          channel.send(
            `❌ **${q.consecutiveFailures} canzoni consecutive** non riuscite a riprodursi.\n` +
            `Possibile problema di connessione o con i link. Riproduzione interrotta.\n` +
            `Usa \`-play\` per riprovare o \`-skip\` per saltare.`
          ).catch(() => {});
          q.killCurrentProcesses();
          q.songs = [];
          q.playing = false;
          q.consecutiveFailures = 0;
          shouldStop = true;
        }
      } else {
        q.consecutiveFailures = 0;
      }
    }

    if (shouldStop) return;

    const wasOomKilled = q.oomKilled;

    q.skipping  = false;
    q.oomKilled = false;
    q.killCurrentProcesses();
    q.songs.shift();

    // ── SILENCE BUFFER ───────────────────────────────────────────────────────
    // Inserito tra ogni canzone e la successiva, incluso dopo uno skip.
    // Scopo: svuotare il jitter buffer lato client Discord (~500ms) per
    // evitare che i frame audio residui della canzone precedente vengano
    // riprodotti all'inizio di quella successiva.
    //
    // Non viene inserito solo nei casi in cui non c'è una canzone successiva
    // o quando l'OOM killer ha terminato il processo (in quel caso vogliamo
    // riprendere immediatamente la stessa canzone dall'inizio).
    if (q.songs.length > 0 && !wasOomKilled && q.consecutiveFailures === 0) {
      const { resource: silenceResource, process: silenceProc } = createSilenceResource(500);
      q.silencing = true;
      q.currentProcesses = [silenceProc];
      q.player.play(silenceResource);
      // q.playing rimane true durante il silence buffer
      return;
    }

    // ── TRANSIZIONE DIRETTA (OOM, fallimenti, coda vuota) ────────────────────
    q.playing = false;
    playNext(guildId, channel);
  });

  // ─── Handler errori player ────────────────────────────────────────────────
  player.on('error', async (error) => {
    // "Premature close" è sempre generato da killCurrentProcesses() —
    // è intenzionale e non va mai mostrato all'utente.
    if (error.message === 'Premature close') {
      console.warn(`[player] Premature close (atteso — killCurrentProcesses)`);
      return;
    }

    const q = queues.get(guildId);
    // Queue rimossa (es. dopo -stop): errore post-mortem, ignora completamente.
    if (!q) return;

    console.error(`✗ Errore player: ${error.message}`);
    await channel.send(`❌ Errore audio: ${error.message}`);
    q.killCurrentProcesses();
    q.songs.shift();
    q.playing = false;
    playNext(guildId, channel);
  });

  entersState(connection, VoiceConnectionStatus.Ready, 30_000)
    .then(() => {
      console.log(`✔ Connessione vocale pronta — guild ${guildId}`);

      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
        } catch {
          const q = queues.get(guildId);
          if (q) q.killCurrentProcesses();
          connection.destroy();
          queues.delete(guildId);
        }
      });
    })
    .catch(() => {
      console.error(`✗ Connessione vocale mai raggiunta — guild ${guildId}`);
      const q = queues.get(guildId);
      if (q) q.killCurrentProcesses();
      try { connection.destroy(); } catch (_) {}
      queues.delete(guildId);
      channel.send('❌ Impossibile connettersi al canale vocale entro 30 secondi. Riprova.').catch(() => {});
    });

  return queue;
}

async function cmdPlay(message, args) {
  if (!args.length) return message.reply('❌ Specifica una canzone o un link.');

  const voiceChannel = message.member.voice.channel;
  if (!voiceChannel) return message.reply('❌ Devi essere in un canale vocale.');

  const query = args.join(' ');
  const guildId = message.guild.id;
  const username = message.author.username;

  if (isYouTubePlaylistUrl(query)) {
    const loading = await message.reply('⏳ Carico la playlist YouTube...');
    let tracks;
    try {
      tracks = await fetchYouTubePlaylist(query);
    } catch (err) {
      return loading.edit(`❌ Errore playlist: ${err.message}`);
    }
    if (!tracks.length) return loading.edit('❌ Playlist vuota o non accessibile.');

    const queue = getOrCreateQueue(guildId, voiceChannel, message);
    const wasEmpty = queue.songs.length === 0 && !queue.playing;

    queue.playlistLoaderId++;

    for (const track of tracks) {
      queue.songs.push(buildSong(track, username));
    }

    await loading.edit(`✅ **${tracks.length}** tracce aggiunte alla coda.`);
    console.log(`📋 Playlist YouTube: ${tracks.length} tracce caricate`);

    if (wasEmpty) playNext(guildId, message.channel);
    return;
  }

  if (isSpotifyPlaylistUrl(query)) {
    const loading = await message.reply('⏳ Leggo la playlist Spotify...');
    let tracks;
    try {
      tracks = await fetchSpotifyPlaylistTracks(query);
    } catch (err) {
      return loading.edit(`❌ Errore playlist Spotify: ${err.message}`);
    }
    if (!tracks.length) return loading.edit('❌ Playlist Spotify vuota o non accessibile.');

    const queue = getOrCreateQueue(guildId, voiceChannel, message);
    const wasEmpty = queue.songs.length === 0 && !queue.playing;

    queue.playlistLoaderId++;
    const loaderId = queue.playlistLoaderId;

    await loading.edit(
      `🔍 Trovate **${tracks.length}** tracce — cerco su YouTube in background...`
    );
    console.log(`📋 Playlist Spotify: ${tracks.length} tracce da cercare su YouTube`);

    let firstLoaded = false;

    ;(async () => {
      for (let i = 0; i < tracks.length; i++) {
        const currentQueue = queues.get(guildId);
        if (!currentQueue || currentQueue.playlistLoaderId !== loaderId) {
          console.log(`↩ Loader playlist Spotify annullato`);
          return;
        }

        try {
          const result = await search(tracks[i].searchQuery);
          const q = queues.get(guildId);
          if (!q || q.playlistLoaderId !== loaderId) return;

          q.songs.push({
            title: result.title,
            webUrl: result.webUrl,
            platform: 'Spotify → YouTube Music',
            duration: result.duration || 0,
            requestedBy: username,
          });

          if (!firstLoaded) {
            firstLoaded = true;
            if (wasEmpty) playNext(guildId, message.channel);
          }
        } catch (_) {}

        await new Promise(r => setTimeout(r, 2000));
      }

      const finalQueue = queues.get(guildId);
      if (finalQueue?.playlistLoaderId === loaderId) {
        const loaded = finalQueue.songs.length;
        console.log(`✅ Playlist Spotify completata — ${loaded} tracce in coda`);
        message.channel.send(`✅ Playlist Spotify caricata: **${loaded}** tracce in coda.`).catch(() => {});
      }
    })();

    return;
  }

  const searching = await message.reply('🔍 Sto cercando...');
  let songInfo;
  try {
    songInfo = await search(query);
  } catch (err) {
    return searching.edit(`❌ ${err.message}`);
  }

  const song = buildSong(songInfo, username);
  const queue = getOrCreateQueue(guildId, voiceChannel, message);

  const wasEmpty = queue.songs.length === 0 && !queue.playing;
  queue.songs.push(song);

  if (wasEmpty) {
    await searching.edit(`✅ Trovato su **${song.platform}**: **${song.title}**`);
    playNext(guildId, message.channel);
  } else {
    await searching.edit(`➕ In coda (#${queue.songs.length}): **${song.title}**`);
  }
}

function cmdSkip(message) {
  const queue = queues.get(message.guild.id);
  if (!queue || !queue.playing) return message.reply('❌ Nessuna canzone in riproduzione.');

  // Se è in corso il silence buffer, lo fermiamo e andiamo direttamente
  // alla canzone successiva senza un altro silence (non c'è audio residuo).
  if (queue.silencing) {
    queue.silencing = false;
    queue.killCurrentProcesses();
    queue.player.stop(true);
    message.reply('⏭️ Canzone saltata!');
    return;
  }

  queue.skipping = true;
  queue.player.stop(true);
  message.reply('⏭️ Canzone saltata!');
}

function cmdPause(message) {
  const queue = queues.get(message.guild.id);
  if (!queue || !queue.playing) return message.reply('❌ Nessuna canzone in riproduzione.');
  if (queue.paused) return message.reply('⏸️ Già in pausa.');
  queue.player.pause();
  queue.paused = true;
  message.reply('⏸️ Messa in pausa.');
}

function cmdResume(message) {
  const queue = queues.get(message.guild.id);
  if (!queue || !queue.paused) return message.reply('❌ La musica non è in pausa.');
  queue.player.unpause();
  queue.paused = false;
  message.reply('▶️ Ripresa riproduzione.');
}

function cmdStop(message) {
  const queue = queues.get(message.guild.id);
  if (!queue) return message.reply('❌ Nessuna canzone in riproduzione.');

  queue.playlistLoaderId++;
  queue.skipping = true;
  queue.cancelInactivityTimer();
  queue.killCurrentProcesses();
  queue.songs = [];
  queue.player.stop();
  queue.connection.destroy();
  queues.delete(message.guild.id);
  message.reply('⏹️ Riproduzione fermata e coda svuotata.');
}

function cmdQueue(message) {
  const queue = queues.get(message.guild.id);
  if (!queue || queue.songs.length === 0) return message.reply('📭 La coda è vuota.');

  const list = queue.songs
    .map((s, i) => {
      const dur = s.duration ? ` [${formatTime(s.duration)}]` : '';
      return `${i === 0 ? '▶️' : `${i}.`} **${s.title}**${dur} — ${s.requestedBy}`;
    })
    .join('\n');

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`🎶 Coda musicale — ${queue.songs.length} tracce`)
    .setDescription(list.length > 4000 ? list.substring(0, 4000) + '\n...' : list);

  message.reply({ embeds: [embed] });
}

function cmdNowPlaying(message) {
  const queue = queues.get(message.guild.id);
  if (!queue || !queue.playing || !queue.songs[0]) {
    return message.reply('❌ Nessuna canzone in riproduzione.');
  }

  const song = queue.songs[0];
  const elapsed = queue.startedAt
    ? Math.floor((Date.now() - queue.startedAt) / 1000)
    : 0;
  const duration = song.duration || 0;

  let desc = `**${song.title}**`;
  if (duration > 0) {
    const filled = Math.min(20, Math.round((elapsed / duration) * 20));
    const bar = '▓'.repeat(filled) + '░'.repeat(20 - filled);
    desc += `\n\`${bar}\` ${formatTime(elapsed)} / ${formatTime(duration)}`;
  }
  if (queue.paused) desc += ' ⏸️';

  const embed = new EmbedBuilder()
    .setColor(0x1DB954)
    .setTitle('🎵 In riproduzione')
    .setDescription(desc)
    .setFooter({ text: `Richiesto da ${song.requestedBy} • ${song.platform}` });

  message.reply({ embeds: [embed] });
}

function cmdShuffle(message) {
  const queue = queues.get(message.guild.id);
  if (!queue || queue.songs.length <= 1) {
    return message.reply('❌ Non ci sono canzoni in coda da mescolare.');
  }

  const current = queue.songs[0];
  const rest = queue.songs.slice(1);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  queue.songs = [current, ...rest];
  message.reply(`🔀 Coda mescolata! (${rest.length} tracce)`);
}

function cmdRemove(message, args) {
  const queue = queues.get(message.guild.id);
  if (!queue || queue.songs.length === 0) return message.reply('❌ La coda è vuota.');

  const n = parseInt(args[0]);
  if (isNaN(n) || n < 1 || n >= queue.songs.length) {
    return message.reply(`❌ Numero non valido. Usa \`-queue\` per vedere i numeri delle canzoni in coda.`);
  }

  const removed = queue.songs.splice(n, 1)[0];
  message.reply(`🗑️ Rimossa dalla coda: **${removed.title}**`);
}

function cmdHelp(message) {
  message.reply([
    '🎵 **Comandi disponibili:**',
    '`-play [canzone o link]` (alias: `-p`) — Riproduce o aggiunge alla coda',
    ' Accetta: testo, link YouTube, link Spotify,',
    ' playlist YouTube, playlist Spotify',
    '`-skip` — Salta la canzone corrente',
    '`-pause` — Mette in pausa',
    '`-resume` — Riprende la riproduzione',
    '`-stop` — Ferma tutto e svuota la coda',
    '`-queue` — Mostra la coda con le durate',
    '`-remove <n>` — Rimuove la canzone numero N dalla coda',
    '`-nowplaying` — Canzone corrente con barra di avanzamento',
    '`-shuffle` — Mescola le canzoni in coda',
    '`-help` — Mostra questo messaggio',
  ].join('\n'));
}

module.exports = {
  cmdPlay,
  cmdSkip,
  cmdPause,
  cmdResume,
  cmdStop,
  cmdQueue,
  cmdHelp,
  cmdNowPlaying,
  cmdShuffle,
  cmdRemove,
};
