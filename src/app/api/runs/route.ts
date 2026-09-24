import { NextResponse } from "next/server";
import type { PlanningProgress, PlanningStage, StartRunResponse, TraceEvent } from "@/lib/domain";
import { planShots } from "@/lib/dashscope";

export const maxDuration = 300;

const stageAgent: Record<PlanningStage, string> = {
  story: "story_agent",
  visual_beats: "visual_beat_agent",
  cinematography: "cinematography_agent",
  shot_draft: "shot_integrator",
  continuity: "continuity_agent",
  shot_revision: "shot_agent",
};

function createRun(title: string, now: Date): StartRunResponse {
  return {
    projectId: `film_${now.getTime()}`,
    title: title || "Untitled film",
    agents: [
      { id: "story_agent", name: "Story Agent", capability: "story understanding", status: "working", taskId: "task_plan" },
      { id: "visual_beat_agent", name: "Visual Beat Agent", capability: "visual beat mapping", status: "waiting", taskId: "task_plan" },
      { id: "cinematography_agent", name: "Cinematography Agent", capability: "camera language", status: "waiting", taskId: "task_plan" },
      { id: "shot_integrator", name: "Shot Integrator", capability: "shot plan integration", status: "waiting", taskId: "task_plan" },
      { id: "shot_agent", name: "Shot Agent", capability: "shot revision", status: "waiting", taskId: "task_plan" },
      { id: "continuity_agent", name: "Continuity Agent", capability: "cross-shot continuity", status: "waiting", taskId: "task_plan" },
      { id: "frame_agent", name: "Frame Agent", capability: "start/end frame generation", status: "waiting" },
      { id: "video_agent", name: "Video Agent", capability: "mock video rendering", status: "waiting" },
    ],
    tasks: [{ id: "task_plan", type: "EXTRACT_CHUNK", title: "Understand story and propose an adaptive shot plan", capability: "story+shot", status: "RUNNING", agentId: "story_agent" }],
    trace: [{ id: "trace_1", type: "TASK_CREATED", actor: "Scheduler", message: "已创建故事到镜头的蜂群规划任务。", timestamp: now.toISOString() }],
    proposal: { logline: "", characters: [], shots: [], needsReview: true },
  };
}

function progressEvent(progress: PlanningProgress, index: number): TraceEvent {
  return {
    id: `trace_${index}`,
    type: progress.status === "STARTED" ? "TASK_STARTED" : "TASK_COMPLETED",
    actor: progress.actor,
    message: progress.message,
    timestamp: new Date().toISOString(),
    stage: progress.stage,
    durationMs: progress.durationMs,
    artifact: progress.artifact,
  };
}

function finishRun(run: StartRunResponse, plan: Awaited<ReturnType<typeof planShots>>, trace: TraceEvent[]) {
  const { discussion: _discussion, ...proposal } = plan;
  return {
    ...run,
    agents: run.agents.map((agent) => ({ ...agent, status: "idle" as const })),
    tasks: run.tasks.map((task) => ({ ...task, status: "SUCCEEDED" as const, agentId: "shot_agent" })),
    trace: [...trace, { id: `trace_${trace.length + 1}`, type: "STATE_PROPOSED" as const, actor: "Shot Agent -> Human Director", message: `${plan.shots.length} 个修订后镜头已提交，等待人工审查和编辑。`, timestamp: new Date().toISOString() }],
    proposal: { ...proposal, needsReview: true },
  };
}

export async function POST(request: Request) {
  let body: { title?: string; story?: string };
  try {
    body = (await request.json()) as { title?: string; story?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body.story?.trim()) return NextResponse.json({ error: "Story text is required." }, { status: 400 });

  const initialRun = createRun(body.title?.trim() || "", new Date());
  if (new URL(request.url).searchParams.get("stream") !== "1") {
    try {
      const trace = [...initialRun.trace];
      const plan = await planShots(body.story.trim(), (progress) => trace.push(progressEvent(progress, trace.length + 1)));
      return NextResponse.json(finishRun(initialRun, plan, trace));
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Planning failed." }, { status: 502 });
    }
  }

  const encoder = new TextEncoder();
  const planningAbort = new AbortController();
  let streamClosed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stopHeartbeat = () => {
    if (heartbeat !== undefined) clearInterval(heartbeat);
    heartbeat = undefined;
  };

  const cancelPlanning = () => {
    if (streamClosed) return;
    streamClosed = true;
    stopHeartbeat();
    planningAbort.abort();
  };

  const stream = new ReadableStream({
    start(controller) {
      let traceIndex = initialRun.trace.length;
      let activeStage: PlanningStage | undefined;
      let stageStartedAt = Date.now();
      const timings: Partial<Record<PlanningStage, number>> = {};
      const send = (event: unknown) => {
        if (streamClosed) return false;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          return true;
        } catch (error) {
          if (error instanceof TypeError && /Invalid state|Controller is already closed/i.test(error.message)) {
            cancelPlanning();
            return false;
          }
          throw error;
        }
      };

      const finish = (event: unknown) => {
        if (streamClosed || !send(event)) return;
        streamClosed = true;
        stopHeartbeat();
        try {
          controller.close();
        } catch (error) {
          if (!(error instanceof TypeError && /Invalid state|Controller is already closed/i.test(error.message))) throw error;
        }
      };

      send({ type: "INIT", run: initialRun });
      heartbeat = setInterval(() => send({ type: "HEARTBEAT", stage: activeStage, elapsedMs: Date.now() - stageStartedAt }), 5000);

      void planShots(body.story!.trim(), (progress) => {
        activeStage = progress.stage;
        if (progress.status === "STARTED") stageStartedAt = Date.now();
        if (progress.durationMs !== undefined) timings[progress.stage] = progress.durationMs;
        traceIndex += 1;
        const event = progressEvent(progress, traceIndex);
        initialRun.trace.push(event);
        send({ type: "TRACE", event, activeAgentId: progress.status === "STARTED" ? stageAgent[progress.stage] : undefined });
      }, planningAbort.signal).then((plan) => {
        finish({ type: "COMPLETE", run: finishRun(initialRun, plan, initialRun.trace), timings });
      }).catch((error) => {
        if (streamClosed || planningAbort.signal.aborted) return;
        finish({ type: "ERROR", error: error instanceof Error ? error.message : "Planning failed." });
      });
    },
    cancel() {
      cancelPlanning();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
