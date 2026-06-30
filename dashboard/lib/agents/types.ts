// Types voor de agent-team-laag. Zie AGENT_TEAM.md voor het ontwerp.

export type AgentName = "manager" | "scout" | "builder" | "writer";

export type TaskType =
  | "discover"
  | "qualify"
  | "enrich"
  | "build_site"
  | "write_email"
  | "manage";

export type TaskStatus = "pending" | "running" | "done" | "failed" | "blocked";

export interface Task {
  id: number;
  type: TaskType;
  status: TaskStatus;
  priority: number;
  payload: string | null; // JSON
  lead_place_id: string | null;
  goal_id: number | null;
  assigned_agent: AgentName | null;
  attempts: number;
  result: string | null; // JSON
  error: string | null;
  created_at: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface AgentRun {
  id: number;
  agent: AgentName;
  task_id: number | null;
  status: "ok" | "error";
  summary: string | null;
  reasoning: string | null;
  model: string | null;
  tokens: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  iterations: number | null;
  tool_calls: number | null;
  started_at: string | null;
  finished_at: string | null;
}

export type MessageKind = "info" | "handoff" | "feedback" | "request" | "alert";

export interface AgentMessage {
  id: number;
  from_agent: string;
  to_agent: string | null;
  kind: MessageKind;
  body: string;
  lead_place_id: string | null;
  task_id: number | null;
  created_at: string | null;
}

export type FeedbackKind = "email_outcome" | "quality_review" | "manager_insight";

export interface Feedback {
  id: number;
  kind: FeedbackKind;
  lead_place_id: string | null;
  metric: string | null;
  value: string | null; // JSON
  note: string | null;
  applied: number;
  created_at: string | null;
}

export type GoalStatus = "active" | "done" | "paused";

export interface Goal {
  id: number;
  description: string;
  metric: string | null;
  target_value: number | null;
  current_value: number;
  params: string | null; // JSON: { cities, categories, ... }
  status: GoalStatus;
  created_by: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface GoalParams {
  cities?: string[];
  categories?: string[];
  radius?: number;
  limitPerCategory?: number;
  minGbpScore?: number;
}

export interface AgentConfig {
  agent: AgentName;
  mission: string | null;
  strategy: string | null;
  model: string | null;
  enabled: number;
  updated_by: string | null;
  updated_at: string | null;
}

// Vorm van de Builder-vision-kritiek opgeslagen in leads.site_critique
export interface SiteCritique {
  score: number; // 0-10
  strengths: string[];
  issues: { area: string; severity: "low" | "medium" | "high"; fix: string }[];
  verdict: "ship" | "revise";
}
