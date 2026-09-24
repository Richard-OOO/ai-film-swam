# AI Film Swarm Hackathon MVP 需求文档

## 1. 文档信息

- 项目名称：AI Film Swarm
- 产品定位：将短篇小说或小说短章节自动改编为 30-60 秒短电影的 AI Agent Swarm
- 开发周期：24-48 小时
- 核心演示：Agent 通过共享状态和任务池协作，人可以查看完整 Trace、实时干预，并在生成后逐镜审片和修改 Prompt
- 技术原则：先跑通、再验证；不同时扩展多个不确定能力

## 2. 产品目标

用户输入一段短篇小说或选定章节，系统完成：

1. 多个 Reader Agent 并行提取故事信息。
2. Story Integrator 合并信息，并在证据不足时向 Reader 发起一次定向回查。
3. 人工确认故事事实、人物关系和改编方向。
4. Agent 生成场景、镜头、视觉参考和 Prompt。
5. Media Agent 并行生成关键帧与视频。
6. 人工逐镜审片、修改 Prompt、重新生成或批准。
7. 系统使用 FFmpeg 合成为最终短片。

核心卖点：

> An observable and controllable AI film crew that turns a short story into a movie.

## 3. MVP 范围

### 3.1 输入约束

- 支持粘贴纯文本或上传 `.txt`。
- 建议中文或英文短篇，最多约 10,000 字。
- 输入按自然段或短章节拆分为 2-6 个 Chunk。
- 每次只处理一个项目。

### 3.2 输出约束

- 生成 2-3 个 Scene。
- 生成 4-6 个 Shot。
- 每个 Shot 约 4-8 秒。
- 最终影片约 30-60 秒。
- 允许失败 Shot 降级为静帧加运镜效果。

### 3.3 不在 MVP 范围

- 不支持整部长篇小说。
- 不做自动 Critic Agent。
- 不做无限 Investigator 循环。
- 不做多视频模型自动路由。
- 不做复杂 RAG 或向量数据库。
- 不做自动配音、音乐生成和口型同步。
- 不做多人协作、权限系统、分布式队列或生产级容错。
- 不让多个 Agent 同时改写整部故事。

## 4. 用户与核心流程

目标用户是 Hackathon 评委或创作者。核心流程如下：

```text
创建项目
  -> 输入短篇文本
  -> Reader Swarm 并行分析
  -> Integrator 合并/请求定向回查
  -> 人工确认故事状态
  -> 生成改编方案与 Shot Plan
  -> 人工修改并批准 Prompt
  -> Media Swarm 并行生成
  -> 人工逐镜审片和修复
  -> FFmpeg 合成
  -> 预览/下载短片
```

## 5. Agent 架构

MVP 使用 5 类 Agent。Scheduler 和 Editor 是普通代码，不包装成 Agent。

### 5.1 Reader Agent Pool

- 实例数：2-4 个同类 Worker。
- 并行领取 `EXTRACT_CHUNK` 任务。
- 提取人物、地点、事件、关系、时间和重要描写。
- 每条 Claim 必须附原文引用和段落位置。
- 可领取 Integrator 创建的 `RECHECK_EVIDENCE` 任务。

### 5.2 Story Integrator

- 实例数：1。
- 合并实体别名、事件、人物关系和基础时间顺序。
- 区分原文事实、推断、冲突和未知信息。
- 证据不足时最多创建一轮、最多 3 个回查任务。
- 不得把弱推断直接写成原著事实。

### 5.3 Adaptation Agent

- 实例数：1。
- 将确认后的 Story State 压缩为 2-3 个 Scene。
- 决定保留、合并或删除哪些情节。
- 生成 4-6 个 Shot 的叙事骨架。
- 所有偏离原著的内容记录为 Film Decision。

### 5.4 Visual and Shot Agent

- 实例数：1。
- 生成最小 Visual Bible：主角、主要服装、核心地点和整体风格。
- 将 Scene 转换为完整 Shot Spec。
- 为参考图、关键帧和视频生成可人工编辑的 Prompt。
- 必须引用已确认的 Story State 和 Visual Bible，不得自行修改事实。

### 5.5 Media Agent Pool

