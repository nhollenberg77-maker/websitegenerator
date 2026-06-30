// DB-toegang voor de agent-team-laag. Zelfde patroon als lib/db.ts:
// better-sqlite3, open/close per operatie. WAL aan zodat de worker en het
// Next.js-dashboard tegelijk kunnen lezen/schrijven.
//
// Zie AGENT_TEAM.md §4 voor het schema.

import Database from "better-sqlite3";
import path from "path";
import type {
  AgentConfig,
  AgentMessage,
  AgentName,
  AgentRun,
  Feedback,
  FeedbackKind,
  Goal,
  GoalStatus,
  MessageKind,
  Task,
  TaskStatus,
  TaskType,
} from "./types";
import type { Lead } from "../types";

export type ApprovalStatus = "none" | "pending" | "approved" | "rejected" | "sent";

const DB_PATH = path.resolve(process.cwd(), process.env.DB_PATH || "../leads.db");

let migrated = false;

function now(): string {
  return new Date().toISOString();
}

export function ensureAgentTables(): void {
  if (migrated) return;
  const db = new Database(DB_PATH);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");

    db.exec(`
      CREATE TABLE IF NOT EXISTS goals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        description TEXT NOT NULL,
        metric TEXT,
        target_value INTEGER,
        current_value INTEGER DEFAULT 0,
        params TEXT,
        status TEXT DEFAULT 'active',
        created_by TEXT DEFAULT 'human',
        created_at TEXT,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        priority INTEGER DEFAULT 5,
        payload TEXT,
        lead_place_id TEXT,
        goal_id INTEGER,
        assigned_agent TEXT,
        attempts INTEGER DEFAULT 0,
        result TEXT,
        error TEXT,
        created_at TEXT,
        started_at TEXT,
        finished_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, priority);
      CREATE INDEX IF NOT EXISTS idx_tasks_lead ON tasks(lead_place_id);

      CREATE TABLE IF NOT EXISTS agent_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent TEXT NOT NULL,
        task_id INTEGER,
        status TEXT,
        summary TEXT,
        reasoning TEXT,
        model TEXT,
        tokens INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER,
        started_at TEXT,
        finished_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_runs_agent ON agent_runs(agent, id DESC);
      CREATE INDEX IF NOT EXISTS idx_runs_finished ON agent_runs(finished_at);

      CREATE TABLE IF NOT EXISTS agent_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_agent TEXT NOT NULL,
        to_agent TEXT,
        kind TEXT DEFAULT 'info',
        body TEXT NOT NULL,
        lead_place_id TEXT,
        task_id INTEGER,
        created_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_msg_id ON agent_messages(id DESC);

      CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        lead_place_id TEXT,
        metric TEXT,
        value TEXT,
        note TEXT,
        applied INTEGER DEFAULT 0,
        created_at TEXT
      );

      CREATE TABLE IF NOT EXISTS agent_config (
        agent TEXT PRIMARY KEY,
        mission TEXT,
        strategy TEXT,
        model TEXT,
        enabled INTEGER DEFAULT 1,
        updated_by TEXT,
        updated_at TEXT
      );
    `);

    // agent_runs kan al bestaan zonder de nieuwere kolommen → additief toevoegen
    const runCols = db.prepare("PRAGMA table_info(agent_runs)").all() as { name: string }[];
    for (const col of ["input_tokens", "output_tokens", "iterations", "tool_calls"]) {
      if (!runCols.some((c) => c.name === col)) {
        db.exec(`ALTER TABLE agent_runs ADD COLUMN ${col} INTEGER DEFAULT NULL`);
      }
    }

    // Nieuwe kolommen op leads (additief, idempotent)
    const cols = db.prepare("PRAGMA table_info(leads)").all() as { name: string }[];
    const addCol = (name: string, type: string) => {
      if (!cols.some((c) => c.name === name)) {
        db.exec(`ALTER TABLE leads ADD COLUMN ${name} ${type} DEFAULT NULL`);
      }
    };
    addCol("site_quality_score", "INTEGER");
    addCol("site_critique", "TEXT");
    addCol("email_quality_score", "INTEGER");
    addCol("email_subject", "TEXT");
    addCol("email_body_html", "TEXT");
    addCol("approval_status", "TEXT");
    addCol("approval_note", "TEXT");
    addCol("approved_at", "TEXT");
    addCol("site_content", "TEXT"); // agent-geschreven content-spec (JSON)
    addCol("dossier", "TEXT"); // agent-notities per lead
    addCol("replied_at", "TEXT"); // gevoed door lib/inbox.ts (ook in db.ts-migratie)
    addCol("bounced_at", "TEXT");

    migrated = true;
  } finally {
    db.close();
  }
}

