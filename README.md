# 🎵 Music Bot Discord

Bot musicale per Discord che riproduce audio da YouTube, YouTube Music e Spotify
usando `yt-dlp` e `ffmpeg`.

## Funzionalità

- Ricerca per nome o link diretto (YouTube, YouTube Music, Spotify)
- Coda multi-traccia per server
- Streaming in formato OggOpus (bassa latenza, no gracchiamento)
- Cache delle ricerche per risposte più veloci
- Ottimizzato per hosting su dispositivi ARM a bassa RAM (es. Android + Termux)
- Comandi: `-play`, `-skip`, `-pause`, `-resume`, `-stop`, `-queue`, `-help`

## Prerequisiti

- **Node.js** 18+
- **ffmpeg** con supporto `libopus`
- **yt-dlp**

## Installazione

### Linux
```bash
sudo apt install ffmpeg
pip install yt-dlp
```

### Termux (Android)
```bash
pkg install nodejs ffmpeg python cronie
pip install yt-dlp
```

### Windows

Scarica `yt-dlp.exe` e `ffmpeg.exe` e mettili nella cartella radice del progetto
(accanto a `index.js`).

## Setup
```bash
# 1. Clona il repo
git clone https://github.com/dave2disco/discord-music-bot.git
cd discord-music-bot

# 2. Installa le dipendenze Node
npm install

# 3. Crea il file .env
cp .env.example .env
```

Modifica `.env` con i tuoi valori:
```
DISCORD_TOKEN=il_tuo_token_discord
```

Il token Discord si ottiene dal [Discord Developer Portal](https://discord.com/developers/applications).

## Avvio

### Sviluppo
```bash
npm start
```

### Produzione con pm2 (consigliato)
```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # facoltativo: avvio automatico al reboot
```

`ecosystem.config.js` configura pm2 per riavviare automaticamente il bot
se supera 220 MB di RAM, prevenendo crash da OOM killer su sistemi con
poca memoria disponibile.

## Hosting su Android (Termux)

Il bot è ottimizzato per girare stabilmente su Android tramite Termux con pm2.

### Comandi pm2 utili
```bash
pm2 logs bot          # log in tempo reale
pm2 logs bot --lines 100  # ultimi 100 log
pm2 status            # stato del processo
pm2 reload bot        # ricarica senza downtime
pm2 restart bot       # riavvio completo
```

## Struttura del progetto
```
index.js              # Entry point: client Discord e router dei comandi
ecosystem.config.js   # Configurazione pm2 (memory limit, restart policy)
src/
  config.js           # Percorsi binari e variabili d'ambiente
  queue.js            # Classe ServerQueue e Map delle code per server
  search.js           # Ricerca con yt-dlp, cache LRU, supporto Spotify
  spotify.js          # Integrazione Spotify Web API (metadati traccia)
  audio.js            # Pipeline di streaming yt-dlp → ffmpeg → OggOpus
  commands.js         # Implementazione dei comandi
```

## Comandi

| Comando | Descrizione |
|---|---|
| `-play [canzone o link]` | Riproduce o aggiunge alla coda. Accetta testo, link YouTube e link Spotify |
| `-skip` | Salta la traccia corrente |
| `-pause` | Mette in pausa |
| `-resume` | Riprende la riproduzione |
| `-stop` | Ferma tutto e svuota la coda |
| `-queue` | Mostra le tracce in coda |
| `-help` | Lista dei comandi |

## Note tecniche

### Pipeline audio
```
yt-dlp → pipe → ffmpeg → OggOpus → @discordjs/voice → Discord
```

### Supporto Spotify

Usa la Spotify Web API esclusivamente per leggere titolo e artista di una traccia.
L'audio viene sempre cercato su YouTube Music/YouTube tramite yt-dlp.
Non è richiesto Spotify Premium. Il token OAuth (flusso Client Credentials)
viene cachato e rinnovato automaticamente ogni 60 minuti.

### Cache ricerche

La cache LRU mantiene in memoria le ultime **50 ricerche** (in precedenza 200).
Tutte le chiamate a yt-dlp usano `--no-cache-dir` per evitare l'accumulo di
file temporanei su disco nel corso delle sessioni lunghe.