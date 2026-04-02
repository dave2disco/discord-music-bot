const path = require('path');

const YTDLP_BIN = process.platform === 'win32'
  ? path.join(__dirname, '..', 'yt-dlp.exe')
  : 'yt-dlp';

const FFMPEG_BIN = process.platform === 'win32'
  ? path.join(__dirname, '..', 'ffmpeg.exe')
  : 'ffmpeg';

const PREFIX = process.env.BOT_PREFIX || '-';

module.exports = { YTDLP_BIN, FFMPEG_BIN, PREFIX };