- 实例数：2-4 个同类 Worker。
- 领取参考图、关键帧、视频和重生成任务。
- MVP 只连接一个图片模型和一个视频模型。
- 每次调用保存输入、输出、耗时、错误和资产版本。

## 6. Agent 协作规则

Agent 不进行无约束自由聊天，只交换可验证的结构化消息。

```json
{
  "id": "msg_001",
  "from": "story_integrator",
  "toCapability": "reader",
  "type": "RECHECK_EVIDENCE",
  "targetRef": "entity_john",
  "question": "John 是否与 Alice 的弟弟为同一人？",
  "evidenceRefs": ["chunk_1:p4", "chunk_3:p2"],
  "createdAt": "2026-09-22T10:00:00Z"
}
```

满足以下条件时才称为 Swarm：

- 多个同类 Worker 从共享 Task Pool 自主领取任务。
- Agent 可以根据发现创建新任务。
- Agent 通过共享状态和结构化消息协作。
- Scheduler 只控制依赖、并发和失败重试，不做创作决策。

Reader Pool 和 Media Pool 是 Swarm；Integrator、Adaptation、Visual and Shot 是单 Agent。

## 7. Human-in-the-loop

### 7.1 全链路 Trace

系统必须记录并实时显示：

- `TASK_CREATED`
- `TASK_STARTED`
- `AGENT_MESSAGE`
- `STATE_PROPOSED`
- `HUMAN_EDITED`
- `TASK_APPROVED`
- `TASK_REJECTED`
- `ASSET_GENERATED`
- `TASK_FAILED`

Trace 事件只追加、不覆盖，以时间线形式展示 Agent、输入摘要、输出摘要和关联资产。

### 7.2 执行过程干预

用户可以：

- 暂停或恢复新任务调度。
- 查看当前任务、Agent、输入和输出。
- 取消尚未开始的任务。
- 修改 Agent 提议的 Story State、Scene、Shot Spec 或 Prompt。
- 驳回结果并填写修改意见。
- 批准当前阶段，解锁下游任务。

正在调用外部模型的请求不承诺立即中断；暂停只阻止后续任务启动。

### 7.3 人工关卡

必须保留两个 Gate：

1. `STORY_REVIEW`：确认人物、关系、事件、Scene 和 Shot Plan。
2. `VIDEO_REVIEW`：逐 Shot 批准、修改 Prompt 或重新生成。

视频审查支持：

- 播放视频及查看首尾帧。
- 对照 Shot Spec、参考图和当前 Prompt。
- 直接编辑图片 Prompt 或视频 Prompt。
- 选择“重新生成关键帧”或“重新生成视频”。
- 填写自然语言意见，由 Visual and Shot Agent 转换为 Prompt 提案；用户确认后才执行。
- 标记通过并进入最终剪辑。

### 7.4 版本与影响控制

- 人工修改不得覆盖旧记录，必须创建新版本。
- Prompt 示例：`prompt_v1 -> HUMAN_EDITED -> prompt_v2`。
- 上游修改后，相关下游任务标记为 `STALE`。
- 系统只提示受影响内容，不自动重跑全部下游任务。
- 用户选择需要重跑的 Shot，控制时间和 API 成本。

## 8. 功能需求

### FR-1 项目创建与文本拆分

- 用户可创建项目并输入短篇文本。
- 系统显示拆分后的 Chunk，并允许开始分析。

### FR-2 Reader Swarm

- Scheduler 为每个 Chunk 创建 `EXTRACT_CHUNK`。
- 多个 Reader 并行处理。
- 页面实时显示领取、运行和完成状态。
- 每条事实可跳转到对应原文段落。

### FR-3 故事整合与回查

- Integrator 生成合并后的实体、事件和关系。
- 不确定结果显示置信度、证据和状态。
- Integrator 可创建有限的 `RECHECK_EVIDENCE`。
- 回查过程必须出现在 Trace 中。

### FR-4 故事人工审查

- 用户可编辑人物名称、关系、事件摘要和 Scene。
- 用户批准后才创建视觉和媒体任务。
- 所有人工修改记录修改前后值。

### FR-5 Shot Plan 与 Prompt

- 每个 Shot 包含角色、地点、动作、情绪、镜头、时间、起止状态。
- 用户可逐 Shot 编辑 Prompt。
- Shot 必须引用 Visual Bible 中的人物和地点版本。

