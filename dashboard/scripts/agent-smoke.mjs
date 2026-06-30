// Veilige smoke-test: migratie + seed + readback. Triggert GEEN discovery/LLM.
import { ensureAgentTables, getAllConfigs, getActiveGoals, countTasksByStatus, createTask, listTasks } from "../lib/agents/store.ts";
import { seedAgentConfigs, seedInitialGoal } from "../lib/agents/seed.ts";

ensureAgentTables();
seedAgentConfigs();
seedInitialGoal();

console.log("configs:", getAllConfigs().map((c) => `${c.agent}(${c.enabled ? "on" : "off"})`).join(", "));
console.log("active goals:", getActiveGoals().map((g) => `#${g.id} ${g.description} [${g.current_value}/${g.target_value}]`).join(" | "));

const id = createTask({ type: "discover", assignedAgent: "scout", payload: { cities: ["krakow"], categories: ["plumber"] } });
console.log("created task #" + id);
console.log("queue:", JSON.stringify(countTasksByStatus()));
console.log("tasks:", listTasks({ limit: 3 }).map((t) => `#${t.id} ${t.type}/${t.status}`).join(", "));

// Bevestig dat de orchestrator-module laadt zonder te draaien (worker.ts NIET
// importeren — die start meteen de lus).
await import("../lib/agents/orchestrator.ts");
console.log("orchestrator-module laadt OK");
console.log("SMOKE OK");
