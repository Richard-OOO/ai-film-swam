import { NextResponse } from "next/server";
import { getSeetaVideo } from "@/lib/seetacloud";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return NextResponse.json(await getSeetaVideo(id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Video status request failed." }, { status: 502 });
  }
}