function db(readonly = false): Database.Database {
  ensureAgentTables();
  const d = new Database(DB_PATH, { readonly });
  d.pragma("busy_timeout = 5000");
  return d;
}

// ─────────────────────────────────────────────────────────── TASKS ──

export function createTask(input: {
  type: TaskType;
  priority?: number;
  payload?: unknown;
  leadPlaceId?: string | null;
  goalId?: number | null;
  assignedAgent?: AgentName | null;
}): number {
  const d = db();
  try {
    const info = d
      .prepare(
        `INSERT INTO tasks (type, status, priority, payload, lead_place_id, goal_id, assigned_agent, attempts, created_at)
         VALUES (?, 'pending', ?, ?, ?, ?, ?, 0, ?)`
      )
      .run(
        input.type,
        input.priority ?? 5,
        input.payload != null ? JSON.stringify(input.payload) : null,
        input.leadPlaceId ?? null,
        input.goalId ?? null,
        input.assignedAgent ?? null,
        now()
      );
    return Number(info.lastInsertRowid);
  } finally {
    d.close();
  }
}

// Dedup-helper: bestaat er al een open (pending/running/done) taak van dit type
// voor deze lead? Voorkomt dubbele build_site/write_email taken.
export function hasTaskForLead(type: TaskType, leadPlaceId: string, includeDone = true): boolean {
  const d = db(true);
  try {
    const statuses = includeDone
      ? "('pending','running','done')"
      : "('pending','running')";
    const row = d
      .prepare(
        `SELECT 1 FROM tasks WHERE type = ? AND lead_place_id = ? AND status IN ${statuses} LIMIT 1`
      )
      .get(type, leadPlaceId);
    return !!row;
  } finally {
    d.close();
  }
}

// Claim de volgende N pending taken (zet ze op running) en geef ze terug.
// Atomair per taak via een UPDATE ... WHERE status='pending'.
export function claimNextTasks(limit: number, excludeTypes: TaskType[] = []): Task[] {
  const d = db();
  try {
    const exclude =
      excludeTypes.length > 0
        ? `AND type NOT IN (${excludeTypes.map(() => "?").join(",")})`
        : "";
    const candidates = d
      .prepare(
        `SELECT * FROM tasks WHERE status = 'pending' ${exclude}
         ORDER BY priority ASC, id ASC LIMIT ?`
      )
      .all(...excludeTypes, limit) as Task[];

    const claimStmt = d.prepare(
      `UPDATE tasks SET status='running', started_at=?, attempts=attempts+1
       WHERE id = ? AND status='pending'`
    );
    const claimed: Task[] = [];
    for (const t of candidates) {
      const info = claimStmt.run(now(), t.id);
      if (info.changes > 0) claimed.push({ ...t, status: "running", attempts: t.attempts + 1 });
    }
    return claimed;
  } finally {
    d.close();
  }
}

export function completeTask(id: number, result?: unknown): void {
  const d = db();
  try {
    d.prepare(
      `UPDATE tasks SET status='done', result=?, finished_at=? WHERE id = ?`
    ).run(result != null ? JSON.stringify(result) : null, now(), id);
  } finally {
    d.close();
  }
}

export function failTask(id: number, error: string, retry: boolean, maxAttempts = 3): void {
  const d = db();
  try {
    const t = d.prepare("SELECT attempts FROM tasks WHERE id = ?").get(id) as
      | { attempts: number }
      | undefined;
    const attempts = t?.attempts ?? maxAttempts;
    const status = retry && attempts < maxAttempts ? "pending" : "failed";
    d.prepare(
      `UPDATE tasks SET status=?, error=?, finished_at=? WHERE id = ?`
    ).run(status, error.slice(0, 1000), status === "failed" ? now() : null, id);
  } finally {
    d.close();
  }
}