### FR-6 媒体并行生成

- 先生成并人工确认最小参考图，再解锁关键帧任务。
- 关键帧确定后，可并行生成各 Shot 视频。
- 失败任务允许手动或自动重试一次。

### FR-7 视频人工审查

- 每个 Shot 独立执行通过、编辑、重生成或静帧降级。
- 修改意见和 Prompt 版本进入 Trace。
- 只有通过或降级的 Shot 可以进入剪辑。

### FR-8 最终剪辑

- FFmpeg 按 Shot 顺序拼接。
- 默认使用硬切或短淡入淡出。
- 输出可播放和下载的 MP4。

## 9. Global Film State

MVP 使用 SQLite 保存以下核心数据：

```text
Project
  id, title, status, paused, created_at

SourceChunk
  id, project_id, order, text

Claim
  id, subject, predicate, object,
  kind(asserted|inferred|conflicted|unknown),
  confidence, source_chunk_id, paragraph, quote, version

Entity / Event
  id, canonical_data_json, evidence_refs, version

FilmDecision
  id, decision, reason, source_refs, created_by, version

Scene
  id, order, summary, characters, location, version, approval_status

Shot
  id, scene_id, order, spec_json, continuity_json, version, approval_status

Prompt
  id, target_ref, kind, text, version, created_by

Asset
  id, target_ref, kind, uri, prompt_id, version, status
```

原始模型响应、错误堆栈和调用统计放入 Run/Trace，不作为 Film Truth。

## 10. Task Pool

### 10.1 必要任务类型

- `EXTRACT_CHUNK`
- `RECHECK_EVIDENCE`
- `GENERATE_REFERENCE`
- `GENERATE_KEYFRAME`
- `GENERATE_VIDEO`
- `REGENERATE_KEYFRAME`
- `REGENERATE_VIDEO`
- `COMPOSE_FILM`

Scene 和 Shot 规划是串行阶段，不需要包装为池中任务。

### 10.2 Task Schema

```text
id
project_id
type
target_ref
capability
status: BLOCKED | READY | RUNNING | SUCCEEDED | FAILED | CANCELLED | STALE
depends_on[]
input_refs[]
output_refs[]
priority
attempts
max_attempts
claimed_by
created_by
error
created_at
updated_at
```

MVP 为单机运行，不实现分布式锁。Scheduler 通过 SQLite 事务领取任务。

## 11. 页面需求

单页工作台采用三栏结构：

```text
+----------------+---------------------------+----------------------+
| Agents / Tasks | Trace / Agent Messages    | State / Asset Review |
| 状态与筛选     | 按时间实时追加            | 编辑、预览、批准     |
+----------------+---------------------------+----------------------+
```

需要的视图：

- Input：输入文本和 Chunk 预览。
- Story：人物、关系、事件、Scene 和证据引用。
- Shots：Shot Spec、Prompt 和依赖资产。
- Review：逐镜视频、修改意见、版本和审批。
- Final：最终影片预览与下载。

顶部固定显示项目状态、暂停/恢复按钮、当前阶段和整体进度。

## 12. 技术栈

主项目统一使用 TypeScript：

- Next.js + React + TypeScript：前端与 API。
- Tailwind CSS + shadcn/ui：操作台 UI。
- SQLite + Drizzle ORM：状态、任务和 Trace。
- Zod：Agent 输出、任务和消息校验。
- SSE：向页面实时推送 Trace 和任务状态。
- 模型官方 SDK：文本、图片和视频模型。
- FFmpeg：最终合成和静帧降级。
- 本地文件目录：保存图片、视频和最终成片。
- 轻量 Scheduler：应用进程内轮询 Task Pool。

除非选定模型只有 Python SDK，否则 MVP 不增加 Python 服务、Redis、LangGraph 或微服务。

## 13. 状态与执行顺序

```text
DRAFT
  -> ANALYZING                 Reader 并行
  -> INTEGRATING               Integrator 串行，可触发一次回查
  -> STORY_REVIEW              人工 Gate
  -> PLANNING                  Adaptation + Visual/Shot 串行
  -> GENERATING_REFERENCES     可并行
  -> GENERATING_KEYFRAMES      可按 Shot 并行
  -> GENERATING_VIDEOS         可按 Shot 并行
  -> VIDEO_REVIEW              人工 Gate，可局部重生成
  -> COMPOSING                 FFmpeg 串行
  -> COMPLETED
```

