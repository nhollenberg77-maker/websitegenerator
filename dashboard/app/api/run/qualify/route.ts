import { NextRequest } from "next/server";
import { spawn } from "child_process";
import path from "path";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { limit, reset } = body as { limit?: number; reset?: boolean };

  const pythonBin = process.env.PYTHON_BIN || "python3";
  const scriptPath = path.resolve(process.cwd(), process.env.QUALIFY_SCRIPT || "../qualify.py");
  const dbPath = path.resolve(process.cwd(), process.env.DB_PATH || "../leads.db");

  const args = [scriptPath, "--db", dbPath];
  if (reset) args.push("--reset");
  if (limit && !reset) args.push("--limit", String(limit));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const proc = spawn(pythonBin, args, {
        cwd: path.dirname(scriptPath),
        env: { ...process.env },
      });

      proc.stdout.on("data", (data: Buffer) => {
        const lines = data.toString().split("\n");
        for (const line of lines) {
          if (line.trim()) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "stdout", text: line })}\n\n`));
          }
        }
      });

      proc.stderr.on("data", (data: Buffer) => {
        const lines = data.toString().split("\n");
        for (const line of lines) {
          if (line.trim()) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "stderr", text: line })}\n\n`));
          }
        }
      });

      proc.on("close", (code) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "info", text: `Process exited with code ${code}` })}\n\n`)
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      });

      proc.on("error", (err) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "stderr", text: `Error: ${err.message}` })}\n\n`)
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
