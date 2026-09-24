import { AlertCircle, Bot, Check, ChevronRight, CirclePause, CirclePlay, Film, GitBranch, Image as ImageIcon, LoaderCircle, LockKeyhole, Pencil, RefreshCw, Send, ShieldCheck, Sparkles, UserRoundCheck, Video } from "lucide-react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { Agent, FrameStrategy, ImageJob, MediaPreproductionState, PlanningArtifact, PlanningStage, ShotProposal, StartRunResponse, VideoGenerationResponse } from "@/lib/domain";

type Asset = { startFrameUrl?: string; endFrameUrl?: string; video?: VideoGenerationResponse; jobs?: ImageJob[]; status: "idle" | "frames" | "video" };
const stageName: Record<PlanningStage, string> = { story: "提取故事事实", visual_beats: "拆分视觉节拍", cinematography: "设计摄影语言", shot_draft: "汇总视觉方案", continuity: "协商跨镜连续性", shot_revision: "整合协作结论" };

function StageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) { return <header className="stage-heading"><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p></header>; }
function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) { return <div className="blocking-error"><AlertCircle size={19} /><div><strong>当前步骤未完成</strong><p>{error}</p></div><button onClick={onRetry}><RefreshCw size={14} />重试</button></div>; }

export function UnderstandingStage({ paragraphs, artifact, loading, progress, error, onRetry }: { paragraphs: string[]; artifact?: Extract<PlanningArtifact, { kind: "story" }>; loading: boolean; progress: { stage?: PlanningStage; elapsedMs: number }; error: string; onRetry: () => void }) {
  return <div className="stage-layout understanding-stage"><StageHeading eyebrow="01 / UNDERSTAND" title="理解原文，不改写原文" description="Story Agent 按段读取，产出的事实必须能回到对应段落。原文仅在本阶段展示。" />{error && <ErrorState error={error} onRetry={onRetry} />}<div className="understanding-grid"><section className="paragraph-board"><header><strong>段落事实地图</strong><span>{paragraphs.length} 段</span></header>{paragraphs.map((paragraph, index) => <article className={artifact ? "checked" : loading && index === 0 ? "reading" : ""} key={`${index}_${paragraph.slice(0, 10)}`}><div><span>P{String(index + 1).padStart(2, "0")}</span>{artifact ? <Check size={14} /> : <LoaderCircle size={14} className={loading && index === 0 ? "spin" : ""} />}</div><p>{paragraph}</p></article>)}</section><aside className="fact-panel"><header><Sparkles size={16} /><strong>提取结果</strong></header>{artifact ? <><div className="fact-block"><span>故事主线</span><p>{artifact.logline}</p></div><div className="fact-block"><span>核心画面</span><p>{artifact.visualMoment}</p></div><div className="fact-list">{artifact.characters.map((character) => <article key={character.name}><strong>{character.name}</strong><span>{character.role}</span><p>{character.evidence}</p></article>)}</div></> : <div className="working-empty"><LoaderCircle className="spin" size={20} /><strong>{progress.stage ? stageName[progress.stage] : "等待 Story Agent"}</strong><span>{Math.round(progress.elapsedMs / 1000)} 秒</span></div>}</aside></div></div>;
}

export function IntegrationStage({ artifacts, loading, progress, error, onRetry }: { artifacts: PlanningArtifact[]; loading: boolean; progress: { stage?: PlanningStage; elapsedMs: number }; error: string; onRetry: () => void }) {
  const relevant = artifacts.filter((item) => item.kind !== "story");
  return <div className="stage-layout"><StageHeading eyebrow="02 / VISUAL SWARM" title="视觉方案协作台" description="三位 Agent 依次领取同一共享任务：拆节拍、定摄影语言、汇总镜头。中间产物会实时留在中央工作台。" />{error && <ErrorState error={error} onRetry={onRetry} />}<div className="integration-flow"><div className="agent-lane"><span><Bot size={16} />Visual Beat</span><i /><span><Film size={16} />Cinematography</span><i /><span><GitBranch size={16} />Integrator</span><i /><span><UserRoundCheck size={16} />Human Gate</span></div><div className="round-policy"><ShieldCheck size={15} /><span><strong>共享任务池</strong><small>后一个 Agent 读取前一个 Agent 的结构化产物；Continuity 只提出建议，最终由人审查。</small></span></div>{relevant.map((artifact, index) => <CollaborationArtifact artifact={artifact} key={`${artifact.kind}_${index}`} />)}{loading && <div className="collaboration-live"><div><LoaderCircle className="spin" size={18} /><span><strong>{progress.stage ? stageName[progress.stage] : "等待领取任务"}</strong><small>{activeCollaborationCopy(progress.stage)}</small></span></div><time>{Math.round(progress.elapsedMs / 1000)} 秒</time></div>}</div></div>;
}

