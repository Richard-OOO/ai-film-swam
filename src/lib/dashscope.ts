import type { CharacterDesign, ContinuityIssue, CreativeExchange, ImageGenerationResponse, MediaSwarmExchange, PlanningProgress, SceneDesign, ShotProposal } from "@/lib/domain";

const API_ROOT = "https://maas.qianwenaiapi.com/api/v1";
const CHAT_API_ROOT = "https://api.evomap.ai/v1";
const CHAT_MODEL = "evomap-deepseek-v4-flash";

function dashScopeApiKey() {
  const key = process.env.DASHSCOPE_API_KEY;
  if (!key) throw new Error("DASHSCOPE_API_KEY is not configured on the server.");
  return key;
}

function evoMapApiKey() {
  const key = process.env.EVOMAP_API_KEY;
  if (!key) throw new Error("EVOMAP_API_KEY is not configured on the server.");
  return key;
}

async function readResponse(response: Response, provider: "DashScope" | "EvoMap") {
  const text = await response.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = { message: text || response.statusText }; }
  if (!response.ok) {
    const detail = data as { message?: string; code?: string };
    throw new Error(detail.message || detail.code || `${provider} request failed (${response.status}).`);
  }
  return data;
}

function stripJsonFence(value: string) {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function parseJsonOutput<T>(value: string): T {
  const content = stripJsonFence(value);
  try {
    return JSON.parse(content) as T;
  } catch (originalError) {
    for (let start = 0; start < content.length; start += 1) {
      if (content[start] !== "{" && content[start] !== "[") continue;
      const stack: string[] = [];
      let inString = false;
      let escaped = false;
      for (let end = start; end < content.length; end += 1) {
        const character = content[end];
        if (inString) {
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === '"') inString = false;
          continue;
        }
        if (character === '"') { inString = true; continue; }
        if (character === "{" || character === "[") stack.push(character);
        else if (character === "}" || character === "]") {
          const opening = stack.pop();
          if ((character === "}" && opening !== "{") || (character === "]" && opening !== "[")) break;
          if (stack.length === 0) {
            try {
              return JSON.parse(content.slice(start, end + 1)) as T;
            } catch {
              break;
            }
          }
        }
      }
    }
    throw originalError;
  }
}

async function chatJson<T>(system: string, user: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${CHAT_API_ROOT}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${evoMapApiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
    cache: "no-store",
    signal,
  });
  const data = (await readResponse(response, "EvoMap")) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("The language model returned no structured output.");
  return parseJsonOutput<T>(content);
}

