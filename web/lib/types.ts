export type ParamKind = "int" | "float" | "frames" | "seconds" | "bool" | "select";
export type InputKind = "image" | "ref_images" | "end_image" | "video" | "audio";

export interface ModelInfo {
  id: string;
  params: string;
  resolution: string;
}

export interface InputSpec {
  kind: InputKind;
  field: string;
  label: string;
  required?: boolean;
  min?: number;
  max?: number;
  allow_url?: boolean;
  url_only?: boolean; // hosted API accepts URLs only (no base64 upload)
  accept?: string;
}

export interface ParamSpec {
  key: string;
  label: string;
  kind: ParamKind;
  min?: number;
  max?: number;
  step?: number;
  default?: number | boolean | string;
  options?: string[]; // for kind "select"
  unit?: string;
  advanced?: boolean;
  hint?: string;
}

export interface ModeSpec {
  id: string;
  label: string;
  family: string; // "v2" | "v3"
  badge: string;
  blurb?: string;
  models: ModelInfo[];
  resolutions: string[];
  prompt_required?: boolean;
  prompt_tags?: string[];
  inputs: InputSpec[];
  params: ParamSpec[];
}

export interface ModelsResponse {
  family?: string;
  label?: string;
  modes: ModeSpec[];
  resolutions: string[];
  demo?: boolean;
  degraded?: boolean;
}

export type JobStatus =
  | "queued"
  | "loading"
  | "generating"
  | "encoding"
  | "completed"
  | "failed"
  | "canceled";

export interface Job {
  id: string;
  family?: string;
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

export const FAMILY_LABELS: Record<string, string> = {
  v2: "SkyReels V2",
  v3: "SkyReels V3",
};