function activeCollaborationCopy(stage?: PlanningStage) {
  if (stage === "visual_beats") return "Visual Beat Agent 正在引用原文并拆分可拍摄节拍";
  if (stage === "cinematography") return "Cinematography Agent 正在读取节拍并设计摄影语言";
  if (stage === "shot_draft") return "Shot Integrator 正在合并两份提案";
  if (stage === "continuity") return "Continuity Agent 正在独立读取最新版镜头";
  if (stage === "shot_revision") return "Shot Agent 正在逐条回应建议";
  return "共享任务等待 Agent 领取";
}

function CollaborationArtifact({ artifact }: { artifact: Exclude<PlanningArtifact, { kind: "story" }> }) {
  if (artifact.kind === "visual_beats") return <article className="integration-card visual_beats"><header><span>1</span><div><strong>Visual Beat Agent · 节拍提案</strong><small>移交给 Cinematography Agent</small></div><i>{artifact.beats.length} 个节拍</i></header><p>{artifact.rationale}</p><div className="proposal-grid">{artifact.beats.map((beat) => <div key={beat.id}><b>{beat.id}</b><strong>{beat.action}</strong><span>{beat.visualGoal}</span><small>P{beat.source.paragraph} · “{beat.source.quote}”</small></div>)}</div></article>;
  if (artifact.kind === "cinematography") return <article className="integration-card cinematography"><header><span>2</span><div><strong>Cinematography Agent · 摄影提案</strong><small>读取节拍后移交给 Shot Integrator</small></div><i>{artifact.proposals.length} 项决策</i></header><p>{artifact.summary}</p><div className="proposal-grid camera-proposals">{artifact.proposals.map((proposal) => <div key={proposal.beatId}><b>{proposal.beatId}</b><strong>{proposal.shotType} · {proposal.durationSeconds}s</strong><span>{proposal.camera}</span><small>{proposal.frameStrategy} · {proposal.reason}</small></div>)}</div></article>;
  if (artifact.kind === "shot_draft") return <article className="integration-card shot_draft"><header><span>3</span><div><strong>Shot Integrator · 共享镜头方案</strong><small>故事事实 + 节拍提案 + 摄影提案</small></div><i>{artifact.shots.length} 个镜头</i></header><div className="mini-shots">{artifact.shots.map((shot) => <div key={shot.id}><b>{shot.order}</b><span><strong>{shot.title}</strong><small>{shot.shotType} · {shot.durationSeconds}s · {shot.action}</small></span></div>)}</div></article>;
  if (artifact.kind === "continuity") return <article className="integration-card continuity"><header><span>{artifact.round}</span><div><strong>第 {artifact.round} 轮 · Continuity 建议</strong><small>独立读取当前最新版镜头</small></div><i>{artifact.issues.length ? `${artifact.issues.length} 条建议` : "检查通过"}</i></header><p>{artifact.summary}</p>{artifact.issues.length ? artifact.issues.map((issue) => <div className="issue-line" key={issue.id}><strong>{issue.shotId} · {issue.dimension}</strong><span>{issue.observation}</span><em>建议：{issue.suggestion}</em></div>) : <div className="round-clear"><Check size={15} />本轮没有发现新的连续性问题</div>}</article>;
  return <article className="integration-card shot_revision"><header><span>{artifact.round}</span><div><strong>第 {artifact.round} 轮 · Shot 修改回应</strong><small>逐条决定并更新共享方案</small></div><i>{artifact.replies.length} 条回应</i></header><p>{artifact.summary}</p><div className="reply-list">{artifact.replies.map((reply) => <div key={reply.issueId}><span className={reply.decision}>{reply.decision === "accepted" ? "接受并修改" : "保留原案"}</span><strong>{reply.issueId}</strong><p>{reply.reason}</p></div>)}</div></article>;
}