export async function planShots(
  story: string,
  onProgress?: (progress: PlanningProgress) => void,
  signal?: AbortSignal,
): Promise<{
  logline: string;
  characters: Array<{ name: string; role: string; evidence: string }>;
  shots: ShotProposal[];
  discussion: CreativeExchange[];
}> {
  let startedAt = Date.now();
  onProgress?.({ stage: "story", status: "STARTED", actor: "Story Agent", message: "正在理解故事、提取人物与核心视觉时刻。" });
  const understanding = await chatJson<{
    logline: string;
    characters: Array<{ name: string; role: string; evidence: string }>;
    visualMoment: string;
  }>(
    "你是 Story Agent。只输出合法 JSON，不要 Markdown。忠于原文，提取一句故事主线、主要人物和最适合视觉化的瞬间。",
    `原文：\n${story}\n\n输出：{"logline":"","characters":[{"name":"","role":"","evidence":"原文证据"}],"visualMoment":""}`,
    signal,
  );
  if (!understanding.logline || !understanding.visualMoment) throw new Error("Story Agent returned an incomplete interpretation.");
  onProgress?.({
    stage: "story",
    status: "COMPLETED",
    actor: "Story Agent -> Shot Agent",
    message: `故事理解完成：${understanding.logline}`,
    durationMs: Date.now() - startedAt,
    artifact: { kind: "story", ...understanding },
  });

  startedAt = Date.now();
  onProgress?.({ stage: "visual_beats", status: "STARTED", actor: "Visual Beat Agent", message: "已领取共享任务：按原文证据拆分视觉节拍并建议镜头数量。" });
  const rawBeatPlan = await chatJson<{
    recommendedShotCount: number;
    rationale: string;
    beats: Array<{ id: string; source: { paragraph: number; quote: string }; action: string; visualGoal: string }>;
  }>(
    "你是 Visual Beat Agent。只输出合法 JSON，不要 Markdown。根据原文划分有拍摄价值的视觉节拍，通常 2-8 个，复杂故事最多 12 个，不固定为 3 个。每个节拍必须引用原文逐字存在的短句，不增加情节，只说明动作和视觉目标。",
    `原文：\n${story}\n\n故事事实：${JSON.stringify(understanding)}\n\n输出：{"recommendedShotCount":3,"rationale":"为什么需要这些节拍","beats":[{"id":"beat_1","source":{"paragraph":1,"quote":"原文逐字引句"},"action":"可拍摄动作","visualGoal":"视觉叙事目标"}]}`,
    signal,
  );
  const beatPlan = normalizeBeatPlan(rawBeatPlan, story);
  onProgress?.({ stage: "visual_beats", status: "COMPLETED", actor: "Visual Beat Agent -> Cinematography Agent", message: `已提交 ${beatPlan.beats.length} 个视觉节拍，摄影 Agent 开始读取提案。`, durationMs: Date.now() - startedAt, artifact: { kind: "visual_beats", ...beatPlan } });

  startedAt = Date.now();
  onProgress?.({ stage: "cinematography", status: "STARTED", actor: "Cinematography Agent", message: "已领取节拍提案：为每个节拍设计镜头类型、时长、运镜与参考帧策略。" });
  const rawCameraPlan = await chatJson<{
    summary: string;
    proposals: Array<{ beatId: string; shotType: "LONG_TAKE" | "SHORT_SHOT" | "JUMP_CUT"; durationSeconds: number; camera: string; frameStrategy: "CONTINUOUS_KEYFRAMES" | "SINGLE_FRAME" | "INTENTIONAL_CUT"; reason: string }>;
  }>(
    "你是 Cinematography Agent。只输出合法 JSON，不要 Markdown。读取全部视觉节拍并逐一提出摄影方案。LONG_TAKE 必须使用 CONTINUOUS_KEYFRAMES；SHORT_SHOT 必须使用 SINGLE_FRAME；JUMP_CUT 必须使用 INTENTIONAL_CUT。不要修改故事事实，也不要增删节拍。",
    `故事事实：${JSON.stringify(understanding)}\n视觉节拍：${JSON.stringify(beatPlan)}\n\n输出：{"summary":"整体摄影语言","proposals":[{"beatId":"beat_1","shotType":"LONG_TAKE|SHORT_SHOT|JUMP_CUT","durationSeconds":5,"camera":"景别、机位和运动","frameStrategy":"CONTINUOUS_KEYFRAMES|SINGLE_FRAME|INTENTIONAL_CUT","reason":"选择理由"}]}`,
    signal,
  );
  const cameraPlan = normalizeCameraPlan(rawCameraPlan, beatPlan.beats.map((beat) => beat.id));
  validateCameraPlan(cameraPlan, beatPlan.beats.map((beat) => beat.id));
  onProgress?.({ stage: "cinematography", status: "COMPLETED", actor: "Cinematography Agent -> Shot Integrator", message: `摄影方案已覆盖全部 ${cameraPlan.proposals.length} 个节拍，移交汇总。`, durationMs: Date.now() - startedAt, artifact: { kind: "cinematography", ...cameraPlan } });

  startedAt = Date.now();
  onProgress?.({ stage: "shot_draft", status: "STARTED", actor: "Shot Integrator", message: "正在合并故事事实、视觉节拍与摄影提案，生成共享镜头方案。" });
  const draftShots = await integrateShotDrafts(story, understanding, beatPlan, cameraPlan, signal, (reason) => {
    onProgress?.({ stage: "shot_draft", status: "STARTED", actor: "Shot Integrator · 自动修复", message: `首次输出未通过校验（${reason}），正在只重生成缺失的创意字段。` });
  });
  validateShots(draftShots, story, "Shot Integrator returned an incomplete or unverifiable draft.");
  onProgress?.({
    stage: "shot_draft",
    status: "COMPLETED",
    actor: "Shot Integrator -> Continuity Agent",
    message: `${draftShots.length} 个镜头已汇总为共享方案，移交连续性检查。`,
    durationMs: Date.now() - startedAt,
    artifact: { kind: "shot_draft", shots: draftShots },
  });

  let currentShots = draftShots;
  const discussion: CreativeExchange[] = [
    { from: "Shot Agent", to: "Continuity Agent", type: "PROPOSAL", content: `提交 ${draftShots.length} 个镜头草案，请独立检查跨镜头连续性。` },
  ];
  for (let round = 1; round <= 3; round += 1) {
    startedAt = Date.now();
    onProgress?.({ stage: "continuity", status: "STARTED", actor: `Continuity Agent · 第 ${round} 轮`, message: `正在独立检查第 ${round} 轮最新镜头；本轮不读取上一轮意见。` });
    const continuity = await reviewContinuity(understanding, currentShots, round, signal);
    const reviewDetails = continuity.issues.length
      ? continuity.issues.map((issue) => `${issue.shotId}/${issue.dimension}: ${issue.observation} 建议：${issue.suggestion}`).join("；")
      : "未发现需要修订的跨镜头连续性问题。";
    onProgress?.({
      stage: "continuity",
      status: "COMPLETED",
      actor: continuity.issues.length ? `Continuity Agent -> Shot Agent · 第 ${round} 轮` : `Continuity Agent -> Human Director · 第 ${round} 轮`,
      message: `${continuity.summary} ${reviewDetails}`,
      durationMs: Date.now() - startedAt,
      artifact: { kind: "continuity", round, summary: continuity.summary, issues: continuity.issues },
    });
    discussion.push({ from: "Continuity Agent", to: continuity.issues.length ? "Shot Agent" : "Human Director", type: "CONTINUITY_REVIEW", content: `第 ${round} 轮：${continuity.summary} ${reviewDetails}` });
    if (!continuity.issues.length) break;
    if (round === 3) {
      discussion.push({ from: "Continuity Agent", to: "Human Director", type: "CONTINUITY_REVIEW", content: `终检仍有 ${continuity.issues.length} 条建议，停止自动修改并交由人工决定。` });
      break;
    }

    startedAt = Date.now();
    onProgress?.({ stage: "shot_revision", status: "STARTED", actor: `Shot Agent · 第 ${round} 轮`, message: `正在回应第 ${round} 轮的 ${continuity.issues.length} 条建议并修改镜头。` });
    const revision = await reviseShots(story, understanding, currentShots, continuity, round, signal);
    currentShots = revision.shots;
    const replyDetails = revision.replies.map((reply) => `${reply.issueId}: ${reply.decision}，${reply.reason}`).join("；");
    onProgress?.({
      stage: "shot_revision",
      status: "COMPLETED",
      actor: `Shot Agent -> Continuity Agent · 第 ${round} 轮`,
      message: `${revision.summary} ${replyDetails}`,
      durationMs: Date.now() - startedAt,
      artifact: { kind: "shot_revision", round, summary: revision.summary, replies: revision.replies, shots: revision.shots },
    });
    discussion.push({ from: "Shot Agent", to: "Continuity Agent", type: "REVISION_RESPONSE", content: `第 ${round} 轮：${revision.summary} ${replyDetails}` });
  }

  return {
    logline: understanding.logline,
    characters: understanding.characters || [],
    shots: currentShots,
    discussion,
  };
}

