module.exports = {
  apps: [
    {
      name: 'control-center',
      script: 'server.js',
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '300M',
      restart_delay: 3000,
    },
  ],
};
