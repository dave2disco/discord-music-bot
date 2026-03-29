// ─── Struttura coda ──────────────────────────────────────────────────────────
// Ogni server Discord ha la propria ServerQueue isolata.
// La Map `queues` è condivisa tra tutti i moduli tramite questo file.

const queues = new Map();

class ServerQueue {
  constructor() {
    this.songs = [];
    this.connection = null;
    this.player = null;
    this.playing = false;
    this.paused = false;
    this.currentProcesses = [];
  }

  killCurrentProcesses() {
    for (const proc of this.currentProcesses) {
      try { proc.kill('SIGKILL'); } catch (_) {}
    }
    this.currentProcesses = [];
  }
}

module.exports = { queues, ServerQueue };