async function reviewContinuity(
  understanding: { logline: string; characters: Array<{ name: string; role: string; evidence: string }>; visualMoment: string },
  shots: ShotProposal[],
  round: number,
  signal?: AbortSignal,
) {
  const result = await chatJson<{ summary: string; issues: ContinuityIssue[] }>(
    "你是一个全新上下文中的 Continuity Agent，不是 Critic。只输出合法 JSON，不要 Markdown。你只能根据本次提供的故事事实和最新版镜头独立检查，不推测或引用任何上一轮意见。检查人物外观、服装、空间方位、光线和动作衔接，只报告会造成画面不连续的问题，最多 5 条。没有问题时 issues 必须是空数组。每条 issue 的 id 必须使用给定轮次前缀，shotId 必须来自输入，并给出可执行建议。不要改写故事，不评价艺术风格。",
    `轮次：${round}\n故事事实：${JSON.stringify(understanding)}\n最新版镜头：${JSON.stringify(shots)}\n输出：{"summary":"","issues":[{"id":"r${round}_issue_1","shotId":"shot_1","dimension":"character|wardrobe|space|lighting|action","observation":"","suggestion":""}]}；如果没有问题，输出 {"summary":"检查通过的说明","issues":[]}`,
    signal,
  );
  const issues = Array.isArray(result.issues) ? result.issues.slice(0, 5) : [];
  const shotIds = new Set(shots.map((shot) => shot.id));
  const ids = new Set(issues.map((issue) => issue.id));
  const valid = Boolean(result.summary) && issues.every((issue) => issue.id.startsWith(`r${round}_`) && shotIds.has(issue.shotId) && issue.dimension && issue.observation && issue.suggestion) && ids.size === issues.length;
  if (!valid) throw new Error(`Continuity Agent 第 ${round} 轮返回格式不完整。`);
  return { summary: result.summary, issues };
}

