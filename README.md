# 🎵 Music Bot Discord

Bot musicale per Discord che riproduce audio da YouTube e YouTube Music usando `yt-dlp` e `ffmpeg`.

## Funzionalità

- Ricerca per nome o link diretto
- Coda multi-traccia per server
- Streaming in formato OggOpus (bassa latenza, no gracchiamento)
- Cache delle ricerche per risposte più veloci
- Comandi: `-play`, `-skip`, `-pause`, `-resume`, `-stop`, `-queue`

## Prerequisiti

- **Node.js** 18+
- **ffmpeg** con supporto `libopus`
- **yt-dlp**

### Installazione su Linux / Termux (Android)

```bash
# Linux
sudo apt install ffmpeg
pip install yt-dlp

# Termux (Android)
pkg install nodejs ffmpeg python
pip install yt-dlp
```

### Installazione su Windows

Scarica `yt-dlp.exe` e `ffmpeg.exe` e mettili nella cartella radice del progetto (accanto a `index.js`).

## Setup

```bash
# 1. Clona il repo
git clone https://github.com/tuoutente/music-bot.git
cd music-bot

# 2. Installa le dipendenze Node
npm install

# 3. Crea il file .env con il tuo token
cp .env.example .env
# Modifica .env e inserisci DISCORD_TOKEN=...

# 4. Avvia il bot
npm start
```

Il token del bot si ottiene dal [Discord Developer Portal](https://discord.com/developers/applications).

## Struttura del progetto

```
index.js          # Entry point: client Discord e router dei comandi
src/
  config.js       # Percorsi binari e variabili d'ambiente
  queue.js        # Classe ServerQueue e Map delle code per server
  search.js       # Ricerca con yt-dlp e cache LRU
  audio.js        # Pipeline di streaming yt-dlp → ffmpeg → OggOpus
  commands.js     # Implementazione dei comandi ($play, $skip, ecc.)
```

## Comandi

| Comando | Descrizione |
|---|---|
| `-play [canzone o link]` | Riproduce o aggiunge alla coda |
| `-skip` | Salta la traccia corrente |
| `-pause` | Mette in pausa |
| `-resume` | Riprende la riproduzione |
| `-stop` | Ferma tutto e svuota la coda |
| `-queue` | Mostra le tracce in coda |
| `-help` | Lista dei comandi |

## Hosting su Android (Termux)

```bash
pkg install tmux
tmux new -s bot
npm start
# CTRL+B poi D per staccarti senza fermare il processo
```

Disabilita l'ottimizzazione batteria per Termux nelle impostazioni Android per evitare che il processo venga terminato quando lo schermo si spegne.
