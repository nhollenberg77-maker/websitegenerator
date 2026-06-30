// Langlopende agent-worker. Draait de orchestrator-tick in een lus.
// Start lokaal met:  npm run worker
// In de cloud: draai dit als apart, altijd-aan proces naast `npm run start`.
//
// Resolutie van DB_PATH/scripts gaat relatief t.o.v. de dashboard-map, dus
// start dit vanuit dashboard/ (cwd).

// Laad .env zelf zodat de worker werkt ongeacht de launcher (pm2, systemd, …).
// (npm run worker geeft ook --env-file mee; dubbel laden is onschadelijk.)
try {
  (process as NodeJS.Process & { loadEnvFile?: (p?: string) => void }).loadEnvFile?.(".env");
} catch {
  // geen .env aanwezig — env komt dan van de omgeving zelf
}

import { tick } from "./lib/agents/orchestrator";

const POLL_MS = Number(process.env.WORKER_POLL_MS || 6000);
let running = true;

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[worker ${new Date().toISOString()}] ${msg}`);
}

async function loop(): Promise<void> {
  log(`gestart — poll elke ${POLL_MS}ms`);
  while (running) {
    try {
      const { ran, summary } = await tick();
      if (ran > 0) log(summary);
    } catch (err) {
      log(`tick-fout: ${err instanceof Error ? err.stack || err.message : String(err)}`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  log("gestopt");
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    log(`${sig} ontvangen — afronden…`);
    running = false;
    setTimeout(() => process.exit(0), 1500);
  });
}

loop().catch((err) => {
  log(`fatale fout: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
