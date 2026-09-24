import { NextResponse } from "next/server";
import type { ImageJob, SwarmMessage } from "@/lib/domain";
import { connectRedis, imageJobKey, imageQueueKey, messageStreamKey } from "@/lib/redis";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      tasks?: Array<{ shotId?: string; frame?: "start" | "end"; prompt?: string }>;
    };
    const tasks = body.tasks || [];
    if (!tasks.length || tasks.length > 2 || tasks.some((task) => !task.shotId || !task.frame || !task.prompt?.trim())) {
      return NextResponse.json({ error: "One or two complete frame tasks are required." }, { status: 400 });
    }

    const client = await connectRedis();
    const batchId = crypto.randomUUID();
    const jobs: ImageJob[] = tasks.map((task) => ({
      id: crypto.randomUUID(),
      batchId,
      shotId: task.shotId!,
      frame: task.frame!,
      prompt: task.prompt!.trim(),
      status: "QUEUED",
      createdAt: new Date().toISOString(),
    }));

    const transaction = client.multi();
    for (const job of jobs) {
      transaction.set(imageJobKey(job.id), JSON.stringify(job), { EX: 86400 });
      transaction.sAdd(`film:batch:${job.batchId}:image-jobs`, job.id);
      transaction.expire(`film:batch:${job.batchId}:image-jobs`, 86400);
      transaction.lPush(imageQueueKey, job.id);
      transaction.xAdd(messageStreamKey, "*", {
        jobId: job.id,
        batchId: job.batchId,
        from: "Scheduler",
        to: "Frame Worker Pool",
        type: "TASK_OFFERED",
        shotId: job.shotId,
        content: `${job.frame} frame task ${job.id} entered the shared pool.`,
        createdAt: job.createdAt,
      });
    }
    await transaction.exec();
    return NextResponse.json({ jobs }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to enqueue frame tasks." }, { status: 503 });
  }
}

export async function GET(request: Request) {
  try {
    const ids = new URL(request.url).searchParams.get("ids")?.split(",").filter(Boolean) || [];
    if (!ids.length || ids.length > 2) return NextResponse.json({ error: "One or two job IDs are required." }, { status: 400 });
    const client = await connectRedis();
    const values = await client.mGet(ids.map(imageJobKey));
    const jobs = values.filter(Boolean).map((value) => JSON.parse(value!) as ImageJob);
    const entries = await client.xRevRange(messageStreamKey, "+", "-", { COUNT: 30 });
    const messages: SwarmMessage[] = entries.reverse().map((entry) => ({
      id: entry.id,
      jobId: entry.message.jobId,
      batchId: entry.message.batchId,
      from: entry.message.from,
      to: entry.message.to,
      type: entry.message.type as SwarmMessage["type"],
      shotId: entry.message.shotId,
      content: entry.message.content,
      createdAt: entry.message.createdAt,
    })).filter((message) => ids.includes(message.jobId));
    return NextResponse.json({ jobs, messages });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to read swarm jobs." }, { status: 503 });
  }
}