export function getTask(id: number): Task | undefined {
  const d = db(true);
  try {
    return d.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task | undefined;
  } finally {
    d.close();
  }
}

export function listTasks(opts: { status?: TaskStatus; limit?: number } = {}): Task[] {
  const d = db(true);
  try {
    const where = opts.status ? "WHERE status = ?" : "";
    const params = opts.status ? [opts.status] : [];
    return d
      .prepare(`SELECT * FROM tasks ${where} ORDER BY id DESC LIMIT ?`)
      .all(...params, opts.limit ?? 100) as Task[];
  } finally {
    d.close();
  }
}

export function countTasksByStatus(): Record<string, number> {
  const d = db(true);
  try {
    const rows = d
      .prepare("SELECT status, COUNT(*) as n FROM tasks GROUP BY status")
      .all() as { status: string; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  } finally {
    d.close();
  }
}

// ──────────────────────────────────────────────────────────── RUNS ──

export function recordRun(input: {
  agent: AgentName;
  taskId?: number | null;
  status: "ok" | "error";
  summary?: string;
  reasoning?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  tokens?: number;
  iterations?: number;
  toolCalls?: number;
  startedAt: string;
}): void {
  const d = db();
  try {
    const total = input.tokens ?? (((input.inputTokens ?? 0) + (input.outputTokens ?? 0)) || null);
    d.prepare(
      `INSERT INTO agent_runs (agent, task_id, status, summary, reasoning, model, tokens, input_tokens, output_tokens, iterations, tool_calls, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.agent,
      input.taskId ?? null,
      input.status,
      input.summary ?? null,
      input.reasoning ?? null,
      input.model ?? null,
      total,
      input.inputTokens ?? null,
      input.outputTokens ?? null,
      input.iterations ?? null,
      input.toolCalls ?? null,
      input.startedAt,
      now()
    );
  } finally {
    d.close();
  }
}

// ─────────────────────────────────────────── METRICS / KOSTEN ──

// Tokenverbruik per model (voor kostenberekening in pricing.ts).
export function tokenUsageByModel(): { model: string; inputTokens: number; outputTokens: number; runs: number }[] {
  const d = db(true);
  try {
    return d
      .prepare(
        `SELECT COALESCE(model,'onbekend') as model,
                SUM(COALESCE(input_tokens,0)) as inputTokens,
                SUM(COALESCE(output_tokens,0)) as outputTokens,
                COUNT(*) as runs
         FROM agent_runs WHERE model IS NOT NULL GROUP BY model`
      )
      .all() as { model: string; inputTokens: number; outputTokens: number; runs: number }[];
  } finally {
    d.close();
  }
}

// Tokenverbruik per model sinds een tijdstip (voor kosten per periode).
export function tokenUsageSince(sinceIso: string): { model: string; inputTokens: number; outputTokens: number }[] {
  const d = db(true);
  try {
    return d.prepare(
      `SELECT COALESCE(model,'onbekend') as model,
              SUM(COALESCE(input_tokens,0)) as inputTokens,
              SUM(COALESCE(output_tokens,0)) as outputTokens
       FROM agent_runs WHERE model IS NOT NULL AND finished_at >= ? GROUP BY model`
    ).all(sinceIso) as { model: string; inputTokens: number; outputTokens: number }[];
  } finally {
    d.close();
  }
}

// Per-agent statistieken: voltooide taken, succesratio, tokens.
export function agentStats(): Record<string, { ok: number; error: number; inputTokens: number; outputTokens: number; model: string | null }> {
  const d = db(true);
  try {
    const rows = d
      .prepare(
        `SELECT agent,
                SUM(CASE WHEN status='ok' THEN 1 ELSE 0 END) as ok,
                SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) as error,
                SUM(COALESCE(input_tokens,0)) as inputTokens,
                SUM(COALESCE(output_tokens,0)) as outputTokens,
                MAX(model) as model
         FROM agent_runs GROUP BY agent`
      )
      .all() as { agent: string; ok: number; error: number; inputTokens: number; outputTokens: number; model: string | null }[];
    return Object.fromEntries(rows.map((r) => [r.agent, r]));
  } finally {
    d.close();
  }
}

// Tijdreeks van afgeronde runs per bucket (voor de swarm-activity grafiek).
// bucketHours bepaalt de breedte; count = aantal buckets terug vanaf nu.
export function activitySeries(bucketHours: number, count: number, nowMs: number): { t: number; runs: number; tokens: number }[] {
  const d = db(true);
  try {
    const rows = d
      .prepare(
        `SELECT finished_at, COALESCE(tokens,0) as tokens FROM agent_runs
         WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 5000`
      )
      .all() as { finished_at: string; tokens: number }[];
    const bucketMs = bucketHours * 3600_000;
    const buckets: { t: number; runs: number; tokens: number }[] = [];
    for (let i = count - 1; i >= 0; i--) {
      buckets.push({ t: nowMs - i * bucketMs, runs: 0, tokens: 0 });
    }
    const start = nowMs - count * bucketMs;
    for (const r of rows) {
      const ts = new Date(r.finished_at).getTime();
      if (ts < start) break;
      const idx = Math.min(count - 1, Math.floor((ts - start) / bucketMs));
      if (idx >= 0) {
        buckets[idx].runs++;
        buckets[idx].tokens += r.tokens;
      }
    }
    return buckets;
  } finally {
    d.close();
  }
}

export function listRecentRuns(limit = 50, agent?: AgentName): AgentRun[] {
  const d = db(true);
  try {
    const where = agent ? "WHERE agent = ?" : "";
    const params = agent ? [agent] : [];
    return d
      .prepare(`SELECT * FROM agent_runs ${where} ORDER BY id DESC LIMIT ?`)
      .all(...params, limit) as AgentRun[];
  } finally {
    d.close();
  }
}

export function getLastRunPerAgent(): Record<string, AgentRun> {
  const d = db(true);
  try {
    const rows = d
      .prepare(
        `SELECT r.* FROM agent_runs r
         JOIN (SELECT agent, MAX(id) as mid FROM agent_runs GROUP BY agent) m
           ON r.id = m.mid`
      )
      .all() as AgentRun[];
    return Object.fromEntries(rows.map((r) => [r.agent, r]));
  } finally {
    d.close();
  }
}

// ──────────────────────────────────────────────────────── MESSAGES ──

export function postMessage(input: {
  from: string;
  to?: string | null;
  kind?: MessageKind;
  body: string;
  leadPlaceId?: string | null;
  taskId?: number | null;
}): void {
  const d = db();
  try {
    d.prepare(
      `INSERT INTO agent_messages (from_agent, to_agent, kind, body, lead_place_id, task_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.from,
      input.to ?? null,
      input.kind ?? "info",
      input.body,
      input.leadPlaceId ?? null,
      input.taskId ?? null,
      now()
    );
  } finally {
    d.close();
  }
}

export function listMessages(opts: { limit?: number; sinceId?: number } = {}): AgentMessage[] {
  const d = db(true);
  try {
    const where = opts.sinceId ? "WHERE id > ?" : "";
    const params = opts.sinceId ? [opts.sinceId] : [];
    return d
      .prepare(`SELECT * FROM agent_messages ${where} ORDER BY id DESC LIMIT ?`)
      .all(...params, opts.limit ?? 100) as AgentMessage[];
  } finally {
    d.close();
  }
}

// ──────────────────────────────────────────────────────── FEEDBACK ──

export function addFeedback(input: {
  kind: FeedbackKind;
  leadPlaceId?: string | null;
  metric?: string;
  value?: unknown;
  note?: string;
}): void {
  const d = db();
  try {
    d.prepare(
      `INSERT INTO feedback (kind, lead_place_id, metric, value, note, applied, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`
    ).run(
      input.kind,
      input.leadPlaceId ?? null,
      input.metric ?? null,
      input.value != null ? JSON.stringify(input.value) : null,
      input.note ?? null,
      now()
    );
  } finally {
    d.close();
  }
}

export function listFeedback(opts: { kind?: FeedbackKind; limit?: number; onlyUnapplied?: boolean } = {}): Feedback[] {
  const d = db(true);
  try {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (opts.kind) { conds.push("kind = ?"); params.push(opts.kind); }
    if (opts.onlyUnapplied) conds.push("applied = 0");
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    return d
      .prepare(`SELECT * FROM feedback ${where} ORDER BY id DESC LIMIT ?`)
      .all(...params, opts.limit ?? 100) as Feedback[];
  } finally {
    d.close();
  }
}

export function markFeedbackApplied(ids: number[]): void {
  if (ids.length === 0) return;
  const d = db();
  try {
    d.prepare(`UPDATE feedback SET applied=1 WHERE id IN (${ids.map(() => "?").join(",")})`).run(...ids);
  } finally {
    d.close();
  }
}

// ─────────────────────────────────────────────────────────── GOALS ──

export function createGoal(input: {
  description: string;
  metric?: string;
  targetValue?: number;
  params?: unknown;
  createdBy?: string;
}): number {
  const d = db();
  try {
    const info = d
      .prepare(
        `INSERT INTO goals (description, metric, target_value, current_value, params, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, 'active', ?, ?, ?)`
      )
      .run(
        input.description,
        input.metric ?? null,
        input.targetValue ?? null,
        input.params != null ? JSON.stringify(input.params) : null,
        input.createdBy ?? "human",
        now(),
        now()
      );
    return Number(info.lastInsertRowid);
  } finally {
    d.close();
  }
}

export function getActiveGoals(): Goal[] {
  const d = db(true);
  try {
    return d.prepare("SELECT * FROM goals WHERE status='active' ORDER BY id DESC").all() as Goal[];
  } finally {
    d.close();
  }
}

export function listGoals(): Goal[] {
  const d = db(true);
  try {
    return d.prepare("SELECT * FROM goals ORDER BY id DESC").all() as Goal[];
  } finally {
    d.close();
  }
}

export function updateGoalProgress(id: number, currentValue: number): void {
  const d = db();
  try {
    d.prepare("UPDATE goals SET current_value=?, updated_at=? WHERE id=?").run(currentValue, now(), id);
  } finally {
    d.close();
  }
}

export function setGoalStatus(id: number, status: GoalStatus): void {
  const d = db();
  try {
    d.prepare("UPDATE goals SET status=?, updated_at=? WHERE id=?").run(status, now(), id);
  } finally {
    d.close();
  }
}

// ────────────────────────────────────────────────────────── CONFIG ──

export function getAgentConfig(agent: AgentName): AgentConfig | undefined {
  const d = db(true);
  try {
    return d.prepare("SELECT * FROM agent_config WHERE agent = ?").get(agent) as AgentConfig | undefined;
  } finally {
    d.close();
  }
}

export function getAllConfigs(): AgentConfig[] {
  const d = db(true);
  try {
    return d.prepare("SELECT * FROM agent_config ORDER BY agent").all() as AgentConfig[];
  } finally {
    d.close();
  }
}

export function upsertAgentConfig(input: {
  agent: AgentName;
  mission?: string;
  strategy?: string;
  model?: string;
  enabled?: boolean;
  updatedBy?: string;
}): void {
  const d = db();
  try {
    const existing = d.prepare("SELECT agent FROM agent_config WHERE agent = ?").get(input.agent);
    if (existing) {
      const sets: string[] = [];
      const params: unknown[] = [];
      if (input.mission !== undefined) { sets.push("mission=?"); params.push(input.mission); }
      if (input.strategy !== undefined) { sets.push("strategy=?"); params.push(input.strategy); }
      if (input.model !== undefined) { sets.push("model=?"); params.push(input.model); }
      if (input.enabled !== undefined) { sets.push("enabled=?"); params.push(input.enabled ? 1 : 0); }
      sets.push("updated_by=?", "updated_at=?");
      params.push(input.updatedBy ?? "manager", now(), input.agent);
      d.prepare(`UPDATE agent_config SET ${sets.join(", ")} WHERE agent = ?`).run(...params);
    } else {
      d.prepare(
        `INSERT INTO agent_config (agent, mission, strategy, model, enabled, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        input.agent,
        input.mission ?? null,
        input.strategy ?? null,
        input.model ?? null,
        input.enabled === false ? 0 : 1,
        input.updatedBy ?? "human",
        now()
      );
    }
  } finally {
    d.close();
  }
}

// ──────────────────────────────────── LEAD-LEVEL AGENT VELDEN ──

export function setSiteQuality(placeId: string, score: number, critique: unknown): void {
  const d = db();
  try {
    d.prepare("UPDATE leads SET site_quality_score=?, site_critique=? WHERE place_id=?").run(
      score,
      critique != null ? JSON.stringify(critique) : null,
      placeId
    );
  } finally {
    d.close();
  }
}

export function setEmailDraft(input: {
  placeId: string;
  subject: string;
  html: string;
  score: number;
  approvalStatus: ApprovalStatus;
}): void {
  const d = db();
  try {
    d.prepare(
      `UPDATE leads SET email_subject=?, email_body_html=?, email_quality_score=?, approval_status=? WHERE place_id=?`
    ).run(input.subject, input.html, input.score, input.approvalStatus, input.placeId);
  } finally {
    d.close();
  }
}

export function listPendingApprovals(): Lead[] {
  const d = db(true);
  try {
    return d
      .prepare(
        `SELECT * FROM leads WHERE approval_status='pending' AND unsubscribed_at IS NULL
         ORDER BY email_quality_score DESC NULLS LAST, qualified_at DESC`
      )
      .all() as Lead[];
  } finally {
    d.close();
  }
}

export function setApproval(placeId: string, status: "approved" | "rejected", note?: string): boolean {
  const d = db();
  try {
    const info = d
      .prepare("UPDATE leads SET approval_status=?, approval_note=?, approved_at=? WHERE place_id=? AND approval_status='pending'")
      .run(status, note ?? null, status === "approved" ? now() : null, placeId);
    return info.changes > 0;
  } finally {
    d.close();
  }
}

// Goedgekeurde, nog niet verstuurde mails — input voor de mail-sender.
export function getApprovedUnsent(): Lead[] {
  const d = db(true);
  try {
    return d
      .prepare(
        `SELECT * FROM leads
         WHERE approval_status='approved' AND emailed_at IS NULL AND unsubscribed_at IS NULL
         ORDER BY approved_at ASC`
      )
      .all() as Lead[];
  } finally {
    d.close();
  }
}

export function markApprovedSent(placeId: string): void {
  const d = db();
  try {
    d.prepare("UPDATE leads SET approval_status='sent' WHERE place_id=?").run(placeId);
  } finally {
    d.close();
  }
}

// ── Lead-mutaties die de agent-tools aanroepen (vervangt discovery/qualify/enrich.py) ──

export interface DiscoveredLead {
  place_id: string;
  name: string;
  address?: string | null;
  website?: string | null;
  phone_national?: string | null;
  phone_intl?: string | null;
  rating?: number | null;
  rating_count?: number | null;
  primary_type?: string | null;
  types?: string[];
  business_status?: string | null;
  photo_count?: number;
  photo_refs?: string[];
  latitude?: number | null;
  longitude?: number | null;
  city_query?: string | null;
  voivodeship?: string | null;
  category_query?: string | null;
}

// Bestaat de lead al, of staat hij op de afgewezen-lijst? (dedup voor de Scout)
export function leadKnownState(placeId: string): "new" | "exists" | "rejected" {
  const d = db(true);
  try {
    if (d.prepare("SELECT 1 FROM rejected_leads WHERE place_id=?").get(placeId)) return "rejected";
    if (d.prepare("SELECT 1 FROM leads WHERE place_id=?").get(placeId)) return "exists";
    return "new";
  } finally {
    d.close();
  }
}

export function upsertLead(l: DiscoveredLead): void {
  const d = db();
  try {
    d.prepare(
      `INSERT INTO leads (place_id, name, address, website, phone_national, phone_intl,
        rating, rating_count, primary_type, types, business_status, photo_count, photo_refs,
        latitude, longitude, city_query, voivodeship, category_query, discovered_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(place_id) DO UPDATE SET
         rating=excluded.rating, rating_count=excluded.rating_count,
         photo_count=excluded.photo_count, photo_refs=excluded.photo_refs,
         business_status=excluded.business_status,
         website=COALESCE(excluded.website, website),
         phone_national=COALESCE(excluded.phone_national, phone_national)`
    ).run(
      l.place_id, l.name, l.address ?? null, l.website ?? null, l.phone_national ?? null, l.phone_intl ?? null,
      l.rating ?? null, l.rating_count ?? 0, l.primary_type ?? null, JSON.stringify(l.types ?? []),
      l.business_status ?? null, l.photo_count ?? 0, l.photo_refs ? JSON.stringify(l.photo_refs) : null,
      l.latitude ?? null, l.longitude ?? null, l.city_query ?? null, l.voivodeship ?? null,
      l.category_query ?? null, now()
    );
  } finally {
    d.close();
  }
}

export function markLeadQualified(placeId: string, gbpScore?: number, siteScore?: number): void {
  const d = db();
  try {
    d.prepare("UPDATE leads SET qualified=1, qualified_at=?, good_gbp_score=?, bad_site_score=? WHERE place_id=?")
      .run(now(), gbpScore ?? null, siteScore ?? null, placeId);
  } finally {
    d.close();
  }
}

// Afwijzen: verplaats naar rejected_leads + verwijder uit leads (zoals qualify.py).
export function rejectLead(placeId: string, reason: string): void {
  const d = db();
  try {
    const lead = d.prepare("SELECT name, city_query, category_query FROM leads WHERE place_id=?").get(placeId) as
      | { name: string; city_query: string; category_query: string } | undefined;
    d.prepare(
      `INSERT OR REPLACE INTO rejected_leads (place_id, rejected_at, reason, name, city_query, category_query)
       VALUES (?,?,?,?,?,?)`
    ).run(placeId, now(), reason.slice(0, 300), lead?.name ?? null, lead?.city_query ?? null, lead?.category_query ?? null);
    d.prepare("DELETE FROM leads WHERE place_id=?").run(placeId);
  } finally {
    d.close();
  }
}

export function setLeadEnrichment(placeId: string, data: { reviewsJson?: string | null; description?: string | null; photoUrls?: string | null }): void {
  const d = db();
  try {
    d.prepare("UPDATE leads SET reviews_json=?, description=?, photo_urls=?, enriched_at=? WHERE place_id=?")
      .run(data.reviewsJson ?? null, data.description ?? null, data.photoUrls ?? null, now(), placeId);
  } finally {
    d.close();
  }
}

export function setSiteContent(placeId: string, json: string): void {
  const d = db();
  try { d.prepare("UPDATE leads SET site_content=? WHERE place_id=?").run(json, placeId); }
  finally { d.close(); }
}

export function setDossier(placeId: string, text: string): void {
  const d = db();
  try { d.prepare("UPDATE leads SET dossier=? WHERE place_id=?").run(text, placeId); }
  finally { d.close(); }
}

// Prestaties per kolom (category_query / city_query) — voor de leerlus van de Manager.
export function leadStatsBy(column: "category_query" | "city_query"): { key: string; total: number; qualified: number; emailed: number; replied: number; bounced: number }[] {
  const d = db(true);
  try {
    return d.prepare(
      `SELECT COALESCE(${column},'?') as key,
              COUNT(*) as total,
              SUM(CASE WHEN qualified=1 THEN 1 ELSE 0 END) as qualified,
              SUM(CASE WHEN emailed_at IS NOT NULL THEN 1 ELSE 0 END) as emailed,
              SUM(CASE WHEN replied_at IS NOT NULL THEN 1 ELSE 0 END) as replied,
              SUM(CASE WHEN bounced_at IS NOT NULL THEN 1 ELSE 0 END) as bounced
       FROM leads GROUP BY ${column} ORDER BY replied DESC, qualified DESC, total DESC LIMIT 30`
    ).all() as { key: string; total: number; qualified: number; emailed: number; replied: number; bounced: number }[];
  } finally {
    d.close();
  }
}

// Tel-helpers voor goal-voortgang en dashboard-stats.
export function countLeads(where: string, params: unknown[] = []): number {
  const d = db(true);
  try {
    const row = d.prepare(`SELECT COUNT(*) as n FROM leads ${where}`).get(...params) as { n: number };
    return row.n;
  } finally {
    d.close();
  }
}