export function StoryReviewStage({ run, editing, error, onEditing, onRunChange, onApprove }: { run: StartRunResponse; editing: boolean; error: string; onEditing: (value: boolean) => void; onRunChange: Dispatch<SetStateAction<StartRunResponse | null>>; onApprove: () => void }) {
  const conflicts = run.proposal.shots.filter((shot) => shot.adaptation.changesStoryFact);
  const continuityArtifacts = run.trace.flatMap((event) => event.artifact?.kind === "continuity" ? [event.artifact] : []);
  const unresolved = continuityArtifacts.at(-1)?.issues || [];
  return <div className="stage-layout narrow-stage"><StageHeading eyebrow="03 / HUMAN GATE" title="故事审查" description="确认主线和人物没有被 Agent 改乱。人工批准之前，媒体生成不会启动。" />{error && <div className="inline-warning"><AlertCircle size={16} />{error}</div>}<section className="review-sheet"><div className="review-status"><ShieldCheck size={20} /><div><strong>{conflicts.length ? `${conflicts.length} 个事实冲突` : "引用校验通过"}</strong><span>镜头引用已在后端逐字核对</span></div></div>{unresolved.length > 0 && <div className="human-continuity"><header><AlertCircle size={16} /><div><strong>终检仍有 {unresolved.length} 条连续性建议</strong><span>自动协作已停止，请人工判断是否接受当前镜头方案。</span></div></header>{unresolved.map((issue) => <div key={issue.id}><strong>{issue.shotId} · {issue.dimension}</strong><p>{issue.observation}</p><em>{issue.suggestion}</em></div>)}</div>}<label>故事主线<textarea disabled={!editing} value={run.proposal.logline} onChange={(event) => onRunChange((current) => current ? { ...current, proposal: { ...current.proposal, logline: event.target.value } } : current)} /></label><div className="character-grid">{run.proposal.characters.map((character) => <article key={character.name}><span>{character.name.slice(0, 1)}</span><div><strong>{character.name}</strong><small>{character.role}</small><p>{character.evidence}</p></div></article>)}</div><div className="gate-actions"><button className="secondary-command" onClick={() => onEditing(!editing)}><Pencil size={15} />{editing ? "完成修改" : "修改主线"}</button><button className="primary-command" disabled={conflicts.length > 0} onClick={onApprove}><Check size={15} />{unresolved.length ? "知悉建议并批准" : "批准并进入镜头规划"}</button></div></section></div>;
}

export function ShotPlanningStage({ shots, agents, selectedId, onSelect, onContinue }: { shots: ShotProposal[]; agents: Agent[]; selectedId: string; onSelect: (id: string) => void; onContinue: () => void }) {
  const selected = shots.find((shot) => shot.id === selectedId) || shots[0];
  return <div className="stage-layout"><StageHeading eyebrow="04 / SHARED TASK POOL" title="镜头任务池" description="镜头是共享任务，不属于某个固定 Agent。Agent 领取、反馈、交接，最终由你确认。" /><div className="taskpool-layout"><section className="task-pool"><header><div><strong>可领取任务</strong><span>{shots.length} 个镜头</span></div><span className="pool-live"><i />POOL ACTIVE</span></header>{shots.map((shot) => <button className={shot.id === selected?.id ? "active" : ""} key={shot.id} onClick={() => onSelect(shot.id)}><b>{String(shot.order).padStart(2, "0")}</b><div><strong>{shot.title}</strong><span>{shot.action}</span><small><Bot size={12} />Shot Agent · READY</small></div><ChevronRight size={17} /></button>)}</section><section className="task-inspector">{selected && <><header><span>SHOT {String(selected.order).padStart(2, "0")}</span><h2>{selected.title}</h2></header><div className="inspector-block"><span>动作</span><p>{selected.action}</p></div><div className="inspector-block"><span>摄影</span><p>{selected.camera}</p></div><div className="evidence-chip"><LockKeyhole size={14} /><div><strong>事实依据 · 第 {selected.source.paragraph} 段</strong><p>“{selected.source.quote}”</p></div></div><div className="agent-presence"><span>在线协作者</span>{agents.slice(0, 3).map((agent) => <i title={agent.name} key={agent.id}>{agent.name.slice(0, 1)}</i>)}</div></>}</section></div><div className="stage-footer"><button className="primary-command" onClick={onContinue}>确认任务池，进入媒体生成<ChevronRight size={15} /></button></div></div>;
}

