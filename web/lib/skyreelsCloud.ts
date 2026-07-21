/**
 * Adapter for the hosted SkyReels Cloud API (https://api-gateway.skyreels.ai).
 *
 * The studio speaks its own generic contract; SkyReels Cloud has per-mode
 * submit/poll endpoints, takes the API key in the JSON body, and returns media
 * as URLs. This module translates between the two so the same UI drives the
 * hosted API with no GPU.
 *
 * Enabled when SKYREELS_API_URL points at *.skyreels.ai (or SKYREELS_PROVIDER
 * === "skyreels-cloud"). The API key comes from SKYREELS_API_KEY, server-side.
 */

import type { Job, ModeSpec, ModelsResponse, ParamSpec } from "./types";
import { getBackendUrl } from "./backend";

export function isCloud(): boolean {
  if ((process.env.SKYREELS_PROVIDER || "").toLowerCase() === "skyreels-cloud") return true;
  const url = getBackendUrl();
  if (!url) return false;
  try {
    return new URL(url).hostname.toLowerCase().endsWith("skyreels.ai");
  } catch {
    return false;
  }
}

function cloudBase(): string {
  return getBackendUrl() || "https://api-gateway.skyreels.ai";
}

function apiKey(): string {
  return (process.env.SKYREELS_API_KEY || "").trim();
}

/** submit + task path fragment per studio mode id. */
const ENDPOINT: Record<string, string> = {
  text2video: "text2video",
  image2video: "image2video",
  multiobject: "multiobject",
  extension: "extension",
  cutshot: "extension/cutshot",
  styletransfer: "styletransfer",
  single_avatar: "audio2video/single",
  retalking: "retalking",
};

/** body fields forwarded to the cloud API per mode (besides api_key). */
// Studio-side field names forwarded to the cloud API per mode. "quality" is
// renamed to the cloud's "mode" field during body construction.
const ALLOWED: Record<string, string[]> = {
  text2video: ["prompt", "duration", "aspect_ratio", "sound", "prompt_optimizer", "resolution", "quality"],
  image2video: ["prompt", "first_frame_image", "end_frame_image", "duration", "sound", "prompt_optimizer", "resolution", "quality"],
  multiobject: ["prompt", "ref_images", "duration", "aspect_ratio"],
  extension: ["prompt", "prefix_video", "duration"],
  cutshot: ["prompt", "prefix_video", "duration", "cut_type"],
  styletransfer: ["video_url", "style_name"],
  single_avatar: ["prompt", "first_frame_image", "audios", "quality"],
  retalking: ["video_url", "audio_url", "reference_char_url"],
};

function httpsUpgrade(u: string): string {
  return u?.startsWith("http://") ? "https://" + u.slice(7) : u;
}

/* ------------------------------------------------------------- catalog */

const ASPECT = ["16:9", "9:16", "1:1", "4:3", "3:4"];
const RES_V4 = ["480p", "720p", "1080p"];

const P_ASPECT: ParamSpec = { key: "aspect_ratio", label: "Aspect ratio", kind: "select", options: ASPECT, default: "16:9" };
const P_RES: ParamSpec = { key: "resolution", label: "Resolution", kind: "select", options: RES_V4, default: "1080p", advanced: true };
const P_SOUND: ParamSpec = { key: "sound", label: "Sound effects", kind: "bool", default: false, advanced: true, hint: "Generate audio (std mode only)" };
const P_OPT: ParamSpec = { key: "prompt_optimizer", label: "Prompt optimizer", kind: "bool", default: true, advanced: true, hint: "Auto-expand the prompt for higher fidelity" };
// NB: studio-side key is "quality" to avoid colliding with the studio's "mode"
// (task type). The adapter renames quality -> mode for the cloud request.
const P_MODE_V4: ParamSpec = { key: "quality", label: "Quality mode", kind: "select", options: ["std", "fast"], default: "std", advanced: true, hint: "fast = quicker; std = balanced" };