async function reviseShots(
  story: string,
  understanding: { logline: string; characters: Array<{ name: string; role: string; evidence: string }>; visualMoment: string },
  shots: ShotProposal[],
  continuity: { summary: string; issues: ContinuityIssue[] },
  round: number,
  signal?: AbortSignal,
) {
  const requiredIds = continuity.issues.map((issue) => issue.id);
  type RevisionResult = {
    summary: string;
    replies: Array<{ issueId: string; decision: "accepted" | "declined"; reason: string }>;
    shots: ShotProposal[];
  };
  const system = "你是 Shot Agent。只输出合法 JSON，不要 Markdown。逐条回应本轮 Continuity 建议，每个给定 issueId 必须且只能出现一次，decision 只能是 accepted 或 declined，reason 不得为空。接受时修改对应镜头，拒绝时说明故事或镜头逻辑依据。保持镜头 id/order/source/adaptation 完整，不新增情节。";
  const baseInput = `轮次：${round}\n原文：${story}\n故事事实：${JSON.stringify(understanding)}\n当前镜头：${JSON.stringify(shots)}\n本轮建议：${JSON.stringify(continuity)}\n必须回应的 issueId：${JSON.stringify(requiredIds)}\n输出：{"summary":"","replies":${JSON.stringify(requiredIds.map((issueId) => ({ issueId, decision: "accepted", reason: "具体理由" })))},"shots":${JSON.stringify(shots)}}`;
  let lastError = `Shot Agent 第 ${round} 轮未完整回应当前建议。`;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const result = await chatJson<RevisionResult>(system, attempt === 1 ? baseInput : `${baseInput}\n上一次输出未通过结构校验。请严格覆盖且仅覆盖这些 issueId：${JSON.stringify(requiredIds)}，不要遗漏、重复或留空。`, signal);
    try {
      validateShots(result.shots, story, `Shot Agent 第 ${round} 轮返回了不可验证的镜头。`);
      const replies = Array.isArray(result.replies) ? result.replies : [];
      const replyIds = replies.map((reply) => reply.issueId);
      const valid = Boolean(result.summary) && replies.length === requiredIds.length && new Set(replyIds).size === requiredIds.length && requiredIds.every((id) => replyIds.includes(id)) && replies.every((reply) => (reply.decision === "accepted" || reply.decision === "declined") && Boolean(reply.reason?.trim()));
      if (valid) return result;
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    }
  }
  throw new Error(`${lastError} 已自动重试一次，请人工重试当前流程。`);
}

function mediaExchange(branch: "character" | "scene", from: string, to: string, content: string): MediaSwarmExchange {
  return { id: crypto.randomUUID(), branch, from, to, content, createdAt: new Date().toISOString() };
}

