export type Mode = "t2v" | "i2v" | "df";

export type JobStatus =
  | "queued"
  | "loading"
  | "generating"
  | "encoding"
  | "completed"
  | "failed"
  | "canceled";

export interface ModelInfo {
  id: string;
  mode: Mode;
  params: string;
  resolution: string;
}

export interface ModelsResponse {
  models: ModelInfo[];
  modes: { id: Mode; label: string }[];
  resolutions: string[];
  demo?: boolean;
}

export interface GenerateParams {
  prompt: string;
  mode: Mode;
  model_id?: string | null;
  resolution: string;
  num_frames: number;
  inference_steps: number;
  guidance_scale: number;
  shift: number;
  fps: number;
  seed?: number | null;
  negative_prompt?: string | null;
  prompt_enhancer: boolean;
  offload?: boolean | null;
  teacache: boolean;
  teacache_thresh: number;
  use_ret_steps: boolean;
  image?: string | null;
  end_image?: string | null;
  ar_step: number;
  causal_attention: boolean;
  causal_block_size: number;
  base_num_frames: number;
  overlap_history?: number | null;
  addnoise_condition: number;
}

export interface Job {
  id: string;
  status: JobStatus;
  progress: number;
  stage: string;
  error?: string | null;
  seed?: number | null;
  resolved_prompt?: string | null;
  has_video: boolean;
  video_url?: string | null;
  created_at: number;
  started_at?: number | null;
  finished_at?: number | null;
  elapsed_seconds?: number | null;
  params: Record<string, unknown>;
  demo?: boolean;
}
