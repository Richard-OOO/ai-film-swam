import { createClient } from "redis";
import { generateImage } from "../src/lib/tokenworld";
import type { ImageJob, SwarmMessage } from "../src/lib/domain";

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const queueKey = "film:queue:image";
const streamKey = "film:stream:messages";
const batchJobsKey = (batchId: string) => `film:batch:${batchId}:image-jobs`;
const jobKey = (id: string) => `film:job:image:${id}`;

async function runWorker(workerId: string) {
  const client = createClient({ url: redisUrl });
  client.on("error", (error) => console.error(`[${workerId}] Redis:`, error.message));
  await client.connect();
  console.log(`[${workerId}] waiting on ${queueKey}`);
  const publish = (message: Omit<SwarmMessage, "id">) => client.xAdd(streamKey, "*", message);

  while (client.isOpen) {
    const item = await client.brPop(queueKey, 0);
    if (!item) continue;
    const value = await client.get(jobKey(item.element));
    if (!value) continue;
    const job = JSON.parse(value) as ImageJob;
    job.status = "RUNNING";
    job.workerId = workerId;
    job.startedAt = new Date().toISOString();
    await client.set(jobKey(job.id), JSON.stringify(job), { EX: 86400 });
    await publish({
      jobId: job.id,
      batchId: job.batchId,
      from: workerId,
      to: "Frame Worker Pool",
      type: "TASK_CLAIMED",
      shotId: job.shotId,
      content: `Claimed ${job.frame} frame; the paired task remains available to the other worker.`,
      createdAt: job.startedAt,
    });

    try {
      const result = await generateImage(job.prompt);
      job.status = "SUCCEEDED";
      job.imageUrl = result.imageUrl;
      job.requestId = result.requestId;
      job.finishedAt = new Date().toISOString();
      await client.set(jobKey(job.id), JSON.stringify(job), { EX: 86400 });
      const pairedIds = await client.sMembers(batchJobsKey(job.batchId));
      const pairedValues = pairedIds.length ? await client.mGet(pairedIds.map(jobKey)) : [];
      const pairedJobs = pairedValues.filter(Boolean).map((value) => JSON.parse(value!) as ImageJob);
      const hasPeer = pairedJobs.some((peer) => peer.id !== job.id);
      const pairReady = pairedJobs.some((peer) => peer.id !== job.id && peer.status === "SUCCEEDED");
      await publish({
        jobId: job.id,
        batchId: job.batchId,
        from: workerId,
        to: pairReady || !hasPeer ? "Video Agent" : "Frame Worker Pool",
        type: pairReady || !hasPeer ? "PAIR_READY" : "PEER_WAIT",
        shotId: job.shotId,
        content: !hasPeer
          ? `${job.frame} reference frame completed; the single-frame shot is ready for the Video Agent.`
          : pairReady
          ? `${job.frame} frame completed; both frames are ready for the Video Agent.`
          : `${job.frame} frame completed; waiting for the paired frame worker.`,
        createdAt: job.finishedAt,
      });
    } catch (error) {
      job.status = "FAILED";
      job.error = error instanceof Error ? error.message : "Image generation failed.";
      job.finishedAt = new Date().toISOString();
      await client.set(jobKey(job.id), JSON.stringify(job), { EX: 86400 });
      await publish({
        jobId: job.id,
        batchId: job.batchId,
        from: workerId,
        to: "Human Director",
        type: "TASK_FAILED",
        shotId: job.shotId,
        content: `${job.frame} frame failed and requires a human retry decision.`,
        createdAt: job.finishedAt,
      });
    }
  }
}

async function main() {
  await Promise.all([runWorker("Frame Worker A"), runWorker("Frame Worker B")]);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