export function MediaStage({ shots, assets, selectedId, paused, error, mediaPrep, onStartPreproduction, onUpdateMediaPrompt, onApprovePreproduction, onSelect, onUpdateShot, onGenerateFrames, onGenerateVideo, onPause, onContinue }: {
  shots: ShotProposal[];
  assets: Record<string, Asset>;
  selectedId: string;
  paused: boolean;
  error: string;
  mediaPrep: MediaPreproductionState;
  onStartPreproduction: () => void;
  onUpdateMediaPrompt: (branch: "character" | "scene", id: string, prompt: string) => void;
  onApprovePreproduction: () => void;
  onSelect: (id: string) => void;
  onUpdateShot: (id: string, patch: Partial<ShotProposal>) => void;
  onGenerateFrames: (shot: ShotProposal) => void;
  onGenerateVideo: (shot: ShotProposal) => void;
  onPause: () => void;
  onContinue: () => void;
}) {
  const selected = shots.find((shot) => shot.id === selectedId) || shots[0];
  const asset = selected ? assets[selected.id] || { status: "idle" } : { status: "idle" as const };
  const complete = shots.filter((shot) => assets[shot.id]?.video?.status === "SUCCEEDED").length;
  const prepRunning = mediaPrep.characterStatus === "RUNNING" || mediaPrep.sceneStatus === "RUNNING";
  const prepReady = mediaPrep.characterStatus === "READY" && mediaPrep.sceneStatus === "READY";
  const strategy: FrameStrategy = selected?.frameStrategy || "CONTINUOUS_KEYFRAMES";
  const framesReady = Boolean(asset.startFrameUrl && (strategy !== "CONTINUOUS_KEYFRAMES" || asset.endFrameUrl));
  const branchLabel = (status: MediaPreproductionState["characterStatus"]) => ({ IDLE: "待启动", RUNNING: "协作中", READY: "待确认", FAILED: "失败" })[status];
  const strategyCopy = strategy === "CONTINUOUS_KEYFRAMES"
    ? "长镜头或连续动作：生成首尾两帧并要求镜头内部连贯。"
    : strategy === "SINGLE_FRAME"
      ? "短镜头：只生成一张参考帧，由视频模型扩展动作。"
      : "刻意跳切：只生成独立参考帧，不强制与相邻镜头连续。";

  return <div className="stage-layout media-stage">
    <StageHeading eyebrow="05 / MEDIA SWARM" title="媒体生成" description="角色形象与场景设计由两组蜂群并行处理。你确认视觉基准后，再决定每个镜头如何使用参考帧并提交真实视频任务。" />
    {error && <div className="inline-warning"><AlertCircle size={16} />{error}</div>}
    <section className="preproduction-shell">
      <header className="preproduction-header">
        <div><span>01 / VISUAL BIBLE</span><strong>视觉预制</strong><small>两条分支并行，产物分开管理</small></div>
        <button className="secondary-command" disabled={prepRunning} onClick={onStartPreproduction}>{prepRunning ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}{mediaPrep.characters.length || mediaPrep.scenes.length ? "重新协作" : "启动双蜂群"}</button>
      </header>
      <div className="swarm-branches">
        <MediaBranch title="人物形象蜂群" subtitle="Character Look → Identity" status={branchLabel(mediaPrep.characterStatus)} statusKey={mediaPrep.characterStatus} error={mediaPrep.characterError} exchanges={mediaPrep.exchanges.filter((item) => item.branch === "character")}>
          {mediaPrep.characters.map((character) => <label key={character.characterId}>{character.name} · 正面与侧面同图<textarea value={character.prompt} onChange={(event) => onUpdateMediaPrompt("character", character.characterId, event.target.value)} /></label>)}
        </MediaBranch>
        <MediaBranch title="场景设计蜂群" subtitle="Production Design → Continuity" status={branchLabel(mediaPrep.sceneStatus)} statusKey={mediaPrep.sceneStatus} error={mediaPrep.sceneError} exchanges={mediaPrep.exchanges.filter((item) => item.branch === "scene")}>
          {mediaPrep.scenes.map((scene) => <label key={scene.sceneId}>{scene.name} · {scene.shotId}<textarea value={scene.prompt} onChange={(event) => onUpdateMediaPrompt("scene", scene.sceneId, event.target.value)} /><small className="strategy-recommendation">推荐：{scene.frameStrategyRecommendation} · {scene.continuityReason}</small></label>)}
        </MediaBranch>
      </div>
      <div className="prep-gate">
        <div>{mediaPrep.approved ? <ShieldCheck size={17} /> : <LockKeyhole size={17} />}<span><strong>{mediaPrep.approved ? "视觉基准已批准" : "等待人工确认"}</strong><small>{mediaPrep.approved ? "镜头生成任务已解锁" : "检查并修改两组提示词后再放行"}</small></span></div>
        <button className="primary-command" disabled={!prepReady || mediaPrep.approved} onClick={onApprovePreproduction}><UserRoundCheck size={15} />人工批准视觉基准</button>
      </div>
    </section>

    <section className={`shot-generation ${mediaPrep.approved ? "" : "locked"}`}>
      <header className="section-label"><span>02 / SHOT GENERATION</span><strong>镜头帧策略与生成</strong></header>
      <div className="media-toolbar"><div>{shots.map((shot) => <button className={shot.id === selected?.id ? "active" : ""} onClick={() => onSelect(shot.id)} key={shot.id}>SHOT {shot.order}{assets[shot.id]?.video?.status === "SUCCEEDED" && <Check size={12} />}</button>)}</div><button className="icon-command light" title={paused ? "恢复任务" : "暂停任务"} onClick={onPause}>{paused ? <CirclePlay size={16} /> : <CirclePause size={16} />}</button></div>
      {selected && <div className="strategy-panel">
        <div className="strategy-control" role="group" aria-label="参考帧策略">
          {([['CONTINUOUS_KEYFRAMES', '连续首尾帧'], ['SINGLE_FRAME', '单参考帧'], ['INTENTIONAL_CUT', '刻意跳切']] as Array<[FrameStrategy, string]>).map(([value, label]) => <button className={strategy === value ? "active" : ""} key={value} onClick={() => onUpdateShot(selected.id, { frameStrategy: value, inheritPreviousEndFrame: value === "CONTINUOUS_KEYFRAMES" ? selected.inheritPreviousEndFrame : false })}>{label}</button>)}
        </div>
        <p>{strategyCopy}{selected.continuityReason ? ` 蜂群建议：${selected.continuityReason}` : ""}</p>
        {strategy === "CONTINUOUS_KEYFRAMES" && selected.order > 1 && <label className="continuity-toggle"><input type="checkbox" checked={Boolean(selected.inheritPreviousEndFrame)} onChange={(event) => onUpdateShot(selected.id, { inheritPreviousEndFrame: event.target.checked })} /><span><strong>继承上一镜头尾帧</strong><small>当前只传递文本连续性约束，尚未启用图像条件控制</small></span></label>}
      </div>}
      {selected && <div className="media-workspace"><section className="frame-workbench"><div className={`frame-pair ${strategy !== "CONTINUOUS_KEYFRAMES" ? "single" : ""}`}><FrameBox label="首帧 / 参考帧" url={asset.startFrameUrl} busy={asset.status === "frames"} />{strategy === "CONTINUOUS_KEYFRAMES" && <FrameBox label="尾帧" url={asset.endFrameUrl} busy={asset.status === "frames"} />}</div>{asset.jobs?.length ? <div className="job-strip">{asset.jobs.map((job) => <span key={job.id}><i className={job.status.toLowerCase()} />{job.frame === "start" ? "首帧" : "尾帧"} · {job.workerId || "等待领取"} · {job.status}</span>)}</div> : null}{asset.video && <div className="job-strip"><span><i className={asset.video.status.toLowerCase()} />视频任务 · TokenWorld · {asset.video.status}</span></div>}</section><aside className="prompt-editor"><header><div><span>SHOT {selected.order}</span><h2>{selected.title}</h2></div><Sparkles size={17} /></header><label>首帧提示词<textarea value={selected.startFramePrompt} onChange={(event) => onUpdateShot(selected.id, { startFramePrompt: event.target.value })} /></label>{strategy === "CONTINUOUS_KEYFRAMES" && <label>尾帧提示词<textarea value={selected.endFramePrompt} onChange={(event) => onUpdateShot(selected.id, { endFramePrompt: event.target.value })} /></label>}<label>视频提示词<textarea value={selected.videoPrompt} onChange={(event) => onUpdateShot(selected.id, { videoPrompt: event.target.value })} /></label><button className="primary-command wide" disabled={!mediaPrep.approved || paused || asset.status !== "idle"} onClick={() => onGenerateFrames(selected)}>{asset.status === "frames" ? <LoaderCircle className="spin" size={16} /> : <ImageIcon size={16} />}{framesReady ? "重新生成参考帧" : "生成参考帧"}</button><button className="secondary-command wide" disabled={!framesReady || paused || asset.status !== "idle"} onClick={() => onGenerateVideo(selected)}>{asset.status === "video" ? <LoaderCircle className="spin" size={16} /> : <Video size={16} />}{asset.video?.status === "SUCCEEDED" ? "重新生成视频" : "确认图片并生成视频"}</button></aside></div>}
    </section>
    <div className="stage-footer"><span>{complete} / {shots.length} 个镜头已完成</span><button className="primary-command" disabled={!complete} onClick={onContinue}>进入视频审查<ChevronRight size={15} /></button></div>
  </div>;
}

