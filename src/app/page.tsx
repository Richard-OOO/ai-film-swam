"use client";

import { useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ArrowLeft, Check, ChevronRight, Clapperboard, Clock3, FilePlus2, FileText, Pause, Play, Plus, Trash2, Upload, X } from "lucide-react";
import type { ImageJob, MediaPreproductionEvent, MediaPreproductionState, PlanningArtifact, PlanningStage, PlanningStreamEvent, ShotProposal, StartRunResponse, SwarmMessage, TraceEvent, VideoGenerationResponse } from "@/lib/domain";
import { EditingStage, IntegrationStage, MediaStage, ReviewStage, ShotPlanningStage, StoryReviewStage, UnderstandingStage } from "@/components/studio/stages";

gsap.registerPlugin(useGSAP);

const stages = ["理解", "整合", "故事审查", "镜头规划", "媒体生成", "视频审查", "剪辑"];
type Screen = "projects" | "create" | "studio";
type ShotAssetState = { startFrameUrl?: string; endFrameUrl?: string; video?: VideoGenerationResponse; jobs?: ImageJob[]; status: "idle" | "frames" | "video" };
const emptyMediaPrep: MediaPreproductionState = { characterStatus: "IDLE", sceneStatus: "IDLE", characters: [], scenes: [], exchanges: [], approved: false };

