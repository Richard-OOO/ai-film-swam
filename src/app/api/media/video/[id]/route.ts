import { NextResponse } from "next/server";
import { getVideo } from "@/lib/tokenworld";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return NextResponse.json(await getVideo(id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Video status request failed." }, { status: 502 });
  }
}
