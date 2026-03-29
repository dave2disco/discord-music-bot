// ─── Comandi ─────────────────────────────────────────────────────────────────

const {
  joinVoiceChannel,
  createAudioPlayer,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');
const { EmbedBuilder } = require('discord.js');
const { queues, ServerQueue } = require('./queue');
const { search } = require('./search');
const { playNext } = require('./audio');

// ── $play ─────────────────────────────────────────────────────────────────────
async function cmdPlay(message, args) {
  if (!args.length) return message.reply('❌ Specifica una canzone o link.');

  const voiceChannel = message.member.voice.channel;
  if (!voiceChannel) return message.reply('❌ Devi essere in un canale vocale.');

  const query = args.join(' ');
  const searching = await message.reply('🔍 Sto cercando la canzone...');

  let songInfo;
  try {
    songInfo = await search(query);
  } catch (err) {
    return searching.edit(`❌ ${err.message}`);
  }

  const song = {
    title:       songInfo.title,
    webUrl:      songInfo.webUrl,
    requestedBy: message.author.username,
    platform:    songInfo.platform || 'Link diretto',
  };

  const guildId = message.guild.id;
  let queue = queues.get(guildId);

  if (!queue) {
    queue = new ServerQueue();
    queues.set(guildId, queue);

    const connection = joinVoiceChannel({
      channelId:      voiceChannel.id,
      guildId,
      adapterCreator: message.guild.voiceAdapterCreator,
    });

    const player = createAudioPlayer();
    connection.subscribe(player);
    queue.connection = connection;
    queue.player = player;

    // Quando una traccia finisce, passa alla successiva
    player.on(AudioPlayerStatus.Idle, () => {
      queue.killCurrentProcesses();
      queue.songs.shift();
      queue.playing = false;
      playNext(guildId, message.channel);
    });

    // Errore del player: skippa e riprova
    player.on('error', async (error) => {
      console.error('Errore player:', error.message);
      await message.channel.send(`❌ Errore audio: ${error.message}`);
      queue.killCurrentProcesses();
      queue.songs.shift();
      queue.playing = false;
      playNext(guildId, message.channel);
    });

    // Gestione disconnessione dal canale vocale
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling,  5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        queue.killCurrentProcesses();
        connection.destroy();
        queues.delete(guildId);
      }
    });

    queue.songs.push(song);
    await searching.edit(`✅ Trovato su **${song.platform}**: **${song.title}**`);
    playNext(guildId, message.channel);
  } else {
    queue.songs.push(song);
    await searching.edit(
      `➕ Aggiunto alla coda (posizione ${queue.songs.length}): **${song.title}**`
    );
  }
}

// ── $skip ─────────────────────────────────────────────────────────────────────
function cmdSkip(message) {
  const queue = queues.get(message.guild.id);
  if (!queue || !queue.playing) return message.reply('❌ Nessuna canzone in riproduzione.');
  queue.killCurrentProcesses();
  queue.player.stop();
  message.reply('⏭️ Canzone saltata!');
}

// ── $pause ────────────────────────────────────────────────────────────────────
function cmdPause(message) {
  const queue = queues.get(message.guild.id);
  if (!queue || !queue.playing) return message.reply('❌ Nessuna canzone in riproduzione.');
  if (queue.paused) return message.reply('⏸️ La riproduzione è già in pausa.');
  queue.player.pause();
  queue.paused = true;
  message.reply('⏸️ Messa in pausa.');
}

// ── $resume ───────────────────────────────────────────────────────────────────
function cmdResume(message) {
  const queue = queues.get(message.guild.id);
  if (!queue || !queue.paused) return message.reply('❌ La musica non è in pausa.');
  queue.player.unpause();
  queue.paused = false;
  message.reply('▶️ Ripresa riproduzione.');
}

// ── $stop ─────────────────────────────────────────────────────────────────────
function cmdStop(message) {
  const queue = queues.get(message.guild.id);
  if (!queue) return message.reply('❌ Nessuna canzone in riproduzione.');
  queue.killCurrentProcesses();
  queue.songs = [];
  queue.player.stop();
  queue.connection.destroy();
  queues.delete(message.guild.id);
  message.reply('⏹️ Riproduzione fermata e coda svuotata.');
}

// ── $queue ────────────────────────────────────────────────────────────────────
function cmdQueue(message) {
  const queue = queues.get(message.guild.id);
  if (!queue || queue.songs.length === 0) return message.reply('📭 La coda è vuota.');

  const list = queue.songs
    .map((s, i) => `${i === 0 ? '▶️' : `${i}.`} **${s.title}** — richiesto da ${s.requestedBy}`)
    .join('\n');

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🎶 Coda musicale')
    .setDescription(list.length > 4000 ? list.substring(0, 4000) + '...' : list);

  message.reply({ embeds: [embed] });
}

// ── $help ─────────────────────────────────────────────────────────────────────
function cmdHelp(message) {
  message.reply([
    '🎵 **Comandi disponibili:**',
    '`$play [canzone o link]` — Riproduce o aggiunge alla coda',
    '`$skip`                 — Salta la canzone corrente',
    '`$pause`                — Mette in pausa',
    '`$resume`               — Riprende la riproduzione',
    '`$stop`                 — Ferma tutto e svuota la coda',
    '`$queue`                — Mostra la coda',
  ].join('\n'));
}

module.exports = { cmdPlay, cmdSkip, cmdPause, cmdResume, cmdStop, cmdQueue, cmdHelp };
