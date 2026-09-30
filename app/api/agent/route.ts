import { getUser } from "@/lib/session";
import { runAgent, type AgentEvent, type ChatTurn } from "@/lib/agent/loop";
import { isAdvisorModel, DEFAULT_ADVISOR_MODEL } from "@/lib/agent/advisor";

// Several tool round-trips plus adaptive thinking; leave headroom.
export const maxDuration = 120;

// POST { question, history?, model? } -> newline-delimited JSON stream of
// AgentEvents (tool calls as they happen, then the answer), so the UI can show
// the agent working instead of a spinner.
export async function POST(req: Request) {
  const user = await getUser();
  if (!user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "ANTHROPIC_API_KEY is not set — add it to .env." }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as { question?: string; history?: ChatTurn[]; model?: string };
  const question = body.question?.trim();
  if (!question) return Response.json({ error: "question required" }, { status: 400 });
  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.text === "string" && t.text)
    .slice(-10);
  const model = isAdvisorModel(body.model) ? body.model : DEFAULT_ADVISOR_MODEL;
  const userId = user.id;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: AgentEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        await runAgent(question, history, { userId }, send, model);
      } catch (e) {
        send({ type: "error", message: (e as Error).message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