function normalizeBeatPlan(
  plan: { recommendedShotCount: number; rationale: string; beats: Array<{ id: string; source: { paragraph: number; quote: string }; action: string; visualGoal: string }> },
  story: string,
) {
  const paragraphs = story.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  if (!Array.isArray(plan.beats) || plan.beats.length < 1 || plan.beats.length > 12 || !plan.rationale?.trim()) {
    throw new Error("Visual Beat Agent returned no usable visual beats.");
  }
  const beats = plan.beats.map((beat, index) => {
    if (!beat.action?.trim() || !beat.visualGoal?.trim()) throw new Error(`Visual Beat Agent 的第 ${index + 1} 个节拍缺少动作或视觉目标。`);
    const requestedParagraph = Number.isInteger(beat.source?.paragraph) ? beat.source.paragraph : 0;
    const quote = beat.source?.quote?.trim() || "";
    let paragraph = paragraphs[requestedParagraph - 1]?.includes(quote) ? requestedParagraph : paragraphs.findIndex((item) => quote && item.includes(quote)) + 1;
    if (!paragraph && requestedParagraph > 0 && paragraphs[requestedParagraph - 1]) paragraph = requestedParagraph;
    if (!paragraph) throw new Error(`Visual Beat Agent 的第 ${index + 1} 个节拍无法定位到原文段落。`);
    const sourceQuote = quote && paragraphs[paragraph - 1].includes(quote) ? quote : paragraphs[paragraph - 1];
    return { id: `beat_${index + 1}`, source: { paragraph, quote: sourceQuote }, action: beat.action.trim(), visualGoal: beat.visualGoal.trim() };
  });
  return { recommendedShotCount: beats.length, rationale: plan.rationale.trim(), beats };
}

function normalizeCameraPlan<T extends { summary: string; proposals: Array<{ beatId: string; shotType: "LONG_TAKE" | "SHORT_SHOT" | "JUMP_CUT"; durationSeconds: number; camera: string; frameStrategy: "CONTINUOUS_KEYFRAMES" | "SINGLE_FRAME" | "INTENTIONAL_CUT"; reason: string }> }>(plan: T, beatIds: string[]) {
  if (!Array.isArray(plan.proposals) || plan.proposals.length !== beatIds.length) return plan;
  return { ...plan, proposals: plan.proposals.map((proposal, index) => ({ ...proposal, beatId: beatIds[index] })) };
}

function validateCameraPlan(
  plan: { summary: string; proposals: Array<{ beatId: string; shotType: string; durationSeconds: number; camera: string; frameStrategy: string; reason: string }> },
  beatIds: string[],
) {
  const strategyByType: Record<string, string> = { LONG_TAKE: "CONTINUOUS_KEYFRAMES", SHORT_SHOT: "SINGLE_FRAME", JUMP_CUT: "INTENTIONAL_CUT" };
  const proposalIds = plan.proposals?.map((proposal) => proposal.beatId) || [];
  const valid = Boolean(plan.summary)
    && proposalIds.length === beatIds.length
    && new Set(proposalIds).size === beatIds.length
    && beatIds.every((id) => proposalIds.includes(id))
    && plan.proposals.every((proposal) => strategyByType[proposal.shotType] === proposal.frameStrategy
      && Number.isFinite(proposal.durationSeconds)
      && proposal.durationSeconds > 0
      && proposal.durationSeconds <= 60
      && Boolean(proposal.camera)
      && Boolean(proposal.reason));
  if (!valid) throw new Error("Cinematography Agent did not cover every visual beat with a valid camera plan.");
}

type ShotCreativeDraft = {
  beatId: string;
  title: string;
  action: string;
  addedVisualDetails?: string[];
  changesStoryFact?: boolean;
  conflict?: string;
  startFramePrompt: string;
  endFramePrompt?: string;
  videoPrompt: string;
};

