import type { Job, ModelsResponse } from "./types";

/**
 * Demo mode makes the deployed site fully interactive with NO backend wired up.
 *
 * The catch on Vercel is that serverless instances don't share memory, so a job
 * created by one request may be polled from a different instance. We sidestep
 * that by making demo jobs *stateless*: the job id itself encodes everything
 * needed to reconstruct progress from the current time. Any instance can decode
 * it. No database, no shared state.
 */

const DEMO_PREFIX = "demo_";

interface DemoState {
  t: number; // created-at (ms)
  d: number; // estimated duration (ms)
  s: number; // seed
  p: string; // prompt (truncated)
  m: string; // mode
  r: string; // resolution
  f: number; // num_frames
}

function b64urlEncode(obj: unknown): string {
  const json = JSON.stringify(obj);
  const b64 =
    typeof Buffer !== "undefined"
      ? Buffer.from(json, "utf-8").toString("base64")
      : btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): DemoState | null {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const json =
      typeof Buffer !== "undefined"
        ? Buffer.from(b64, "base64").toString("utf-8")
        : decodeURIComponent(escape(atob(b64)));
    return JSON.parse(json) as DemoState;
  } catch {
    return null;
  }
}

export function isDemoId(id: string): boolean {
  return id.startsWith(DEMO_PREFIX);
}

export function createDemoJob(params: {
  prompt: string;
  mode: string;
  resolution: string;
  num_frames: number;
  seed?: number | null;
}): Job {
  const seed =
    params.seed ?? Math.floor(Math.random() * 4294967294);
  // Keep the demo snappy but believable: scale loosely with frames.
  const duration = Math.min(
    16000,
    Math.max(6000, 4000 + params.num_frames * 55)
  );
  const state: DemoState = {
    t: Date.now(),
    d: duration,
    s: seed,
    p: params.prompt.slice(0, 120),
    m: params.mode,
    r: params.resolution,
    f: params.num_frames,
  };
  const id = DEMO_PREFIX + b64urlEncode(state);
  return demoJobFromState(id, state);
}

const STAGES: { until: number; status: Job["status"]; stage: string }[] = [
  { until: 0.08, status: "queued", stage: "Queued" },
  { until: 0.22, status: "loading", stage: "Loading model weights" },
  { until: 0.86, status: "generating", stage: "Diffusing frames" },
  { until: 1.0, status: "encoding", stage: "Encoding video" },
];

function demoJobFromState(id: string, st: DemoState): Job {
  const now = Date.now();
  const elapsed = now - st.t;
  const frac = Math.max(0, Math.min(1, elapsed / st.d));

  let status: Job["status"] = "generating";
  let stage = "Diffusing frames";
  if (frac >= 1) {
    status = "completed";
    stage = "Completed";
  } else {
    for (const s of STAGES) {
      if (frac <= s.until) {
        status = s.status;
        stage = s.stage;
        break;
      }
    }
  }

  const done = frac >= 1;
  return {
    id,
    status,
    progress: done ? 1 : frac,
    stage,
    seed: st.s,
    resolved_prompt: st.p,
    has_video: false, // demo mode has no real mp4 — the UI renders a synthetic preview
    video_url: null,
    created_at: st.t / 1000,
    started_at: st.t / 1000,
    finished_at: done ? (st.t + st.d) / 1000 : null,
    elapsed_seconds: Math.round(Math.min(elapsed, st.d) / 100) / 10,
    params: {
      mode: st.m,
      resolution: st.r,
      num_frames: st.f,
      has_image: false,
      has_end_image: false,
    },
    demo: true,
  };
}

export function getDemoJob(id: string): Job | null {
  const raw = id.slice(DEMO_PREFIX.length);
  const st = b64urlDecode(raw);
  if (!st) return null;
  return demoJobFromState(id, st);
}

export const DEMO_MODELS: ModelsResponse = {
  models: [
    { id: "Skywork/SkyReels-V2-T2V-14B-540P", mode: "t2v", params: "14B", resolution: "540P" },
    { id: "Skywork/SkyReels-V2-T2V-14B-720P", mode: "t2v", params: "14B", resolution: "720P" },
    { id: "Skywork/SkyReels-V2-I2V-1.3B-540P", mode: "i2v", params: "1.3B", resolution: "540P" },
    { id: "Skywork/SkyReels-V2-I2V-14B-540P", mode: "i2v", params: "14B", resolution: "540P" },
    { id: "Skywork/SkyReels-V2-I2V-14B-720P", mode: "i2v", params: "14B", resolution: "720P" },
    { id: "Skywork/SkyReels-V2-DF-1.3B-540P", mode: "df", params: "1.3B", resolution: "540P" },
    { id: "Skywork/SkyReels-V2-DF-14B-540P", mode: "df", params: "14B", resolution: "540P" },
    { id: "Skywork/SkyReels-V2-DF-14B-720P", mode: "df", params: "14B", resolution: "720P" },
  ],
  modes: [
    { id: "t2v", label: "Text to Video" },
    { id: "i2v", label: "Image to Video" },
    { id: "df", label: "Diffusion Forcing" },
  ],
  resolutions: ["540P", "720P"],
  demo: true,
};