const CLOUD_MODES: ModeSpec[] = [
  {
    id: "text2video", label: "Text to Video", family: "cloud", badge: "T2V·V4",
    blurb: "Generate video from a text prompt. No uploads needed — the fastest way to see real output.",
    models: [{ id: "SkyReels-V4", params: "V4", resolution: "1080p" }],
    resolutions: [], prompt_required: true, inputs: [],
    params: [
      { key: "duration", label: "Duration", kind: "seconds", min: 3, max: 15, step: 1, default: 5 },
      P_ASPECT, P_RES, P_MODE_V4, P_SOUND, P_OPT,
    ],
  },
  {
    id: "image2video", label: "Image to Video", family: "cloud", badge: "I2V·V4",
    blurb: "Animate from a first frame (and optional end frame) image URL.",
    models: [{ id: "SkyReels-V4", params: "V4", resolution: "1080p" }],
    resolutions: [], prompt_required: true,
    inputs: [
      { kind: "image", field: "first_frame_image", label: "First frame (image URL)", required: true, allow_url: true, url_only: true, accept: "image/*" },
      { kind: "image", field: "end_frame_image", label: "End frame URL (optional)", allow_url: true, url_only: true, accept: "image/*" },
    ],
    params: [
      { key: "duration", label: "Duration", kind: "seconds", min: 3, max: 15, step: 1, default: 5 },
      P_RES, P_MODE_V4, P_SOUND, P_OPT,
    ],
  },
  {
    id: "multiobject", label: "Reference → Video", family: "cloud", badge: "R2V·V3",
    blurb: "Generate from 1–4 subject reference image URLs and a prompt.",
    models: [{ id: "SkyReels-V3", params: "V3", resolution: "720p" }],
    resolutions: [], prompt_required: true,
    inputs: [
      { kind: "ref_images", field: "ref_images", label: "Reference image URLs", min: 1, max: 4, required: true, allow_url: true, url_only: true, accept: "image/*" },
    ],
    params: [
      { key: "duration", label: "Duration", kind: "seconds", min: 1, max: 5, step: 1, default: 5 },
      P_ASPECT,
    ],
  },
  {
    id: "extension", label: "Video Extension", family: "cloud", badge: "V2V·V3",
    blurb: "Extend a clip (by URL) into a longer single shot, 5–30s.",
    models: [{ id: "SkyReels-V3", params: "V3", resolution: "720p" }],
    resolutions: [], prompt_required: true,
    inputs: [{ kind: "video", field: "prefix_video", label: "Video to extend (mp4 URL)", required: true, allow_url: true, url_only: true, accept: "video/*" }],
    params: [{ key: "duration", label: "Target duration", kind: "seconds", min: 5, max: 30, step: 1, default: 10 }],
  },
  {
    id: "cutshot", label: "Shot Switching", family: "cloud", badge: "CUT·V3",
    blurb: "Extend a clip with a cinematic shot transition.",
    models: [{ id: "SkyReels-V3", params: "V3", resolution: "720p" }],
    resolutions: [], prompt_required: true,
    inputs: [{ kind: "video", field: "prefix_video", label: "Video to extend (mp4 URL)", required: true, allow_url: true, url_only: true, accept: "video/*" }],
    params: [
      { key: "duration", label: "Duration", kind: "seconds", min: 2, max: 5, step: 1, default: 5 },
      { key: "cut_type", label: "Cut type", kind: "select", options: ["Auto", "Cut-In", "Cut-Out", "Shot/Reverse Shot", "Multi-Angle", "Cut Away"], default: "Auto" },
    ],
  },
  {
    id: "styletransfer", label: "Video Restyling", family: "cloud", badge: "STYLE·V3",
    blurb: "Restyle a clip (by URL, ≤30s) into a new visual style.",
    models: [{ id: "SkyReels-V3", params: "V3", resolution: "720p" }],
    resolutions: [], prompt_required: false,
    inputs: [{ kind: "video", field: "video_url", label: "Source video (mp4 URL)", required: true, allow_url: true, url_only: true, accept: "video/*" }],
    params: [
      { key: "style_name", label: "Style", kind: "select", options: ["simpsons", "lego", "paper_cutting", "amigurumi", "animal_crossing", "van_gogh", "pixel_art"], default: "simpsons" },
    ],
  },
  {
    id: "single_avatar", label: "Talking Avatar", family: "cloud", badge: "A2V",
    blurb: "Animate a portrait image (URL) with a voice audio track (URL).",
    models: [{ id: "SkyReels-Avatar", params: "A2V", resolution: "1080p" }],
    resolutions: [], prompt_required: true,
    inputs: [
      { kind: "image", field: "first_frame_image", label: "Portrait image URL", required: true, allow_url: true, url_only: true, accept: "image/*" },
      { kind: "audio", field: "audios", label: "Voice audio URL", required: true, allow_url: true, url_only: true, accept: "audio/*" },
    ],
    params: [{ key: "quality", label: "Quality", kind: "select", options: ["std", "pro"], default: "std", hint: "std = 720p, pro = 1080p" }],
  },
  {
    id: "retalking", label: "Lip-sync", family: "cloud", badge: "LIP",
    blurb: "Re-sync a video's lips to a new audio track (both by URL).",
    models: [{ id: "SkyReels-Retalking", params: "LIP", resolution: "720p" }],
    resolutions: [], prompt_required: false,
    inputs: [
      { kind: "video", field: "video_url", label: "Source video (URL)", required: true, allow_url: true, url_only: true, accept: "video/*" },
      { kind: "audio", field: "audio_url", label: "New audio (URL)", required: true, allow_url: true, url_only: true, accept: "audio/*" },
    ],
    params: [],
  },
];