async function integrateShotDrafts(
  story: string,
  understanding: { logline: string; characters: Array<{ name: string; role: string; evidence: string }>; visualMoment: string },
  beatPlan: { recommendedShotCount: number; rationale: string; beats: Array<{ id: string; source: { paragraph: number; quote: string }; action: string; visualGoal: string }> },
  cameraPlan: { summary: string; proposals: Array<{ beatId: string; shotType: "LONG_TAKE" | "SHORT_SHOT" | "JUMP_CUT"; durationSeconds: number; camera: string; frameStrategy: "CONTINUOUS_KEYFRAMES" | "SINGLE_FRAME" | "INTENTIONAL_CUT"; reason: string }> },
  signal?: AbortSignal,
  onRetry?: (reason: string) => void,
) {
  const expectedIds = beatPlan.beats.map((beat) => beat.id);
  const prompt = `原文：\n${story}\n\n故事事实：${JSON.stringify(understanding)}\n视觉节拍：${JSON.stringify(beatPlan)}\n摄影提案：${JSON.stringify(cameraPlan)}\n\n只输出创意字段，必须逐一覆盖这些 beatId：${JSON.stringify(expectedIds)}。格式：[${expectedIds.map((beatId) => `{"beatId":"${beatId}","title":"","action":"","addedVisualDetails":[],"changesStoryFact":false,"conflict":"","startFramePrompt":"","endFramePrompt":"","videoPrompt":""}`).join(",")}]`;
  const system = "你是 Shot Integrator，不是 Critic。只输出合法 JSON 数组，不要 Markdown。你只负责为给定 beatId 编写标题、动作和媒体提示词，不要输出或重写 source、camera、shotType、durationSeconds、frameStrategy。不得增加情节。所有提示词必须非空；单参考帧镜头的 endFramePrompt 可以与 startFramePrompt 相同。";
  let lastReason = "未知结构问题";

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const creative = await chatJson<ShotCreativeDraft[]>(system, attempt === 1 ? prompt : `${prompt}\n上一次输出失败：${lastReason}。请严格只返回完整 JSON 数组，逐一覆盖全部 beatId，所有必填文本非空。`, signal);
      const reason = creativeDraftError(creative, expectedIds);
      if (reason) throw new Error(reason);

      const byBeat = new Map(creative.map((item) => [item.beatId, item]));
      const cameraByBeat = new Map(cameraPlan.proposals.map((item) => [item.beatId, item]));
      return beatPlan.beats.map((beat, index): ShotProposal => {
        const item = byBeat.get(beat.id)!;
        const camera = cameraByBeat.get(beat.id)!;
        return {
          id: `shot_${index + 1}`,
          order: index + 1,
          title: item.title.trim(),
          action: item.action.trim(),
          camera: camera.camera,
          source: beat.source,
          adaptation: {
            addedVisualDetails: Array.isArray(item.addedVisualDetails) ? item.addedVisualDetails : [],
            changesStoryFact: Boolean(item.changesStoryFact),
            ...(item.changesStoryFact ? { conflict: item.conflict?.trim() || "需要人工确认的事实变化" } : {}),
          },
          shotType: camera.shotType,
          durationSeconds: camera.durationSeconds,
          frameStrategy: camera.frameStrategy,
          continuityReason: camera.reason,
          inheritPreviousEndFrame: false,
          startFramePrompt: item.startFramePrompt.trim(),
          endFramePrompt: item.endFramePrompt?.trim() || item.startFramePrompt.trim(),
          videoPrompt: item.videoPrompt.trim(),
        };
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      lastReason = error instanceof Error ? error.message : "无法解析模型输出";
      if (attempt === 1) onRetry?.(lastReason);
    }
  }
  throw new Error(`Shot Integrator 自动修复后仍未通过：${lastReason}`);
}

function creativeDraftError(drafts: ShotCreativeDraft[], expectedIds: string[]) {
  if (!Array.isArray(drafts)) return "输出不是数组";
  if (drafts.length !== expectedIds.length) return `应返回 ${expectedIds.length} 项，实际返回 ${drafts.length} 项`;
  const ids = drafts.map((draft) => draft.beatId);
  if (new Set(ids).size !== expectedIds.length || expectedIds.some((id) => !ids.includes(id))) return "beatId 缺失或重复";
  const incomplete = drafts.find((draft) => !draft.title?.trim() || !draft.action?.trim() || !draft.startFramePrompt?.trim() || !draft.videoPrompt?.trim());
  return incomplete ? `${incomplete.beatId || "未知节拍"} 缺少标题、动作或媒体提示词` : undefined;
}

