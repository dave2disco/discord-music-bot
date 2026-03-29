require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');
const { PREFIX } = require('./src/config');
const {
  cmdPlay, cmdSkip, cmdPause, cmdResume,
  cmdStop, cmdQueue, cmdHelp,
} = require('./src/commands');

// ─── Client Discord ───────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// ─── Gestione messaggi ────────────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args    = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  switch (command) {
    case 'play':   await cmdPlay(message, args); break;
    case 'skip':        cmdSkip(message);        break;
    case 'pause':       cmdPause(message);       break;
    case 'resume':      cmdResume(message);      break;
    case 'stop':        cmdStop(message);        break;
    case 'queue':       cmdQueue(message);       break;
    case 'help':        cmdHelp(message);        break;
    default:
      message.reply('❌ Comando non riconosciuto. Usa `$help` per la lista comandi.');
  }
});

// ─── Avvio ────────────────────────────────────────────────────────────────────
client.once('clientReady', () => {
  console.log(`✅ Bot online come ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
