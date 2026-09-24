import type { VideoGenerationResponse } from "@/lib/domain";

const DEFAULT_API_ROOT = "https://uu1068026-7902a211c79e.weste.seetacloud.com:8443";
const DEFAULT_WORKFLOW_ID = "API-U01-minimax_h3_基础版API";

function apiRoot() {
  return (process.env.SEETACLOUD_API_ROOT || DEFAULT_API_ROOT).replace(/\/$/, "");
}

async function readJson(response: Response) {
  const text = await response.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = { message: text || response.statusText };
  }
  if (!response.ok) {
    const detail = data as { error?: string; message?: string };
    throw new Error(detail.error || detail.message || `SeetaCloud request failed (${response.status}).`);
  }
  return data;
}

export async function createSeetaVideo(input: {
  prompt: string;
  startFrameUrl: string;
  endFrameUrl?: string;
  duration?: number;
}): Promise<VideoGenerationResponse> {
  const endFrame = input.endFrameUrl || input.startFrameUrl;
  const response = await fetch(`${apiRoot()}/api/workflow/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workflow_id: process.env.SEETACLOUD_VIDEO_WORKFLOW_ID || DEFAULT_WORKFLOW_ID,
      input_values: {
        "137:image": input.startFrameUrl,
        "139:image": endFrame,
        "141:image": endFrame,
        "145:自定义宽": 512,
        "145:自定义高": 288,
        "146:prompt": input.prompt,
        "147:value": Math.min(5, Math.max(1, input.duration || 5)),
      },
    }),
    cache: "no-store",
  });
  const data = (await readJson(response)) as { success?: boolean; prompt_id?: string; error?: string; message?: string };
  if (!data.success || !data.prompt_id) {
    throw new Error(data.error || data.message || "SeetaCloud returned no video task ID.");
  }
  return { id: data.prompt_id, status: "QUEUED", provider: "seetacloud" };
}

export async function getSeetaVideo(id: string): Promise<VideoGenerationResponse> {
  const response = await fetch(`${apiRoot()}/api/workflow/result?prompt_id=${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  const data = (await readJson(response)) as {
    success?: boolean;
    pending?: boolean;
    error?: string;
    message?: string;
    results?: Array<{ type?: string; url?: string }>;
  };
  if (!data.success) {
    return { id, status: "FAILED", error: data.error || data.message || "SeetaCloud video task failed.", provider: "seetacloud" };
  }
  if (data.pending) return { id, status: "RUNNING", provider: "seetacloud" };
  const output = data.results?.find((result) => result.type === "video" && result.url);
  if (!output?.url) {
    return { id, status: "FAILED", error: data.error || data.message || "SeetaCloud completed without a video output.", provider: "seetacloud" };
  }
  return {
    id,
    status: "SUCCEEDED",
    videoUrl: `/api/media/video/${encodeURIComponent(id)}/content`,
    provider: "seetacloud",
  };
}

export async function getSeetaVideoContent(id: string) {
  const response = await fetch(`${apiRoot()}/api/workflow/result?prompt_id=${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  const data = (await readJson(response)) as {
    success?: boolean;
    pending?: boolean;
    results?: Array<{ type?: string; url?: string }>;
  };
  const output = data.results?.find((result) => result.type === "video" && result.url);
  if (!data.success || data.pending || !output?.url) throw new Error("SeetaCloud video is not ready.");
  const outputUrl = new URL(output.url, `${apiRoot()}/`);
  const video = await fetch(outputUrl, { cache: "no-store" });
  if (!video.ok) throw new Error(`SeetaCloud video download failed (${video.status}).`);
  return video;
}
