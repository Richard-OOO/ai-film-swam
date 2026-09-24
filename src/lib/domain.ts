export type TaskStatus = "READY" | "RUNNING" | "SUCCEEDED" | "BLOCKED";

export type Agent = {
  id: string;
  name: string;
  capability: string;
  status: "idle" | "working" | "waiting";
  taskId?: string;
};

export type SwarmTask = {
  id: string;
  type: "EXTRACT_CHUNK" | "RECHECK_EVIDENCE";
  title: string;
  capability: string;
  status: TaskStatus;
  agentId?: string;
};

export type TraceEvent = {
  id: string;
  type: "TASK_CREATED" | "TASK_STARTED" | "TASK_COMPLETED" | "AGENT_MESSAGE" | "STATE_PROPOSED" | "HUMAN_APPROVED" | "ASSET_GENERATED";
  actor: string;
  message: string;
  timestamp: string;
  stage?: PlanningStage;
  durationMs?: number;
  artifact?: PlanningArtifact;
};

export type PlanningStage = "story" | "visual_beats" | "cinematography" | "shot_draft" | "continuity" | "shot_revision";

export type PlanningProgress = {
  stage: PlanningStage;
  status: "STARTED" | "COMPLETED";
  actor: string;
  message: string;
  durationMs?: number;
  artifact?: PlanningArtifact;
};

export type PlanningArtifact =
  | {
      kind: "story";
      logline: string;
      characters: Array<{ name: string; role: string; evidence: string }>;
      visualMoment: string;
    }
  | {
      kind: "visual_beats";
      recommendedShotCount: number;
      rationale: string;
      beats: Array<{
        id: string;
        source: { paragraph: number; quote: string };
        action: string;
        visualGoal: string;
      }>;
    }
  | {
      kind: "cinematography";
      summary: string;
      proposals: Array<{
        beatId: string;
        shotType: ShotType;
        durationSeconds: number;
        camera: string;
        frameStrategy: FrameStrategy;
        reason: string;
      }>;
    }
  | { kind: "shot_draft"; shots: ShotProposal[] }
  | { kind: "continuity"; round: number; summary: string; issues: ContinuityIssue[] }
  | {
      kind: "shot_revision";
      round: number;
      summary: string;
      replies: Array<{ issueId: string; decision: "accepted" | "declined"; reason: string }>;
      shots: ShotProposal[];
    };

export type StoryProposal = {
  logline: string;
  characters: Array<{ name: string; role: string; evidence: string }>;
  shots: ShotProposal[];
  needsReview: boolean;
};

export type ShotProposal = {
  id: string;
  order: number;
  title: string;
  action: string;
  camera: string;
  source: {
    paragraph: number;
    quote: string;
  };
  adaptation: {
    addedVisualDetails: string[];
    changesStoryFact: boolean;
    conflict?: string;
  };
  startFramePrompt: string;
  endFramePrompt: string;
  videoPrompt: string;
  shotType: ShotType;
  durationSeconds: number;
  frameStrategy: FrameStrategy;
  continuityReason?: string;
  inheritPreviousEndFrame?: boolean;
};

export type ShotType = "LONG_TAKE" | "SHORT_SHOT" | "JUMP_CUT";
export type FrameStrategy = "CONTINUOUS_KEYFRAMES" | "SINGLE_FRAME" | "INTENTIONAL_CUT";

export type MediaBranchStatus = "IDLE" | "RUNNING" | "READY" | "FAILED";

export type MediaSwarmExchange = {
  id: string;
  branch: "character" | "scene";
  from: string;
  to: string;
  content: string;
  createdAt: string;
};

export type CharacterDesign = {
  characterId: string;
  name: string;
  prompt: string;
  imageUrl?: string;
};

export type SceneDesign = {
  sceneId: string;
  shotId: string;
  name: string;
  prompt: string;
  frameStrategyRecommendation: FrameStrategy;
  continuityReason: string;
  imageUrl?: string;
};

export type MediaPreproductionState = {
  characterStatus: MediaBranchStatus;
  sceneStatus: MediaBranchStatus;
  characters: CharacterDesign[];
  scenes: SceneDesign[];
  exchanges: MediaSwarmExchange[];
  approved: boolean;
  characterError?: string;
  sceneError?: string;
};

export type MediaPreproductionEvent =
  | { type: "BRANCH_STARTED"; branch: "character" | "scene" }
  | { type: "MESSAGE"; exchange: MediaSwarmExchange }
  | { type: "CHARACTERS_READY"; designs: CharacterDesign[] }
  | { type: "SCENES_READY"; designs: SceneDesign[] }
  | { type: "BRANCH_FAILED"; branch: "character" | "scene"; error: string }
  | { type: "COMPLETE" };

export type ContinuityIssue = {
  id: string;
  shotId: string;
  dimension: "character" | "wardrobe" | "space" | "lighting" | "action";
  observation: string;
  suggestion: string;
};

export type CreativeExchange = {
  from: string;
  to: string;
  type: "PROPOSAL" | "CONTINUITY_REVIEW" | "REVISION_RESPONSE";
  content: string;
};

export type StartRunResponse = {
  projectId: string;
  title: string;
  agents: Agent[];
  tasks: SwarmTask[];
  trace: TraceEvent[];
  proposal: StoryProposal;
};

export type PlanningStreamEvent =
  | { type: "INIT"; run: StartRunResponse }
  | { type: "TRACE"; event: TraceEvent; activeAgentId?: string }
  | { type: "HEARTBEAT"; stage?: PlanningStage; elapsedMs: number }
  | { type: "COMPLETE"; run: StartRunResponse; timings: Partial<Record<PlanningStage, number>> }
  | { type: "ERROR"; error: string };

export type ImageGenerationResponse = { imageUrl: string; requestId?: string };

export type ImageJobStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";

export type ImageJob = {
  id: string;
  batchId: string;
  shotId: string;
  frame: "start" | "end";
  prompt: string;
  status: ImageJobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  workerId?: string;
  imageUrl?: string;
  requestId?: string;
  error?: string;
};

export type SwarmMessage = {
  id: string;
  jobId: string;
  batchId: string;
  from: string;
  to: string;
  type: "TASK_OFFERED" | "TASK_CLAIMED" | "PEER_WAIT" | "PAIR_READY" | "TASK_FAILED";
  shotId: string;
  content: string;
  createdAt: string;
};

export type VideoGenerationResponse = {
  id: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  videoUrl?: string;
  error?: string;
  provider: "tokenworld";
};
