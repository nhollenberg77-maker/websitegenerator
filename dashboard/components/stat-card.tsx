import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: number;
  icon: LucideIcon;
  variant?: "default" | "success" | "warning" | "muted";
}

const variantClasses = {
  default: "text-navy",
  success: "text-success",
  warning: "text-warning",
  muted: "text-ink-soft",
};

export function StatCard({ title, value, icon: Icon, variant = "default" }: StatCardProps) {
  return (
    <Card className="border-line bg-card">
      <CardContent className="pt-5 pb-4 px-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-ink-soft">{title}</p>
            <p className={cn("text-3xl font-display font-semibold mt-1", variantClasses[variant])}>
              {value}
            </p>
          </div>
          <div className={cn("p-2 rounded-md bg-background-alt", variantClasses[variant])}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