export const CLOUD_CATALOG: ModelsResponse = {
  family: "cloud",
  label: "SkyReels Cloud (V3 + V4)",
  modes: CLOUD_MODES,
  resolutions: RES_V4,
};

/* ------------------------------------------------------------- helpers */

function mapStatus(cloud: string): Job["status"] {
  switch (cloud) {
    case "success": return "completed";
    case "failed": return "failed";
    case "running": return "generating";
    case "pending": return "loading";
    default: return "queued"; // submitted / unknown
  }
}

async function cloudFetch(path: string, init: RequestInit, timeoutMs = 30_000): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${cloudBase()}${path}`, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(t);
  }
}

const ERR: Record<number, string> = {
  401: "Invalid API key — check SKYREELS_API_KEY.",
  422: "Parameter error — check the inputs.",
  429: "SkyReels service is busy. Try again shortly.",
  480: "Insufficient account credits. Recharge at platform.skyreels.ai/pricing.",
  481: "Rate/concurrency limit exceeded. Try again shortly.",
  482: "Content blocked by the platform's safety policy.",
  500: "SkyReels internal error. Try again shortly.",
};

/* ------------------------------------------------------------- generate */

export interface CloudResult {
  ok: boolean;
  status: number;
  body: unknown;
}

export async function cloudGenerate(input: Record<string, unknown>): Promise<CloudResult> {
  const mode = String(input.mode || "");
  const ep = ENDPOINT[mode];
  if (!ep) return { ok: false, status: 422, body: { error: `Unsupported mode: ${mode}` } };
  if (!apiKey()) return { ok: false, status: 401, body: { error: "No SKYREELS_API_KEY configured on the server." } };

  const body: Record<string, unknown> = { api_key: apiKey() };
  for (const k of ALLOWED[mode]) {
    const v = input[k];
    if (v === undefined || v === null || v === "") continue;
    body[k] = v;
  }
  // Rename the studio's "quality" back to the cloud API's "mode" field.
  if (body.quality !== undefined) {
    body.mode = body.quality;
    delete body.quality;
  }
  if (mode === "single_avatar" && typeof body.audios === "string") body.audios = [body.audios];

  let res: Response;
  try {
    res = await cloudFetch(`/api/v1/video/${ep}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, status: 502, body: { error: e instanceof Error ? e.message : "Network error reaching SkyReels." } };
  }

  let data: Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {
    /* ignore */
  }

  const code = Number(data.code);
  const failed = !res.ok || (Number.isFinite(code) && code !== 200);
  if (failed) {
    const msg = ERR[res.status] || ERR[code] ||
      (typeof data.msg === "string" ? data.msg : null) ||
      (Array.isArray(data.detail) ? `Parameter error: ${(data.detail[0] as { msg?: string })?.msg}` : null) ||
      "SkyReels rejected the request.";
    return { ok: false, status: res.status === 200 ? 502 : res.status, body: { error: msg } };
  }

  const taskId = String(data.task_id || "");
  if (!taskId) return { ok: false, status: 502, body: { error: "SkyReels did not return a task id." } };

  const now = Date.now();
  const job: Job = {
    id: `${mode}.${now}.${taskId}`,
    family: "cloud",
    status: "queued",
    progress: 0.03,
    stage: "Submitted to SkyReels",
    seed: null,
    resolved_prompt: typeof input.prompt === "string" ? input.prompt : null,
    has_video: false,
    video_url: null,
    created_at: now / 1000,
    started_at: now / 1000,
    params: { mode },
    demo: false,
  };
  return { ok: true, status: 202, body: job };
}

