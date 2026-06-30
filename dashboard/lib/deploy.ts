// Git-push van gegenereerde sites + Vercel-domain-sync. Losgetrokken uit het
// oude lib/agent.ts (dat verwijderd is) — dit is het enige stuk dat het nieuwe
// agent-team nog nodig heeft.

import { spawn } from "child_process";
import path from "path";
import { syncVercelDomains } from "./vercel-domains";

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[deploy ${new Date().toISOString()}] ${msg}`);
}

function runCmd(cmd: string, args: string[], cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd: cwd || process.cwd(), env: { ...process.env } });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    proc.on("error", (err) => resolve({ code: 1, stdout, stderr: err.message }));
  });
}

// Best-effort: commit + push gegenereerde sites en sync Vercel-subdomeinen.
export async function autoDeploy(): Promise<void> {
  const projectRoot = path.resolve(process.cwd(), "..");
  const paths = ["dashboard/public/sites", "dashboard/public/sub", "dashboard/public/preview", "leads.db"];

  const status = await runCmd("git", ["status", "--porcelain", ...paths], projectRoot);
  if (status.code !== 0) {
    log(`git status faalde: ${status.stderr.slice(0, 120)}`);
    return;
  }

  if (status.stdout.trim()) {
    log("git commit + push");
    await runCmd("git", ["add", ...paths], projectRoot);
    const stamp = new Date().toISOString().slice(0, 19).replace("T", " ");
    const commit = await runCmd("git", ["commit", "-m", `auto: pipeline ${stamp}`], projectRoot);
    if (commit.code !== 0 && !commit.stdout.includes("nothing to commit")) {
      log(`git commit faalde: ${(commit.stderr || commit.stdout).slice(0, 120)}`);
      return;
    }
    const fetch = await runCmd("git", ["fetch", "origin", "main"], projectRoot);
    if (fetch.code !== 0) { log(`git fetch faalde: ${fetch.stderr.slice(0, 200)}`); return; }
    const rebase = await runCmd("git", ["rebase", "origin/main"], projectRoot);
    if (rebase.code !== 0) {
      await runCmd("git", ["rebase", "--abort"], projectRoot);
      log(`git rebase faalde: ${(rebase.stderr || rebase.stdout).slice(0, 200)}`);
      return;
    }
    const push = await runCmd("git", ["push", "origin", "HEAD:main"], projectRoot);
    if (push.code !== 0) { log(`git push faalde: ${push.stderr.slice(0, 200)}`); return; }
    log("git push ✓ — Vercel build draait");
  } else {
    log("geen wijzigingen om te pushen");
  }

  try {
    const result = await syncVercelDomains();
    if (result.skipped) { log(`Vercel sync overgeslagen: ${result.skipReason}`); return; }
    log(`Vercel domains: ${result.added.length} nieuw, ${result.existed.length} bestonden, ${result.failed.length} mislukt`);
  } catch (err) {
    log(`Vercel sync faalde: ${err instanceof Error ? err.message : "onbekend"}`);
  }
}
