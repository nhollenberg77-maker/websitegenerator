"use client";

import { useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

interface LogLine {
  text: string;
  type: "stdout" | "stderr" | "info";
}

interface LiveConsoleProps {
  lines: LogLine[];
  running: boolean;
}

export function LiveConsole({ lines, running }: LiveConsoleProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines.length]);

  return (
    <div className="bg-[#1a1a1a] rounded-lg border border-line overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10">
        <div className={cn(
          "h-2 w-2 rounded-full",
          running ? "bg-green-400 animate-pulse" : "bg-white/20"
        )} />
        <span className="text-xs text-white/50 font-mono">
          {running ? "Running…" : lines.length > 0 ? "Completed" : "Idle"}
        </span>
      </div>
      <div className="p-4 h-80 overflow-y-auto font-mono text-xs leading-relaxed">
        {lines.length === 0 && (
          <p className="text-white/30">Output verschijnt hier zodra het script draait…</p>
        )}
        {lines.map((line, i) => (
          <div
            key={i}
            className={cn(
              "whitespace-pre-wrap break-all",
              line.type === "stderr" ? "text-orange-400" : "text-white/80"
            )}
          >
            {line.text}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