export async function prepareCharacterDesigns(
  characters: Array<{ name: string; role: string; evidence: string }>,
  onMessage: (exchange: MediaSwarmExchange) => void,
): Promise<CharacterDesign[]> {
  const draft = await chatJson<{ summary: string; designs: CharacterDesign[] }>(
    "你是 Character Look Agent。只输出合法 JSON，不要 Markdown。为每个人物建立稳定、可复用的外观设定。每条 prompt 必须明确要求在同一张角色设定图中并排呈现正面、侧面、背面三幅全身视图，保持同一人物、服装、比例、发型、镜头高度与光线，使用中性背景，不添加剧情动作。",
    `人物事实：${JSON.stringify(characters)}\n输出：{"summary":"给 Identity Agent 的设计说明","designs":[{"characterId":"character_1","name":"","prompt":""}]}`,
  );
  if (!draft.summary || !Array.isArray(draft.designs) || draft.designs.length !== characters.length) {
    throw new Error("Character Look Agent returned an incomplete proposal.");
  }
  onMessage(mediaExchange("character", "Character Look Agent", "Identity Agent", draft.summary));

  const reviewed = await chatJson<{ summary: string; designs: CharacterDesign[] }>(
    "你是 Identity Agent。只输出合法 JSON，不要 Markdown。检查角色提案是否忠于人物事实，是否能锁定跨镜头身份。修订每条 prompt，并确保每张图在同一画布中同时包含正面、侧面、背面三幅全身视图，三者人物身份、衣着、比例、发型、镜头高度与光线完全一致。不得新增故事事实。",
    `人物事实：${JSON.stringify(characters)}\nCharacter Look Agent 提案：${JSON.stringify(draft.designs)}\n输出：{"summary":"复核与修改说明","designs":[{"characterId":"character_1","name":"","prompt":""}]}`,
  );
  const valid = reviewed.summary && Array.isArray(reviewed.designs) && reviewed.designs.length === characters.length && reviewed.designs.every((item) => item.characterId && item.name && item.prompt);
  if (!valid) throw new Error("Identity Agent returned an incomplete character design.");
  onMessage(mediaExchange("character", "Identity Agent", "Human Director", reviewed.summary));
  return reviewed.designs;
}