export default function Home() {
  const [screen, setScreen] = useState<Screen>("projects");
  const [title, setTitle] = useState("雨夜信号");
  const [story, setStory] = useState("");
  const [sourceFileName, setSourceFileName] = useState("");
  const [fileError, setFileError] = useState("");
  const [draggingFile, setDraggingFile] = useState(false);
  const [run, setRun] = useState<StartRunResponse | null>(null);
  const [activeStage, setActiveStage] = useState(0);
  const [highestStage, setHighestStage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [paused, setPaused] = useState(false);
  const [approved, setApproved] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [traceOpen, setTraceOpen] = useState(false);
  const [planningProgress, setPlanningProgress] = useState<{ stage?: PlanningStage; elapsedMs: number }>({ elapsedMs: 0 });
  const [selectedShotId, setSelectedShotId] = useState("");
  const [shotAssets, setShotAssets] = useState<Record<string, ShotAssetState>>({});
  const [reviewedShots, setReviewedShots] = useState<Record<string, boolean>>({});
  const [mediaPrep, setMediaPrep] = useState<MediaPreproductionState>(emptyMediaPrep);
  const rootRef = useRef<HTMLElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const planningController = useRef<AbortController | null>(null);
  const seenMessageIds = useRef(new Set<string>());

  useGSAP(() => { gsap.fromTo(".view-enter", { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.35, ease: "power2.out" }); }, { scope: rootRef, dependencies: [screen, activeStage], revertOnUpdate: true });

  const paragraphs = useMemo(() => story.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean), [story]);
  const artifacts = useMemo(() => run?.trace.flatMap((event) => event.artifact ? [event.artifact] : []) || [], [run]);
  const storyArtifact = artifacts.find((artifact): artifact is Extract<PlanningArtifact, { kind: "story" }> => artifact.kind === "story");
  const selectedShot = run?.proposal.shots.find((shot) => shot.id === selectedShotId) || run?.proposal.shots[0];
  const reviewedCount = Object.values(reviewedShots).filter(Boolean).length;

  async function importTextFile(file?: File) {
    setDraggingFile(false);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".txt")) {
      setFileError("当前版本只支持 TXT 文件。");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setFileError("TXT 文件不能超过 5 MB。");
      return;
    }
    try {
      const content = (await file.text()).replace(/^\uFEFF/, "").trim();
      if (!content) throw new Error("文件中没有可读取的文字。");
      setStory(content);
      setSourceFileName(file.name);
      setFileError("");
      if (!title.trim() || title === "雨夜信号") setTitle(file.name.replace(/\.txt$/i, ""));
    } catch (reason) {
      setFileError(reason instanceof Error ? reason.message : "TXT 文件读取失败。");
    }
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    void importTextFile(event.target.files?.[0]);
    event.target.value = "";
  }

  function handleFileDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    void importTextFile(event.dataTransfer.files?.[0]);
  }

  function removeSourceFile() {
    setStory("");
    setSourceFileName("");
    setFileError("");
  }

  async function api<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    const data = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
    return data;
  }

  function appendTrace(event: Omit<TraceEvent, "id" | "timestamp">) {
    setRun((current) => current ? { ...current, trace: [...current.trace, { ...event, id: `trace_${Date.now()}`, timestamp: new Date().toISOString() }] } : current);
  }

  function resetProject() {
    planningController.current?.abort();
    setRun(null); setApproved(false); setShotAssets({}); setReviewedShots({}); setMediaPrep(emptyMediaPrep); setError(""); setActiveStage(0); setHighestStage(0); setScreen("projects");
  }

  async function startRun() {
    setScreen("studio"); setActiveStage(0); setHighestStage(0); setLoading(true); setError(""); setRun(null); setApproved(false); setMediaPrep(emptyMediaPrep); setPlanningProgress({ elapsedMs: 0 });
    const controller = new AbortController();
    planningController.current = controller;
    try {
      const response = await fetch("/api/runs?stream=1", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, story }), signal: controller.signal });
      if (!response.ok) { const data = (await response.json()) as { error?: string }; throw new Error(data.error || `请求失败 (${response.status})`); }
      if (!response.body) throw new Error("规划流不可用");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;
      const consume = (event: PlanningStreamEvent) => {
        if (event.type === "INIT") return setRun(event.run);
        if (event.type === "HEARTBEAT") return setPlanningProgress({ stage: event.stage, elapsedMs: event.elapsedMs });
        if (event.type === "TRACE") {
          const stageIndex = event.event.stage === "story" ? 0 : 1;
          setActiveStage(stageIndex); setHighestStage(stageIndex); setPlanningProgress({ stage: event.event.stage, elapsedMs: event.event.durationMs || 0 });
          setRun((current) => current ? { ...current, trace: [...current.trace, event.event] } : current);
          return;
        }
        if (event.type === "COMPLETE") { completed = true; setRun(event.run); setSelectedShotId(event.run.proposal.shots[0]?.id || ""); setActiveStage(2); setHighestStage(2); return; }
        if (event.type === "ERROR") throw new Error(event.error);
      };
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n"); buffer = lines.pop() || "";
        for (const line of lines) if (line.trim()) consume(JSON.parse(line) as PlanningStreamEvent);
        if (done) break;
      }
      if (buffer.trim()) consume(JSON.parse(buffer) as PlanningStreamEvent);
      if (!completed) throw new Error("规划流提前结束");
    } catch (reason) {
      setError(reason instanceof DOMException && reason.name === "AbortError" ? "已停止当前规划" : reason instanceof Error ? reason.message : "规划失败");
    } finally { planningController.current = null; setLoading(false); }
  }

  function approveStory() {
    if (!run) return;
    setRun({ ...run, proposal: { ...run.proposal, needsReview: false } }); setApproved(true); setActiveStage(3); setHighestStage(3);
    appendTrace({ type: "HUMAN_APPROVED", actor: "Human Director", message: "故事方案已由人工批准，镜头任务池已解锁。" });
  }

  function updateShot(shotId: string, patch: Partial<ShotProposal>) {
    setRun((current) => current ? { ...current, proposal: { ...current.proposal, shots: current.proposal.shots.map((shot) => shot.id === shotId ? { ...shot, ...patch } : shot) } } : current);
  }

  function updateAssets(shotId: string, patch: Partial<ShotAssetState>) {
    setShotAssets((current) => ({ ...current, [shotId]: { ...(current[shotId] || { status: "idle" }), ...patch } }));
  }

  function recordSwarmMessages(messages: SwarmMessage[]) {
    const unseen = messages.filter((message) => !seenMessageIds.current.has(message.id));
    unseen.forEach((message) => seenMessageIds.current.add(message.id));
    if (!unseen.length) return;
    setRun((current) => current ? { ...current, trace: [...current.trace, ...unseen.map((message): TraceEvent => ({ id: `swarm_${message.id}`, type: "AGENT_MESSAGE", actor: `${message.from} -> ${message.to}`, message: message.content, timestamp: message.createdAt }))] } : current);
  }

  async function waitForFrames(shotId: string, ids: string[]) {
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      const result = await api<{ jobs: ImageJob[]; messages: SwarmMessage[] }>(`/api/swarm/jobs?ids=${ids.join(",")}`);
      updateAssets(shotId, { jobs: result.jobs }); recordSwarmMessages(result.messages);
      const failed = result.jobs.find((job) => job.status === "FAILED");
      if (failed) throw new Error(failed.error || "画面生成失败");
      if (result.jobs.length === ids.length && result.jobs.every((job) => job.status === "SUCCEEDED")) return result.jobs;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    throw new Error("图像任务超过五分钟，请检查 worker");
  }

  async function waitForVideo(shotId: string, initial: VideoGenerationResponse) {
    let video = initial;
    const deadline = Date.now() + 15 * 60 * 1000;
    updateAssets(shotId, { video });
    while (video.status === "QUEUED" || video.status === "RUNNING") {
      if (Date.now() >= deadline) throw new Error("视频任务超过十五分钟，请稍后重试。");
      await new Promise((resolve) => setTimeout(resolve, 2000));
      video = await api<VideoGenerationResponse>(`/api/media/video/${encodeURIComponent(video.id)}`);
      updateAssets(shotId, { video });
    }
    if (video.status === "FAILED") throw new Error(video.error || "视频生成失败。");
    return video;
  }

  async function startMediaPreproduction() {
    if (!run) return;
    setMediaPrep({ ...emptyMediaPrep, characterStatus: "RUNNING", sceneStatus: "RUNNING" });
    setError("");
    try {
      const response = await fetch("/api/media/preproduction", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ characters: run.proposal.characters, shots: run.proposal.shots }) });
      if (!response.ok) { const data = (await response.json()) as { error?: string }; throw new Error(data.error || `媒体预制请求失败 (${response.status})`); }
      if (!response.body) throw new Error("媒体蜂群事件流不可用");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const consume = (event: MediaPreproductionEvent) => {
        if (event.type === "SCENES_READY") {
          setRun((activeRun) => activeRun ? { ...activeRun, proposal: { ...activeRun.proposal, shots: activeRun.proposal.shots.map((shot) => {
            const recommendation = event.designs.find((scene) => scene.shotId === shot.id);
            return recommendation ? { ...shot, frameStrategy: recommendation.frameStrategyRecommendation, continuityReason: recommendation.continuityReason } : shot;
          }) } } : activeRun);
        }
        setMediaPrep((current) => {
          if (event.type === "BRANCH_STARTED") return { ...current, [event.branch === "character" ? "characterStatus" : "sceneStatus"]: "RUNNING" };
          if (event.type === "MESSAGE") return { ...current, exchanges: [...current.exchanges, event.exchange] };
          if (event.type === "CHARACTERS_READY") return { ...current, characterStatus: "READY", characters: event.designs };
          if (event.type === "SCENES_READY") return { ...current, sceneStatus: "READY", scenes: event.designs };
          if (event.type === "BRANCH_FAILED") return { ...current, [event.branch === "character" ? "characterStatus" : "sceneStatus"]: "FAILED", [event.branch === "character" ? "characterError" : "sceneError"]: event.error };
          return current;
        });
      };
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n"); buffer = lines.pop() || "";
        for (const line of lines) if (line.trim()) consume(JSON.parse(line) as MediaPreproductionEvent);
        if (done) break;
      }
      if (buffer.trim()) consume(JSON.parse(buffer) as MediaPreproductionEvent);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "媒体预制失败");
      setMediaPrep((current) => ({ ...current, characterStatus: current.characterStatus === "RUNNING" ? "FAILED" : current.characterStatus, sceneStatus: current.sceneStatus === "RUNNING" ? "FAILED" : current.sceneStatus }));
    }
  }

  function updateMediaPrompt(branch: "character" | "scene", id: string, prompt: string) {
    setMediaPrep((current) => branch === "character"
      ? { ...current, characters: current.characters.map((item) => item.characterId === id ? { ...item, prompt } : item), approved: false }
      : { ...current, scenes: current.scenes.map((item) => item.sceneId === id ? { ...item, prompt } : item), approved: false });
  }

  async function generateFrames(shot: ShotProposal) {
    if (!mediaPrep.approved) { setError("请先人工确认角色与场景提示词。"); return; }
    setError(""); updateAssets(shot.id, { status: "frames", video: undefined, startFrameUrl: undefined, endFrameUrl: undefined });
    try {
      const strategy = shot.frameStrategy || "CONTINUOUS_KEYFRAMES";
      const previous = run?.proposal.shots.find((item) => item.order === shot.order - 1);
      const inherited = strategy === "CONTINUOUS_KEYFRAMES" && shot.inheritPreviousEndFrame && previous ? shotAssets[previous.id]?.endFrameUrl : undefined;
      if (shot.inheritPreviousEndFrame && previous && !inherited) throw new Error("上一镜头尾帧尚未生成，不能建立继承关系。");
      const continuityPrefix = inherited ? `连续性参考：继承上一镜头 ${previous?.id} 的尾帧构图、人物状态与光线。当前模型仅接收文本，此约束尚未使用图像条件控制。\n` : "";
      const characterContext = mediaPrep.characters.map((item) => `${item.name}: ${item.prompt}`).join("\n");
      const sceneContext = mediaPrep.scenes.find((item) => item.shotId === shot.id)?.prompt || "";
      const visualBible = `角色视觉基准：\n${characterContext}\n场景视觉基准：\n${sceneContext}\n`;
      const tasks: Array<{ shotId: string; frame: "start" | "end"; prompt: string }> = [{ shotId: shot.id, frame: "start", prompt: `${visualBible}${continuityPrefix}${shot.startFramePrompt}` }];
      if (strategy === "CONTINUOUS_KEYFRAMES") tasks.push({ shotId: shot.id, frame: "end", prompt: `${continuityPrefix}${shot.endFramePrompt}` });
      const queued = await api<{ jobs: ImageJob[] }>("/api/swarm/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tasks }) });
      updateAssets(shot.id, { jobs: queued.jobs });
      const jobs = await waitForFrames(shot.id, queued.jobs.map((job) => job.id));
      const startFrameUrl = jobs.find((job) => job.frame === "start")?.imageUrl;
      const endFrameUrl = jobs.find((job) => job.frame === "end")?.imageUrl;
      if (!startFrameUrl || (strategy === "CONTINUOUS_KEYFRAMES" && !endFrameUrl)) throw new Error("图像蜂群返回内容不完整");
      updateAssets(shot.id, { startFrameUrl, endFrameUrl });
      appendTrace({ type: "ASSET_GENERATED", actor: "Frame Worker Pool", message: `${shot.title} 的参考帧已生成，等待人工确认后再生成视频。` });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "参考帧生成失败"); }
    finally { updateAssets(shot.id, { status: "idle" }); }
  }

  async function generateVideo(shot: ShotProposal) {
    const asset = shotAssets[shot.id];
    const strategy = shot.frameStrategy || "CONTINUOUS_KEYFRAMES";
    if (!asset?.startFrameUrl || (strategy === "CONTINUOUS_KEYFRAMES" && !asset.endFrameUrl)) {
      setError("请先生成并检查完整的参考帧。");
      return;
    }
    setError(""); updateAssets(shot.id, { status: "video", video: undefined });
    try {
      const startFrameUrl = asset.startFrameUrl;
      const endFrameUrl = asset.endFrameUrl;
      const createdVideo = await api<VideoGenerationResponse>("/api/media/video", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shotId: shot.id, startFrameUrl, endFrameUrl, prompt: shot.videoPrompt, duration: shot.durationSeconds, frameStrategy: strategy }) });
      const video = await waitForVideo(shot.id, createdVideo);
      updateAssets(shot.id, { video });
      appendTrace({ type: "ASSET_GENERATED", actor: "Media Swarm", message: `${shot.title} 已按 ${strategy} 策略生成参考帧与真实视频。` });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "视频生成失败"); }
    finally { updateAssets(shot.id, { status: "idle" }); }
  }

  if (screen === "projects") return <main className="project-home view-enter" ref={rootRef}><header className="home-header"><div className="brand-lockup"><span><Clapperboard size={19} /></span><strong>AI Film Swarm</strong></div><button className="avatar-button">D</button></header><section className="project-library"><div className="library-heading"><div><p>PROJECTS</p><h1>你的电影项目</h1></div><button className="primary-command" onClick={() => setScreen("create")}><Plus size={16} />创建项目</button></div><div className="project-grid"><button className="create-tile" onClick={() => setScreen("create")}><span><FilePlus2 size={28} /></span><strong>创建新电影</strong><small>从小说或故事文本开始</small></button>{run && <button className="project-tile" onClick={() => setScreen("studio")}><div className="project-cover"><Clapperboard size={32} /></div><strong>{title}</strong><span><Clock3 size={12} />刚刚编辑</span></button>}</div></section></main>;

  if (screen === "create") return <main className="create-screen view-enter" ref={rootRef}><button className="back-button" onClick={() => setScreen("projects")}><ArrowLeft size={17} />项目</button><section className="create-project"><div className="create-copy"><span>NEW FILM</span><h1>把故事交给片场</h1><p>导入小说后进入分阶段工作台。原文只在理解阶段用于事实提取，不会常驻创作界面。</p></div><div className="create-form"><label>项目名称<input value={title} onChange={(event) => setTitle(event.target.value)} /></label><div className="source-field"><span>小说文件</span><input ref={fileInputRef} className="source-file-input" type="file" accept=".txt,text/plain" onChange={handleFileInput} />{sourceFileName ? <div className="source-file-ready"><FileText size={22} /><div><strong>{sourceFileName}</strong><small>{paragraphs.length} 个段落 · {story.length.toLocaleString()} 字</small></div><button type="button" title="移除文件" onClick={removeSourceFile}><Trash2 size={16} /></button></div> : <div className={`source-dropzone ${draggingFile ? "dragging" : ""}`} role="button" tabIndex={0} onClick={() => fileInputRef.current?.click()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") fileInputRef.current?.click(); }} onDragEnter={(event) => { event.preventDefault(); setDraggingFile(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDraggingFile(false)} onDrop={handleFileDrop}><Upload size={25} /><strong>拖入 TXT 小说文件</strong><span>或点击选择文件</span><small>PDF 与 Word 将在后续版本支持</small></div>}{fileError && <p className="source-file-error">{fileError}</p>}</div><button className="primary-command wide" disabled={!story.trim() || !title.trim()} onClick={startRun}><Play size={16} />创建并开始理解</button></div></section></main>;

  return <main className="studio-shell" ref={rootRef}><header className="studio-header"><button className="brand-button" onClick={() => setScreen("projects")}><Clapperboard size={18} /></button><div className="project-title"><strong>{title}</strong><span>{loading ? "蜂群工作中" : error ? "需要处理" : "已保存"}</span></div><div className="studio-actions"><button className="quiet-button" onClick={() => setTraceOpen(true)}>Trace <b>{run?.trace.length || 0}</b></button>{loading && <button className="icon-command" title="停止规划" onClick={() => planningController.current?.abort()}><Pause size={16} /></button>}<button className="icon-command" title="返回项目库" onClick={resetProject}><X size={17} /></button></div></header>
    <nav className="stage-nav" aria-label="制作进度">{stages.map((stage, index) => <button key={stage} className={`${index === activeStage ? "active" : ""} ${index < highestStage ? "done" : ""}`} disabled={index > highestStage} onClick={() => index <= highestStage && setActiveStage(index)}><span>{index < highestStage ? <Check size={12} /> : index + 1}</span><strong>{stage}</strong>{index < stages.length - 1 && <ChevronRight size={14} />}</button>)}</nav>
    <section className="stage-canvas view-enter">{activeStage === 0 && <UnderstandingStage paragraphs={paragraphs} artifact={storyArtifact} loading={loading} progress={planningProgress} error={error} onRetry={startRun} />}{activeStage === 1 && <IntegrationStage artifacts={artifacts} loading={loading} progress={planningProgress} error={error} onRetry={startRun} />}{activeStage === 2 && run && <StoryReviewStage run={run} editing={editing} error={error} onEditing={setEditing} onRunChange={setRun} onApprove={approveStory} />}{activeStage === 3 && run && <ShotPlanningStage shots={run.proposal.shots} agents={run.agents} selectedId={selectedShot?.id || ""} onSelect={setSelectedShotId} onContinue={() => { setActiveStage(4); setHighestStage(4); }} />}{activeStage === 4 && run && <MediaStage shots={run.proposal.shots} assets={shotAssets} selectedId={selectedShot?.id || ""} paused={paused} error={error} mediaPrep={mediaPrep} onStartPreproduction={startMediaPreproduction} onUpdateMediaPrompt={updateMediaPrompt} onApprovePreproduction={() => { setMediaPrep((current) => ({ ...current, approved: true })); appendTrace({ type: "HUMAN_APPROVED", actor: "Human Director", message: "角色与场景提示词已人工确认，镜头媒体任务已解锁。" }); }} onSelect={setSelectedShotId} onUpdateShot={updateShot} onGenerateFrames={generateFrames} onGenerateVideo={generateVideo} onPause={() => setPaused((value) => !value)} onContinue={() => { setActiveStage(5); setHighestStage(5); }} />}{activeStage === 5 && run && <ReviewStage shots={run.proposal.shots} assets={shotAssets} reviewed={reviewedShots} onReview={(id) => setReviewedShots((current) => ({ ...current, [id]: true }))} onBack={() => setActiveStage(4)} onContinue={() => { setActiveStage(6); setHighestStage(6); }} />}{activeStage === 6 && run && <EditingStage shots={run.proposal.shots} assets={shotAssets} reviewedCount={reviewedCount} />}</section>
    {traceOpen && <aside className="trace-drawer"><header><div><span>RUN TRACE</span><h2>运行记录</h2></div><button className="icon-command" title="关闭" onClick={() => setTraceOpen(false)}><X size={17} /></button></header><div className="trace-list">{run?.trace.map((event) => <article key={event.id}><i /><time>{new Date(event.timestamp).toLocaleTimeString("zh-CN")}</time><strong>{event.actor}</strong><p>{event.message}</p></article>) || <p className="empty-copy">尚无运行记录</p>}</div></aside>}{traceOpen && <button className="drawer-scrim" aria-label="关闭 Trace" onClick={() => setTraceOpen(false)} />}
  </main>;
}
