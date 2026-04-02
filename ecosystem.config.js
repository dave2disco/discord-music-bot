module.exports = {
  apps: [
    {
      name: 'bot',
      script: 'index.js',
      max_memory_restart: '220M',
      restart_delay: 4000,
      exp_backoff_restart_delay: 100,
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'bgutil',
      script: '/data/data/com.termux/files/home/bgutil-ytdlp-pot-provider/server/build/main.js',
      interpreter: 'node',
      autorestart: true,
      restart_delay: 3000,
      max_memory_restart: '300M',
    }
  ]
};
