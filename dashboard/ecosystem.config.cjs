// pm2-config voor de cloud-box (Railway/Fly/VPS). Draait het dashboard én de
// agent-worker als twee altijd-aan processen.
//
//   npm ci && npm run build
//   npx pm2 start ecosystem.config.cjs
//   npx pm2 logs            # live logs
//   npx pm2 save            # herstart na reboot
//
// Vereist op de box: node, python3 (+ discovery/qualify/enrich deps),
// en een .env met ANTHROPIC_API_KEY, GOOGLE_MAPS_API_KEY, DB_PATH, VERCEL_TOKEN.

module.exports = {
  apps: [
    {
      name: "dashboard",
      script: "node_modules/next/dist/bin/next",
      args: "start",
      cwd: __dirname,
      env: { NODE_ENV: "production", PORT: "3000" },
      autorestart: true,
      max_restarts: 10,
    },
    {
      name: "agent-worker",
      script: "worker.ts",
      interpreter: "node_modules/.bin/tsx",
      cwd: __dirname,
      autorestart: true,
      max_restarts: 20,
      // De worker leest .env zelf niet bij dit pad-start; geef env mee:
      env: {
        NODE_ENV: "production",
        WORKER_POLL_MS: "6000",
      },
    },
  ],
};
