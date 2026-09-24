import { NextResponse } from "next/server";
import { getSeetaVideoContent } from "@/lib/seetacloud";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const upstream = await getSeetaVideoContent(id);
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") || "video/mp4",
        ...(upstream.headers.get("Content-Length") ? { "Content-Length": upstream.headers.get("Content-Length")! } : {}),
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Video content request failed." }, { status: 502 });
  }
}