function MediaBranch({ title, subtitle, status, statusKey, error, exchanges, children }: { title: string; subtitle: string; status: string; statusKey: MediaPreproductionState["characterStatus"]; error?: string; exchanges: MediaPreproductionState["exchanges"]; children: ReactNode }) {
  return <article className="media-branch"><header><div><Bot size={17} /><span><strong>{title}</strong><small>{subtitle}</small></span></div><i className={statusKey.toLowerCase()}>{statusKey === "RUNNING" && <LoaderCircle className="spin" size={12} />}{status}</i></header><div className="branch-discussion">{exchanges.length ? exchanges.map((exchange) => <div key={exchange.id}><span>{exchange.from} → {exchange.to}</span><p>{exchange.content}</p></div>) : <div className="branch-empty"><GitBranch size={18} /><span>{statusKey === "RUNNING" ? "等待第一轮交接" : "尚无协作记录"}</span></div>}</div>{error && <p className="branch-error"><AlertCircle size={13} />{error}</p>}<div className="branch-output">{children}</div></article>;
}

function FrameBox({ label, url, busy }: { label: string; url?: string; busy: boolean }) { return <div className="frame-box">{url ? <img src={url} alt={label} /> : <div>{busy ? <LoaderCircle className="spin" size={24} /> : <ImageIcon size={25} />}<span>{busy ? "生成中" : label}</span></div>}<b>{label}</b></div>; }

