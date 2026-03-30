const queues = new Map();

const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;

class ServerQueue {
  constructor() {
    this.songs = [];
    this.connection = null;
    this.player = null;
    this.playing = false;
    this.paused = false;
    this.skipping = false;

    this.oomKilled = false;

    this.startedAt = null;

    this.inactivityTimer = null;

    this.currentProcesses = [];
    this.consecutiveFailures = 0;

    // FIX BUG 1: mancava questa proprietà → playlistLoaderId++ dava NaN e il
    // controllo di cancellamento del loader Spotify falliva sempre.
    this.playlistLoaderId = 0;

    // Riferimento al canale testo: usato dall'handler AudioPlayerStatus.Playing
    // in commands.js per inviare l'embed "In riproduzione" solo quando l'audio
    // è davvero partito.
    this.textChannel = null;
  }

  killCurrentProcesses() {
    for (const proc of this.currentProcesses) {
      // FIX BUG ISSUE-2: distruggi prima i stream, poi invia SIGTERM.
      // Senza questa distruzione, ffmpeg può flushare il suo buffer interno
      // nei ~ms di vita residua dopo SIGTERM, lasciando dati "stantii" nel
      // buffer Node.js del suo stdout. Distruggendo il stream prima, quei
      // dati vengono scartati invece di essere letti dal prossimo AudioResource.
      try { proc.stdout?.destroy(); } catch (_) {}
      try { proc.stdin?.destroy(); } catch (_) {}
      try { proc.kill('SIGTERM'); } catch (_) {}
    }
    this.currentProcesses = [];
  }

  startInactivityTimer(callback) {
    this.cancelInactivityTimer();
    this.inactivityTimer = setTimeout(callback, INACTIVITY_TIMEOUT_MS);
  }

  cancelInactivityTimer() {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
  }
}

module.exports = { queues, ServerQueue };
