# AI Film Swarm

Next.js + TypeScript full-stack MVP scaffold for an observable, human-guided film agent swarm.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Current Slice

- Short-story input
- Real Story Agent to Shot Agent structured handoff
- Bounded creative collaboration: Shot Agent -> Continuity Agent -> Shot Agent
- One continuity-review round, with every exchange visible in Trace
- Live NDJSON planning stream with per-stage start, completion, heartbeat, and duration updates
- Immutable-style execution Trace in the UI
- Pause/resume control
- Human Story Review gate after collaboration, with an editable proposal
- Exactly three connected Shots from the Shot Agent
- Editable start-frame, end-frame, and video prompts for every Shot
- One-click frame generation followed by a deterministic Mock Video backend
- Redis shared image-task pool with two competing Frame Workers
- Structured Worker messages recorded in the visible Trace
- Typed server API and shared domain contracts

## Model setup

```bash
copy .env.example .env.local
```

Set `DASHSCOPE_API_KEY` in `.env.local`. The current vertical slice uses:

- `qwen3.7-flash-2026-07-15` for structured story and three-shot planning
- `qwen-image-3.0` for editable start and end frames
- Local Mock Video route for the video handoff; it makes no external video request

The real video-model adapter, SQLite persistence, SSE streaming, and final composition remain intentionally deferred until this three-shot loop is validated.

## Start the MVP

Keep Redis running on `127.0.0.1:6379`, then use two PowerShell windows:

```powershell
cd D:\evo\film
npm run worker
```

```powershell
cd D:\evo\film
npm run dev
```