export async function prepareSceneDesigns(
  shots: ShotProposal[],
  onMessage: (exchange: MediaSwarmExchange) => void,
): Promise<SceneDesign[]> {
  const shotFacts = shots.map(({ id, order, title, action, camera, source }) => ({ id, order, title, action, camera, source }));
  const draft = await chatJson<{ summary: string; designs: SceneDesign[] }>(
    "你是 Production Design Agent。只输出合法 JSON，不要 Markdown。为每个镜头建立独立场景提示词，描述空间结构、材质、陈设、天气、时间和基础光线，不写人物外观，不新增剧情事实。同时推荐参考帧策略：连续动作或长镜头用 CONTINUOUS_KEYFRAMES；普通短镜头用 SINGLE_FRAME；叙事明确需要跳切时才用 INTENTIONAL_CUT，并说明理由。",
    `镜头事实：${JSON.stringify(shotFacts)}\n输出：{"summary":"给 Scene Continuity Agent 的设计说明","designs":[{"sceneId":"scene_1","shotId":"shot_1","name":"","prompt":"","frameStrategyRecommendation":"CONTINUOUS_KEYFRAMES|SINGLE_FRAME|INTENTIONAL_CUT","continuityReason":""}]}`,
  );
  if (!draft.summary || !Array.isArray(draft.designs) || draft.designs.length !== shots.length) {
    throw new Error("Production Design Agent returned an incomplete proposal.");
  }
  onMessage(mediaExchange("scene", "Production Design Agent", "Scene Continuity Agent", draft.summary));

  const reviewed = await chatJson<{ summary: string; designs: SceneDesign[] }>(
    "你是 Scene Continuity Agent。只输出合法 JSON，不要 Markdown。检查相邻镜头的空间、天气、时间和光线是否符合故事与镜头关系；修订场景提示词，但不要混入人物外观，也不要新增故事事实。复核参考帧策略：连续动作或长镜头用 CONTINUOUS_KEYFRAMES；普通短镜头用 SINGLE_FRAME；只有刻意跳切才用 INTENTIONAL_CUT。每个 shotId 必须保留且唯一。",
    `镜头事实：${JSON.stringify(shotFacts)}\nProduction Design Agent 提案：${JSON.stringify(draft.designs)}\n输出：{"summary":"复核与修改说明","designs":[{"sceneId":"scene_1","shotId":"shot_1","name":"","prompt":"","frameStrategyRecommendation":"CONTINUOUS_KEYFRAMES|SINGLE_FRAME|INTENTIONAL_CUT","continuityReason":""}]}`,
  );
  const shotIds = new Set(shots.map((shot) => shot.id));
  const strategies = new Set(["CONTINUOUS_KEYFRAMES", "SINGLE_FRAME", "INTENTIONAL_CUT"]);
  const valid = reviewed.summary && Array.isArray(reviewed.designs) && reviewed.designs.length === shots.length && reviewed.designs.every((item) => item.sceneId && shotIds.has(item.shotId) && item.name && item.prompt && strategies.has(item.frameStrategyRecommendation) && item.continuityReason);
  if (!valid) throw new Error("Scene Continuity Agent returned an incomplete scene design.");
  onMessage(mediaExchange("scene", "Scene Continuity Agent", "Human Director", reviewed.summary));
  return reviewed.designs;
}

function validateShots(shots: ShotProposal[], story: string, message: string) {
  const paragraphs = story.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const strategyByType = { LONG_TAKE: "CONTINUOUS_KEYFRAMES", SHORT_SHOT: "SINGLE_FRAME", JUMP_CUT: "INTENTIONAL_CUT" } as const;
  const valid = Array.isArray(shots) && shots.length >= 1 && shots.length <= 12 && shots.every((shot, index) =>
    shot.id && shot.order === index + 1 && shot.title && shot.action && shot.camera &&
    Number.isInteger(shot.source?.paragraph) && shot.source.paragraph > 0 && Boolean(shot.source.quote) &&
    Array.isArray(shot.adaptation?.addedVisualDetails) && typeof shot.adaptation?.changesStoryFact === "boolean" &&
    (!shot.adaptation.changesStoryFact || Boolean(shot.adaptation.conflict)) &&
    paragraphs[shot.source.paragraph - 1]?.includes(shot.source.quote.trim()) &&
    shot.shotType in strategyByType && shot.frameStrategy === strategyByType[shot.shotType] &&
    Number.isFinite(shot.durationSeconds) && shot.durationSeconds > 0 && shot.durationSeconds <= 60 &&
    shot.startFramePrompt && shot.endFramePrompt && shot.videoPrompt,
  );
  if (!valid) throw new Error(message);
}

export async function generateImage(prompt: string): Promise<ImageGenerationResponse> {
  const response = await fetch(`${API_ROOT}/services/aigc/multimodal-generation/generation`, {
    method: "POST",
    headers: { Authorization: `Bearer ${dashScopeApiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen-image-3.0",
      input: { messages: [{ role: "user", content: [{ text: prompt }] }] },
      parameters: { prompt_extend: true },
    }),
    cache: "no-store",
  });
  const data = (await readResponse(response, "DashScope")) as { request_id?: string; output?: { choices?: Array<{ message?: { content?: Array<{ image?: string; image_url?: string }> } }> } };
  const item = data.output?.choices?.[0]?.message?.content?.find((entry) => entry.image || entry.image_url);
  const imageUrl = item?.image || item?.image_url;
  if (!imageUrl) throw new Error("The image model returned no image URL.");
  return { imageUrl, requestId: data.request_id };
}
