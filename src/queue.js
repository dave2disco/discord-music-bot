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

    this.playlistLoaderId = 0;

    this.textChannel = null;

    // true mentre il bot riproduce il silence buffer tra una canzone e l'altra.
    // Usato dall'handler Idle in commands.js per distinguere la fine del
    // silence buffer dalla fine di una vera canzone.
    this.silencing = false;
  }

  killCurrentProcesses() {
    for (const proc of this.currentProcesses) {
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
