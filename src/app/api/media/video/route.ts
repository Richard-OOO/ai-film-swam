import { NextResponse } from "next/server";
import type { FrameStrategy } from "@/lib/domain";
import { createVideo } from "@/lib/tokenworld";

export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      shotId?: string;
      startFrameUrl?: string;
      endFrameUrl?: string;
      prompt?: string;
      duration?: number;
      frameStrategy?: FrameStrategy;
    };
    if (!body.shotId || !body.startFrameUrl || !body.prompt?.trim()) {
      return NextResponse.json({ error: "Shot, a reference frame, and a video prompt are required." }, { status: 400 });
    }
    if (body.frameStrategy === "CONTINUOUS_KEYFRAMES" && !body.endFrameUrl) {
      return NextResponse.json({ error: "Continuous shots require both keyframes before video generation." }, { status: 400 });
    }
    return NextResponse.json(await createVideo({
      prompt: body.prompt.trim(),
      imageUrl: body.startFrameUrl,
      duration: body.duration,
    }), { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Video task creation failed." }, { status: 502 });
  }
}