export function ReviewStage({ shots, assets, reviewed, onReview, onBack, onContinue }: { shots: ShotProposal[]; assets: Record<string, Asset>; reviewed: Record<string, boolean>; onReview: (id: string) => void; onBack: () => void; onContinue: () => void }) {
  const generated = shots.filter((shot) => assets[shot.id]?.video?.status === "SUCCEEDED");
  return <div className="stage-layout"><StageHeading eyebrow="06 / HUMAN REVIEW" title="逐镜审查" description="人决定视频是否通过。提示词不合意时，返回媒体阶段修改并重新生成。" /><div className="review-reel">{shots.map((shot) => { const asset = assets[shot.id]; const ready = asset?.video?.status === "SUCCEEDED"; return <article key={shot.id}><div className="reel-preview">{ready && asset.video?.videoUrl ? <video src={asset.video.videoUrl} controls playsInline /> : <>{asset?.startFrameUrl && <img src={asset.startFrameUrl} alt="首帧" />}{asset?.endFrameUrl && <img src={asset.endFrameUrl} alt="尾帧" />}{!ready && <span><Video size={24} />{asset?.video?.status || "尚未生成"}</span>}</>}</div><header><div><span>SHOT {shot.order}</span><strong>{shot.title}</strong></div>{reviewed[shot.id] && <i><Check size={12} />已通过</i>}</header><p>{shot.videoPrompt}</p><div><button className="secondary-command" onClick={onBack}><Pencil size={14} />修改提示词</button><button className="primary-command" disabled={!ready || reviewed[shot.id]} onClick={() => onReview(shot.id)}><UserRoundCheck size={14} />人工通过</button></div></article>; })}</div><div className="stage-footer"><span>{Object.values(reviewed).filter(Boolean).length} / {shots.length} 已审查</span><button className="primary-command" disabled={!generated.length} onClick={onContinue}>进入剪辑台<ChevronRight size={15} /></button></div></div>;
}

export function EditingStage({ shots, assets, reviewedCount }: { shots: ShotProposal[]; assets: Record<string, Asset>; reviewedCount: number }) { return <div className="stage-layout"><StageHeading eyebrow="07 / EDIT" title="剪辑台" description="把已通过的镜头按故事顺序组织。MVP 暂不合并输出完整影片文件。" /><section className="edit-console"><div className="program-monitor"><Film size={35} /><strong>预览监视器</strong><span>真实镜头可在逐镜审查中播放</span></div><div className="timeline-track">{shots.map((shot) => <div className={assets[shot.id]?.video?.status === "SUCCEEDED" ? "ready" : ""} key={shot.id}><span>SHOT {shot.order}</span><strong>{shot.title}</strong></div>)}</div><div className="edit-summary"><ShieldCheck size={17} /><span>{shots.length} 个镜头 · {reviewedCount} 个已人工通过 · TokenWorld 视频任务</span></div></section></div>; }
