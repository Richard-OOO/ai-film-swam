import type { MediaPreproductionEvent, MediaSwarmExchange, ShotProposal } from "@/lib/domain";
import { prepareCharacterDesigns, prepareSceneDesigns } from "@/lib/dashscope";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: Request) {
  const body = (await request.json()) as {
    characters?: Array<{ name: string; role: string; evidence: string }>;
    shots?: ShotProposal[];
  };
  if (!body.characters?.length || !body.shots?.length) {
    return Response.json({ error: "Characters and shots are required." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: MediaPreproductionEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      const message = (exchange: MediaSwarmExchange) => send({ type: "MESSAGE", exchange });
      const runCharacterBranch = async () => {
        send({ type: "BRANCH_STARTED", branch: "character" });
        try {
          const designs = await prepareCharacterDesigns(body.characters!, message);
          send({ type: "CHARACTERS_READY", designs });
        } catch (error) {
          send({ type: "BRANCH_FAILED", branch: "character", error: error instanceof Error ? error.message : "Character swarm failed." });
        }
      };
      const runSceneBranch = async () => {
        send({ type: "BRANCH_STARTED", branch: "scene" });
        try {
          const designs = await prepareSceneDesigns(body.shots!, message);
          send({ type: "SCENES_READY", designs });
        } catch (error) {
          send({ type: "BRANCH_FAILED", branch: "scene", error: error instanceof Error ? error.message : "Scene swarm failed." });
        }
      };
      void Promise.all([runCharacterBranch(), runSceneBranch()]).finally(() => {
        send({ type: "COMPLETE" });
        controller.close();
      });
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
