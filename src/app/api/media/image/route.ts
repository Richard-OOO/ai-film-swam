import { NextResponse } from "next/server";
import { generateImage } from "@/lib/tokenworld";

export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const { prompt } = (await request.json()) as { prompt?: string };
    if (!prompt?.trim()) return NextResponse.json({ error: "Image prompt is required." }, { status: 400 });
    return NextResponse.json(await generateImage(prompt.trim()));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Image generation failed." }, { status: 502 });
  }
}
