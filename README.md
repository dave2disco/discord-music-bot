# 🎵 Discord Music Bot

Bot musicale per Discord che riproduce audio da YouTube, YouTube Music e Spotify usando `yt-dlp` e `ffmpeg`. Ottimizzato per girare 24/7 su Android (Termux) su dispositivi ARM a bassa RAM.

## Funzionalità

- Ricerca per testo o link diretto (YouTube, YouTube Music, Spotify)
- Playlist YouTube e Spotify (caricamento in background)
- Coda multi-traccia per server con shuffle, remove, nowplaying
- Streaming OggOpus a 96kbps (bassa latenza, nessun gracchiamento)
- Prefetch della canzone successiva durante il silence buffer (cambio brano più rapido)
- Cache delle ricerche (50 slot, eviction FIFO)
- Auto-disconnessione dopo 5 minuti di inattività
- Rilevamento OOM killer e recovery automatico
- Avvio automatico al riavvio del dispositivo via Termux:Boot

## Requisiti

- Node.js 18+
- ffmpeg con supporto `libopus`
- yt-dlp
- pm2 (`npm install -g pm2`)
- bgutil-ytdlp-pot-provider (server anti-bot YouTube)

## Installazione su Termux

```bash
pkg install nodejs ffmpeg python
pip install yt-dlp bgutil-ytdlp-pot-provider

git clone https://github.com/dave2disco/discord-music-bot.git
cd discord-music-bot
npm install

cp .env.example .env
nano .env   # inserisci DISCORD_TOKEN
```

### bgutil (anti-bot YouTube)

```bash
cd ~
git clone https://github.com/nicksturm/bgutil-ytdlp-pot-provider.git
cd bgutil-ytdlp-pot-provider/server
npm ci --ignore-scripts
npx tsc
```

## Avvio

```bash
pm2 start ecosystem.config.js
pm2 save
```

## Comandi

| Comando | Descrizione |
|---|---|
| `-play <testo\|link>` / `-p` | Riproduce o aggiunge alla coda |
| `-skip` | Salta la canzone corrente |
| `-pause` / `-resume` | Mette in pausa / riprende |
| `-stop` | Ferma tutto e svuota la coda |
| `-queue` | Mostra la coda con durate |
| `-nowplaying` | Canzone corrente con barra di avanzamento |
| `-shuffle` | Mescola le canzoni in coda |
| `-remove <n>` | Rimuove la canzone numero N dalla coda |
| `-help` | Lista comandi |

Accetta link YouTube, YouTube Music, Spotify (singola traccia e playlist).

## Struttura

```
index.js                  # entry point, routing comandi
src/
  config.js               # percorsi binari, prefix
  queue.js                # ServerQueue (stato per guild)
  search.js               # ricerca yt-dlp, cache, normalizzazione URL
  audio.js                # stream yt-dlp→ffmpeg, silence buffer, prefetch
  commands.js             # logica di tutti i comandi
  spotify.js              # parsing oEmbed e playlist Spotify
ecosystem.config.js       # configurazione pm2 (bot + bgutil)
```

## Variabili d'ambiente

```
DISCORD_TOKEN=    # token dal Discord Developer Portal (obbligatorio)
BOT_PREFIX=       # prefisso comandi, default: -
```
