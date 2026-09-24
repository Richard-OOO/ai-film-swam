import type { ImageGenerationResponse, VideoGenerationResponse } from "@/lib/domain";

const API_ROOT = "https://tokenworldai.com/v1";

function apiKey() {
  const key = process.env.TOKENWORLD_API_KEY;
  if (!key) throw new Error("TOKENWORLD_API_KEY is not configured on the server.");
  return key;
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
    const detail = data as { error?: { message?: string }; message?: string };
    throw new Error(detail.error?.message || detail.message || `TokenWorld request failed (${response.status}).`);
  }
  return data;
}

export async function generateImage(prompt: string): Promise<ImageGenerationResponse> {
  const response = await fetch(`${API_ROOT}/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.TOKENWORLD_IMAGE_MODEL || "gpt-image-2",
      prompt,
      size: "1K",
      n: 1,
      response_format: "url",
    }),
    cache: "no-store",
  });
  const data = (await readJson(response)) as {
    created?: number;
    data?: Array<{ url?: string; b64_json?: string }>;
  };
  const item = data.data?.[0];
  const imageUrl = item?.url || (item?.b64_json ? `data:image/png;base64,${item.b64_json}` : undefined);
  if (!imageUrl) throw new Error("TokenWorld returned no image URL.");
  return { imageUrl, requestId: data.created ? String(data.created) : undefined };
}

export async function createVideo(input: {
  prompt: string;
  imageUrl: string;
  duration?: number;
}): Promise<VideoGenerationResponse> {
  const response = await fetch(`${API_ROOT}/videos`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.TOKENWORLD_VIDEO_MODEL || "happyhorse-1.1-i2v",
      prompt: input.prompt,
      image: input.imageUrl,
      duration: input.duration || 5,
      resolution: "720P",
    }),
    cache: "no-store",
  });
  const data = (await readJson(response)) as Record<string, unknown>;
  return normalizeVideo(data);
}

export async function getVideo(id: string): Promise<VideoGenerationResponse> {
  const response = await fetch(`${API_ROOT}/videos/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
    cache: "no-store",
  });
  return normalizeVideo((await readJson(response)) as Record<string, unknown>, id);
}

function normalizeVideo(data: Record<string, unknown>, fallbackId?: string): VideoGenerationResponse {
  const nested = typeof data.data === "object" && data.data ? data.data as Record<string, unknown> : {};
  const id = stringValue(data.id, data.task_id, nested.id, nested.task_id, fallbackId);
  if (!id) throw new Error("TokenWorld returned no video task ID.");
  const rawStatus = stringValue(data.status, nested.status)?.toUpperCase() || "QUEUED";
  const status = rawStatus === "SUCCEEDED" || rawStatus === "COMPLETED" || rawStatus === "SUCCESS"
    ? "SUCCEEDED"
    : rawStatus === "FAILED" || rawStatus === "ERROR" || rawStatus === "CANCELLED"
      ? "FAILED"
      : rawStatus === "RUNNING" || rawStatus === "PROCESSING" || rawStatus === "IN_PROGRESS"
        ? "RUNNING"
        : "QUEUED";
  const output = typeof data.output === "object" && data.output ? data.output as Record<string, unknown> : {};
  const videoUrl = stringValue(data.url, data.video_url, nested.url, nested.video_url, output.url, output.video_url)
    || (status === "SUCCEEDED" ? `/api/media/video/${encodeURIComponent(id)}/content` : undefined);
  const error = stringValue(data.error, data.message, nested.error, nested.message);
  return { id, status, videoUrl, error, provider: "tokenworld" };
}

function stringValue(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

export async function getVideoContent(id: string) {
  const response = await fetch(`${API_ROOT}/videos/${encodeURIComponent(id)}/content`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
    cache: "no-store",
  });
  if (!response.ok) await readJson(response);
  return response;
}
