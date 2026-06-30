// Live dry-run van de Scout-agent-loop (1 stad, 1 categorie) — bewijst de
// agent-native flow: Places API + Haiku-redenering + oordeel-kwalificatie.
import { ensureAgentTables, createTask, getTask, countLeads, listRecentRuns, listMessages } from "../lib/agents/store.ts";
import { seedAgentConfigs } from "../lib/agents/seed.ts";
import { runScout } from "../lib/agents/scout.ts";

ensureAgentTables();
seedAgentConfigs();

const before = countLeads("WHERE qualified=1");
const id = createTask({ type: "discover", assignedAgent: "scout", payload: { cities: ["krakow"], categories: ["plumber"] } });
const task = getTask(id);
console.log("Scout start — discover-taak", id);
await runScout(task);

const after = countLeads("WHERE qualified=1");
const run = listRecentRuns(1, "scout")[0];
console.log("\n=== RESULTAAT ===");
console.log("qualified leads:", before, "→", after);
console.log("scout-run:", { status: run?.status, iterations: run?.iterations, tool_calls: run?.tool_calls, tokens: run?.tokens, summary: run?.summary });
console.log("laatste berichten:");
for (const m of listMessages({ limit: 3 })) console.log("  ·", m.from_agent, "→", m.to_agent ?? "team", ":", m.body?.slice(0, 120));
process.exit(0);
