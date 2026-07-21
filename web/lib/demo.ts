import type { Job, ModeSpec, ModelsResponse, ParamSpec } from "./types";

/**
 * Demo mode makes the deployed site fully interactive with NO backend wired up.
 * Jobs are *stateless*: the job id encodes everything needed to reconstruct
 * progress from the current time, so it survives Vercel's ephemeral instances.
 *
 * The demo catalog mirrors BOTH backend families (V2 + V3) so every capability
 * is browsable offline. A real backend returns only its own family's modes.
 */

const DEMO_PREFIX = "demo_";

interface DemoState {
  t: number; // created-at (ms)
  d: number; // estimated duration (ms)
  s: number; // seed
  p: string; // prompt (truncated)
  m: string; // mode id
  r: string; // resolution
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
  frames: number;
  seed?: number | null;
}): Job {
  const seed = params.seed ?? Math.floor(Math.random() * 4294967294);
  const duration = Math.min(16000, Math.max(6000, 4000 + params.frames * 45));
  const state: DemoState = {
    t: Date.now(),
    d: duration,
    s: seed,
    p: params.prompt.slice(0, 120),
    m: params.mode,
    r: params.resolution,
  };
  return demoJobFromState(DEMO_PREFIX + b64urlEncode(state), state);
}

const STAGES: { until: number; status: Job["status"]; stage: string }[] = [
  { until: 0.08, status: "queued", stage: "Queued" },
  { until: 0.22, status: "loading", stage: "Loading model weights" },
  { until: 0.86, status: "generating", stage: "Diffusing frames" },
  { until: 1.0, status: "encoding", stage: "Encoding video" },
];

function demoJobFromState(id: string, st: DemoState): Job {
  const elapsed = Date.now() - st.t;
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
    has_video: false,
    video_url: null,
    created_at: st.t / 1000,
    started_at: st.t / 1000,
    finished_at: done ? (st.t + st.d) / 1000 : null,
    elapsed_seconds: Math.round(Math.min(elapsed, st.d) / 100) / 10,
    params: { mode: st.m, resolution: st.r },
    demo: true,
  };
}

export function getDemoJob(id: string): Job | null {
  const st = b64urlDecode(id.slice(DEMO_PREFIX.length));
  return st ? demoJobFromState(id, st) : null;
}

/* ---------------------------------------------------------- demo catalog */

// Reusable V2 parameter blocks.
const P_STEPS: ParamSpec = { key: "inference_steps", label: "Inference steps", kind: "int", min: 10, max: 50, step: 1, default: 30 };
const P_GUIDANCE: ParamSpec = { key: "guidance_scale", label: "Guidance scale", kind: "float", min: 1, max: 12, step: 0.5, default: 6 };
const P_SHIFT: ParamSpec = { key: "shift", label: "Flow shift", kind: "float", min: 1, max: 16, step: 0.5, default: 8, advanced: true };
const P_FPS: ParamSpec = { key: "fps", label: "Frame rate", kind: "int", min: 8, max: 30, step: 1, default: 24, advanced: true, unit: " fps" };
const P_TEACACHE: ParamSpec = { key: "teacache", label: "TeaCache", kind: "bool", default: false, advanced: true, hint: "Cache attention for faster sampling" };
const P_OFFLOAD: ParamSpec = { key: "offload", label: "CPU offload", kind: "bool", default: false, advanced: true, hint: "Lower VRAM, slower generation" };
const P_LOWVRAM: ParamSpec = { key: "low_vram", label: "Low-VRAM (FP8)", kind: "bool", default: false, advanced: true, hint: "FP8 quantization + block offload for <24GB GPUs" };