## 14. 最终架构图

```text
 Short Story / Selected Chapters
                 |
                 v
 +-----------------------------------+
 | Reader Agent Pool [SWARM]         |  parallel
 | EXTRACT_CHUNK / RECHECK_EVIDENCE  |
 +-----------------+-----------------+
                   |
                   v
 +-----------------------------------+
 | Story Integrator [AGENT]          |
 | merge + limited evidence request  |
 +-----------------+-----------------+
                   |
                   v
 +-----------------------------------+
 | Story Review [HUMAN GATE]         |
 | inspect Trace + edit + approve    |
 +-----------------+-----------------+
                   |
                   v
 +-----------------------------------+
 | Adaptation Agent [AGENT]          |  serial
 +-----------------+-----------------+
                   |
                   v
 +-----------------------------------+
 | Visual and Shot Agent [AGENT]     |  serial
 +-----------------+-----------------+
                   |
                   v
 +-----------------------------------+
 | Media Agent Pool [SWARM]          |  parallel by asset/shot
 | reference -> keyframe -> video    |
 +-----------------+-----------------+
                   |
                   v
 +-----------------------------------+
 | Video Review [HUMAN GATE]         |
 | approve / edit prompt / regenerate|----+
 +-----------------+-----------------+    |
                   ^                      |
                   +----- repair task ----+
                   |
                   v
 +-----------------------------------+
 | FFmpeg Editor [INFRA/CODE]        |
 +-----------------+-----------------+
                   |
                   v
             Final 30-60s Film

 Shared infrastructure throughout:
 SQLite Global State + Task Pool + immutable Trace + SSE
```

## 15. 验收标准

Demo 通过以下标准即视为 MVP 完成：

1. 输入一篇受约束的短文后，至少两个 Reader 实例并行完成分析。
2. 页面能看到 Task 的创建、领取、Agent 消息和状态变更。
3. 至少演示一次 Integrator 向 Reader 发出定向回查，或使用预设样例稳定触发。
4. 用户能查看原文证据并修改、批准 Story/Shot Plan。
5. 系统生成至少 4 个 Shot 的关键帧或视频。
6. 用户能修改一个 Shot 的 Prompt，并只重新生成该 Shot。
7. 修改历史和新旧资产版本可在 Trace 中查看。
8. 所有通过或降级的 Shot 能合成为一个可播放 MP4。
9. 任一外部视频调用失败时，Demo 可用预生成资产或静帧运镜继续完成。

## 16. 24-48 小时开发顺序

### 第一阶段：跑通最短链路

- 建立数据库 Schema、Task Pool 和 Trace。
- 跑通文本输入 -> Reader -> Integrator -> Shot Plan。
- 使用占位资产跑通 FFmpeg 输出。

### 第二阶段：加入可见的 Swarm

- Reader Worker 并行领取任务。
- 实现结构化 Agent Message 和一次定向回查。
- 用 SSE 实时展示 Trace。

### 第三阶段：加入人工控制

- 实现暂停、编辑、批准和版本记录。
- 实现 Story Review 与 Video Review 两个人工 Gate。
- 实现单 Shot 局部重生成。

### 第四阶段：接入真实媒体模型

- 先接一个图片模型并验证参考图和关键帧。
- 再接一个视频模型，只验证 1 个 Shot。
- 验证稳定后再开放 4-6 个 Shot 并行生成。

每阶段单独验收。媒体模型尚未验证稳定前，不增加多模型、自动 Critic、配音或其他新 Agent。

## 17. Demo 保障

- 准备一篇可稳定产生人物关系回查的短篇样例。
- 提前缓存一套参考图、关键帧和视频作为外部 API 失败时的降级资产。
- 现场实时展示 Reader Swarm、Trace 和一次 Prompt 局部修改。
- 视频生成耗时过长时，切换到已缓存结果，但 Trace 仍按真实任务流程展示。
- 最终重点展示“可观察、可干预、可局部修复”，而不是 Agent 数量。