/* ------------------------------------------------------------- poll */

export async function cloudPoll(id: string): Promise<Job> {
  const [mode, startStr, ...rest] = id.split(".");
  const taskId = rest.join(".");
  const startMs = Number(startStr) || Date.now();
  const ep = ENDPOINT[mode];

  const base: Job = {
    id, family: "cloud", status: "generating", progress: 0.1, stage: "Working",
    has_video: false, video_url: null, created_at: startMs / 1000, started_at: startMs / 1000,
    params: { mode },
  };

  if (!ep) return { ...base, status: "failed", stage: "Failed", error: "Unknown task." };

  let res: Response;
  try {
    res = await cloudFetch(`/api/v1/video/${ep}/task/${encodeURIComponent(taskId)}`, {}, 15_000);
  } catch (e) {
    // transient — report as still running so the client keeps polling
    return { ...base, stage: "Waiting for SkyReels", error: null };
  }

  let data: Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {
    /* ignore */
  }

  if (res.status === 404) {
    return { ...base, status: "failed", stage: "Failed", error: "Task not found." };
  }

  const cloudStatus = String(data.status || "");
  const status = mapStatus(cloudStatus);
  const elapsed = (Date.now() - startMs) / 1000;

  if (status === "completed") {
    const d = (data.data || {}) as Record<string, unknown>;
    const url = httpsUpgrade(String(d.video_url || ""));
    return {
      ...base,
      status: "completed",
      stage: "Completed",
      progress: 1,
      has_video: !!url,
      video_url: url || null,
      finished_at: Date.now() / 1000,
      elapsed_seconds: Math.round(elapsed * 10) / 10,
      params: {
        mode,
        resolution: d.resolution,
        duration: d.duration,
        cost_credits: d.cost_credits,
      },
    };
  }

  if (status === "failed") {
    return {
      ...base,
      status: "failed",
      stage: "Failed",
      error: (typeof data.msg === "string" && data.msg) || "Generation failed.",
    };
  }

  // in-flight: synthesize a moving progress bar (~90s estimate)
  const prog = status === "queued" ? 0.08 : Math.min(0.92, (elapsed / 90) * 0.92);
  return {
    ...base,
    status,
    stage: status === "queued" ? "Queued at SkyReels" : "Generating",
    progress: Math.max(0.08, prog),
    elapsed_seconds: Math.round(elapsed * 10) / 10,
  };
}