const V2_MODES: ModeSpec[] = [
  {
    id: "t2v", label: "Text to Video", family: "v2", badge: "T2V",
    blurb: "Generate video straight from a text prompt.",
    models: [
      { id: "Skywork/SkyReels-V2-T2V-14B-540P", params: "14B", resolution: "540P" },
      { id: "Skywork/SkyReels-V2-T2V-14B-720P", params: "14B", resolution: "720P" },
    ],
    resolutions: ["540P", "720P"],
    prompt_required: true,
    inputs: [],
    params: [
      { key: "num_frames", label: "Duration", kind: "frames", min: 17, max: 121, step: 4, default: 97 },
      P_STEPS, P_GUIDANCE, P_SHIFT, P_FPS,
      { key: "prompt_enhancer", label: "Prompt enhancer", kind: "bool", default: false, advanced: true, hint: "Expand the prompt with an LLM (T2V only)" },
      P_TEACACHE, P_OFFLOAD,
    ],
  },
  {
    id: "i2v", label: "Image to Video", family: "v2", badge: "I2V",
    blurb: "Animate a source image, guided by a text prompt.",
    models: [
      { id: "Skywork/SkyReels-V2-I2V-1.3B-540P", params: "1.3B", resolution: "540P" },
      { id: "Skywork/SkyReels-V2-I2V-14B-540P", params: "14B", resolution: "540P" },
      { id: "Skywork/SkyReels-V2-I2V-14B-720P", params: "14B", resolution: "720P" },
    ],
    resolutions: ["540P", "720P"],
    prompt_required: true,
    inputs: [{ kind: "image", field: "image", label: "Source image", required: true, allow_url: true, accept: "image/*" }],
    params: [
      { key: "num_frames", label: "Duration", kind: "frames", min: 17, max: 121, step: 4, default: 97 },
      P_STEPS, P_GUIDANCE, P_SHIFT, P_FPS, P_TEACACHE, P_OFFLOAD,
    ],
  },
  {
    id: "df", label: "Diffusion Forcing", family: "v2", badge: "DF",
    blurb: "Long-form / infinite video with optional start and end frame control.",
    models: [
      { id: "Skywork/SkyReels-V2-DF-1.3B-540P", params: "1.3B", resolution: "540P" },
      { id: "Skywork/SkyReels-V2-DF-14B-540P", params: "14B", resolution: "540P" },
      { id: "Skywork/SkyReels-V2-DF-14B-720P", params: "14B", resolution: "720P" },
    ],
    resolutions: ["540P", "720P"],
    prompt_required: true,
    inputs: [
      { kind: "image", field: "image", label: "Start frame (optional)", allow_url: true, accept: "image/*" },
      { kind: "image", field: "end_image", label: "End frame (optional)", allow_url: true, accept: "image/*" },
    ],
    params: [
      { key: "num_frames", label: "Duration", kind: "frames", min: 17, max: 257, step: 4, default: 97 },
      P_STEPS, P_GUIDANCE, P_SHIFT, P_FPS,
      { key: "ar_step", label: "AR step", kind: "int", min: 0, max: 12, step: 1, default: 0, advanced: true, hint: "Asynchronous denoising for smoother long takes" },
      { key: "addnoise_condition", label: "Noise conditioning", kind: "int", min: 0, max: 40, step: 1, default: 0, advanced: true, hint: "~20 aids long-video consistency" },
      { key: "causal_attention", label: "Causal attention", kind: "bool", default: false, advanced: true, hint: "Enable AR attention blocks" },
      P_TEACACHE, P_OFFLOAD,
    ],
  },
];

const V3_MODES: ModeSpec[] = [
  {
    id: "reference_to_video", label: "Reference → Video", family: "v3", badge: "R2V",
    blurb: "Generate a video from 1–4 reference images and a text prompt. Strong identity fidelity for characters, objects, and backgrounds.",
    models: [{ id: "Skywork/SkyReels-V3-Reference2Video", params: "14B", resolution: "720P" }],
    resolutions: ["480P", "540P", "720P"],
    prompt_required: true,
    inputs: [{ kind: "ref_images", field: "ref_imgs", label: "Reference images", min: 1, max: 4, required: true, allow_url: true, accept: "image/*" }],
    params: [{ key: "duration", label: "Duration", kind: "seconds", min: 3, max: 10, step: 1, default: 5 }, P_OFFLOAD, P_LOWVRAM],
  },
  {
    id: "single_shot_extension", label: "Video Extension", family: "v3", badge: "V2V",
    blurb: "Extend an existing clip into a longer, continuous single shot (5–30s).",
    models: [{ id: "Skywork/SkyReels-V3-Video-Extension", params: "14B", resolution: "720P" }],
    resolutions: ["480P", "540P", "720P"],
    prompt_required: false,
    inputs: [{ kind: "video", field: "input_video", label: "Input video", required: true, allow_url: true, accept: "video/*" }],
    params: [{ key: "duration", label: "Target duration", kind: "seconds", min: 5, max: 30, step: 1, default: 10 }, P_OFFLOAD, P_LOWVRAM],
  },
  {
    id: "shot_switching_extension", label: "Shot Switching", family: "v3", badge: "CUT",
    blurb: "Extend a clip with a cinematic shot transition. Prefix the prompt with a cut tag.",
    models: [{ id: "Skywork/SkyReels-V3-Video-Extension", params: "14B", resolution: "720P" }],
    resolutions: ["480P", "540P", "720P"],
    prompt_required: false,
    inputs: [{ kind: "video", field: "input_video", label: "Input video", required: true, allow_url: true, accept: "video/*" }],
    params: [{ key: "duration", label: "Duration", kind: "seconds", min: 1, max: 5, step: 1, default: 5 }, P_OFFLOAD, P_LOWVRAM],
    prompt_tags: ["[ZOOM_IN_CUT]", "[ZOOM_OUT_CUT]", "[PUSH_IN_CUT]", "[PULL_OUT_CUT]", "[PAN_LEFT_CUT]", "[PAN_RIGHT_CUT]"],
  },
  {
    id: "talking_avatar", label: "Talking Avatar", family: "v3", badge: "A2V",
    blurb: "Animate a portrait image with a driving audio track (up to 200s). Works with real people, anime, and stylized characters.",
    models: [{ id: "Skywork/SkyReels-V3-TalkingAvatar", params: "19B", resolution: "720P" }],
    resolutions: ["480P", "540P", "720P"],
    prompt_required: false,
    inputs: [
      { kind: "image", field: "input_image", label: "Portrait image", required: true, allow_url: true, accept: "image/*" },
      { kind: "audio", field: "input_audio", label: "Voice audio", required: true, allow_url: true, accept: "audio/*" },
    ],
    params: [P_OFFLOAD, P_LOWVRAM],
  },
];

export const DEMO_MODELS: ModelsResponse = {
  label: "SkyReels V2 + V3",
  modes: [...V2_MODES, ...V3_MODES],
  resolutions: ["480P", "540P", "720P"],
  demo: true,
};
