module.exports = {
  apps: [{
    name: 'bot',
    script: 'index.js',
    max_memory_restart: '220M',   // pm2 riavvia il bot prima che Android lo faccia
    restart_delay: 4000,
    exp_backoff_restart_delay: 100,
    env: {
      NODE_ENV: 'production'
    }
  }]
};