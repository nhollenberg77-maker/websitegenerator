import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ScoreBadgeProps {
  score: number | null;
  max?: number;
  type: "gbp" | "site" | "status";
  label?: string;
}

export function ScoreBadge({ score, max, type, label }: ScoreBadgeProps) {
  if (type === "status") {
    if (score === 1)
      return <Badge className="bg-success/10 text-success border-success/20 hover:bg-success/10">Qualified</Badge>;
    if (score === 0)
      return <Badge className="bg-warning/10 text-warning border-warning/20 hover:bg-warning/10">Rejected</Badge>;
    return <Badge variant="secondary" className="text-ink-soft">Pending</Badge>;
  }

  if (score === null || score === undefined) {
    return <span className="text-ink-soft text-xs">—</span>;
  }

  const displayLabel = label ?? `${score}${max ? `/${max}` : ""}`;

  if (type === "gbp") {
    const color = score >= 5 ? "bg-success/10 text-success border-success/20" :
                  score >= 3 ? "bg-amber-50 text-amber-700 border-amber-200" :
                  "bg-warning/10 text-warning border-warning/20";
    return <Badge className={cn(color, "hover:bg-transparent")}>{displayLabel}</Badge>;
  }

  const color = score >= 3 ? "bg-success/10 text-success border-success/20" :
                score >= 1 ? "bg-amber-50 text-amber-700 border-amber-200" :
                "bg-warning/10 text-warning border-warning/20";
  return <Badge className={cn(color, "hover:bg-transparent")}>{displayLabel}</Badge>;
}
