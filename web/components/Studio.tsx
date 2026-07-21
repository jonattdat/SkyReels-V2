"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Job, Mode, ModelInfo, ModelsResponse } from "@/lib/types";
import DemoFilm from "./DemoFilm";
import {
  IconAperture,
  IconBolt,
  IconDice,
  IconDownload,
  IconImage,
  IconInfinity,
  IconSparkle,
  IconText,
  IconUpload,
  IconX,
} from "./icons";

/* ------------------------------------------------------------------ state */

interface Form {
  prompt: string;
  mode: Mode;
  model_id: string;
  resolution: string;
  num_frames: number;
  steps: number;
  guidance: number;
  shift: number;
  fps: number;
  seed: string;
  promptEnhancer: boolean;
  teacache: boolean;
  offload: boolean;
  image: string | null;
  endImage: string | null;
  arStep: number;
  causalAttention: boolean;
  causalBlockSize: number;
  addnoise: number;
}

const DEFAULT_FORM: Form = {
  prompt: "",
  mode: "t2v",
  model_id: "",
  resolution: "540P",
  num_frames: 97,
  steps: 30,
  guidance: 6.0,
  shift: 8.0,
  fps: 24,
  seed: "",
  promptEnhancer: false,
  teacache: false,
  offload: false,
  image: null,
  endImage: null,
  arStep: 0,
  causalAttention: false,
  causalBlockSize: 1,
  addnoise: 0,
};

const EXAMPLE_PROMPTS = [
  "A serene lake surrounded by towering mountains, with a few swans gracefully gliding across the water and sunlight dancing on the surface.",
  "A woman in a leather jacket and sunglasses riding a vintage motorcycle through a desert highway at sunset, her hair blowing wildly in the wind as the golden sun casts long shadows.",
  "Close-up of raindrops sliding down a neon-lit window on a rainy Tokyo street at night, glowing bokeh reflections, cinematic shallow depth of field.",
  "An astronaut drifting weightless inside a sunlit space station, dust particles floating through soft volumetric light, slow graceful motion.",
  "A red fox trotting through a snowy pine forest at dawn, its breath visible in the frozen air as gentle snowflakes drift down.",
];

const MODE_META: Record<Mode, { label: string; sub: string; icon: React.ReactNode }> = {
  t2v: { label: "Text", sub: "T2V", icon: <IconText /> },
  i2v: { label: "Image", sub: "I2V", icon: <IconImage /> },
  df: { label: "Forcing", sub: "DF", icon: <IconInfinity /> },
};

const ACTIVE = new Set(["queued", "loading", "generating", "encoding"]);
const isActive = (s?: string) => !!s && ACTIVE.has(s);

function cssVars(vars: Record<string, string>): React.CSSProperties {
  return vars as React.CSSProperties;
}

function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/* -------------------------------------------------------------- component */

export default function Studio({ demo }: { demo: boolean }) {
  const [form, setForm] = useState<Form>(DEFAULT_FORM);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [health, setHealth] = useState<{ gpu_available?: boolean; mock?: boolean } | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [gallery, setGallery] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);

  const set = useCallback(<K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
  }, []);

  /* load catalog + health */
  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((d: ModelsResponse) => setModels(d.models || []))
      .catch(() => {});
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => {});
  }, []);

  /* keep model_id valid for the chosen mode */
  useEffect(() => {
    if (!models.length) return;
    const candidates = models.filter((m) => m.mode === form.mode);
    if (!candidates.length) return;
    setForm((f) => {
      if (candidates.some((m) => m.id === f.model_id)) return f;
      const match =
        candidates.find((m) => m.resolution === f.resolution) || candidates[0];
      return { ...f, model_id: match.id, resolution: match.resolution };
    });
  }, [form.mode, models]); // eslint-disable-line react-hooks/exhaustive-deps

  /* poll the active job */
  useEffect(() => {
    if (!job || !isActive(job.status)) return;
    let alive = true;
    const id = job.id;
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${id}`, { cache: "no-store" });
        const data: Job = await res.json();
        if (!alive || !res.ok) return;
        setJob((cur) => (cur && cur.id === id ? data : cur));
        if (data.status === "completed") {
          setGallery((g) => (g.some((x) => x.id === data.id) ? g : [data, ...g].slice(0, 12)));
        }
      } catch {
        /* transient network error — keep polling */
      }
    }, demo ? 750 : 1500);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [job?.id, job?.status, demo]); // eslint-disable-line react-hooks/exhaustive-deps

  const modeCandidates = models.filter((m) => m.mode === form.mode);
  const activeModel = models.find((m) => m.id === form.model_id);

  /* actions */
  function randomizeSeed() {
    set("seed", String(Math.floor(Math.random() * 4294967294)));
  }
  function surprisePrompt() {
    const pick = EXAMPLE_PROMPTS[Math.floor(Math.random() * EXAMPLE_PROMPTS.length)];
    set("prompt", pick);
  }

  async function handleImage(file: File | undefined, which: "image" | "endImage") {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    const url = await fileToDataURL(file);
    set(which, url);
  }

  function buildBody() {
    const seed = form.seed.trim() === "" ? null : Number(form.seed);
    const body: Record<string, unknown> = {
      prompt: form.prompt.trim(),
      mode: form.mode,
      model_id: form.model_id || null,
      resolution: form.resolution,
      num_frames: form.num_frames,
      inference_steps: form.steps,
      guidance_scale: form.guidance,
      shift: form.shift,
      fps: form.fps,
      seed: Number.isFinite(seed as number) ? seed : null,
      prompt_enhancer: form.promptEnhancer,
      teacache: form.teacache,
      offload: form.offload,
    };
    if (form.mode === "i2v" || form.mode === "df") {
      if (form.image) body.image = form.image;
    }
    if (form.mode === "df") {
      if (form.endImage) body.end_image = form.endImage;
      body.ar_step = form.arStep;
      body.causal_attention = form.causalAttention;
      body.causal_block_size = form.causalBlockSize;
      body.base_num_frames = 97;
      body.addnoise_condition = form.addnoise;
      if (form.num_frames > 97) body.overlap_history = 17;
    }
    return body;
  }

  async function onGenerate() {
    setError(null);
    if (!form.prompt.trim()) {
      setError("Write a prompt to begin.");
      return;
    }
    if (form.mode === "i2v" && !form.image && !demo) {
      setError("Image-to-Video needs a source image.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildBody()),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not start generation.");
      } else {
        setJob(data);
        viewportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setSubmitting(false);
    }
  }

  const busy = submitting || isActive(job?.status);
  const seconds = (form.num_frames / form.fps).toFixed(1);
  const longVideo = form.mode === "df" && form.num_frames > 97;

  /* status pill */
  let pillClass = "dot";
  let pillText = demo ? "Demo mode" : "Backend connected";
  if (isActive(job?.status)) {
    pillClass = "dot warn";
    pillText = "Rendering";
  } else if (demo) {
    pillClass = "dot warn";
    pillText = "Demo mode · no GPU";
  } else if (health && health.gpu_available === false) {
    pillClass = "dot warn";
    pillText = health.mock ? "Backend · mock" : "Backend · CPU";
  }

  return (
    <>
      {/* ---------------------------------------------------------- topbar */}
      <header className="topbar reveal d1">
        <div className="brand">
          <span className="brand-mark">
            <IconAperture />
          </span>
          <span>
            <span className="brand-name">
              Sky<b>Reels</b> V2
            </span>
            <span className="brand-sub">Generative Film Studio</span>
          </span>
        </div>
        <span className="status-pill">
          <span className={pillClass} />
          {pillText}
        </span>
      </header>

      <main className="shell">
        {/* ------------------------------------------------------- hero */}
        <section className="hero reveal d2">
          <h1>
            Direct light into <span className="glow">motion.</span>
          </h1>
          <p>
            A studio front-end for SkyReels-V2 — the open-source, infinite-length
            film model. Compose a prompt, shape the parameters, and render
            text-to-video, image-to-video, or diffusion-forced long takes.
          </p>
        </section>

        {/* ----------------------------------------------------- studio */}
        <div className="studio">
          {/* ============ LEFT: prompt + viewport ============ */}
          <div className="reveal d3">
            <div className="panel panel-pad" style={{ marginBottom: 24 }}>
              <div className="field">
                <label className="lbl" htmlFor="prompt">
                  Prompt
                  <button className="btn btn-ghost btn-sm" onClick={surprisePrompt} type="button">
                    <IconSparkle /> Surprise me
                  </button>
                </label>
                <textarea
                  id="prompt"
                  value={form.prompt}
                  onChange={(e) => set("prompt", e.target.value)}
                  placeholder="A cinematic wide shot of…"
                />
              </div>

              {(form.mode === "i2v" || form.mode === "df") && (
                <div className="grid-2">
                  <ImageField
                    label={form.mode === "df" ? "Start frame" : "Source image"}
                    value={form.image}
                    onPick={(f) => handleImage(f, "image")}
                    onClear={() => set("image", null)}
                  />
                  {form.mode === "df" && (
                    <ImageField
                      label="End frame (optional)"
                      value={form.endImage}
                      onPick={(f) => handleImage(f, "endImage")}
                      onClear={() => set("endImage", null)}
                    />
                  )}
                </div>
              )}
            </div>

            {/* viewport */}
            <div className="panel panel-pad" ref={viewportRef}>
              <Viewport job={job} demo={demo} />
              {job && !isActive(job.status) && job.status === "completed" && (
                <ResultMeta job={job} />
              )}
              {error && (
                <div className="note err" style={{ marginTop: 16 }}>
                  <IconX /> <span>{error}</span>
                </div>
              )}
            </div>
          </div>

          {/* ============ RIGHT: controls ============ */}
          <aside
            className="panel reveal d4"
            style={{ position: "sticky", top: 20 }}
          >
            <div className="panel-head">
              <h3>Controls</h3>
              <span className="eyebrow">{MODE_META[form.mode].sub}</span>
            </div>
            <div className="panel-pad">
              {/* mode */}
              <div className="field">
                <label className="lbl">Generation mode</label>
                <div className="segmented">
                  {(Object.keys(MODE_META) as Mode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      data-active={form.mode === m}
                      onClick={() => set("mode", m)}
                    >
                      {MODE_META[m].label}
                      <span className="sub">{MODE_META[m].sub}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* model */}
              <div className="field">
                <label className="lbl" htmlFor="model">
                  Model
                  {activeModel && <span className="val">{activeModel.params}</span>}
                </label>
                <select
                  id="model"
                  value={form.model_id}
                  onChange={(e) => {
                    const m = models.find((x) => x.id === e.target.value);
                    setForm((f) => ({
                      ...f,
                      model_id: e.target.value,
                      resolution: m?.resolution || f.resolution,
                    }));
                  }}
                >
                  {modeCandidates.length === 0 && <option>Loading…</option>}
                  {modeCandidates.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id.replace("Skywork/SkyReels-V2-", "")} · {m.params}
                    </option>
                  ))}
                </select>
              </div>

              {/* resolution */}
              <div className="field">
                <label className="lbl">Resolution</label>
                <div className="segmented">
                  {["540P", "720P"].map((r) => (
                    <button
                      key={r}
                      type="button"
                      data-active={form.resolution === r}
                      onClick={() => set("resolution", r)}
                    >
                      {r}
                      <span className="sub">{r === "540P" ? "960×544" : "1280×720"}</span>
                    </button>
                  ))}
                </div>
              </div>

              <Slider
                label="Duration"
                value={form.num_frames}
                min={17}
                max={form.mode === "df" ? 257 : 121}
                step={4}
                onChange={(v) => set("num_frames", v)}
                display={`${form.num_frames}f · ${seconds}s`}
                hint={longVideo ? "Long take → diffusion-forcing extension enabled" : undefined}
              />

              <Slider
                label="Inference steps"
                value={form.steps}
                min={10}
                max={50}
                step={1}
                onChange={(v) => set("steps", v)}
                display={String(form.steps)}
              />

              <Slider
                label="Guidance scale"
                value={form.guidance}
                min={1}
                max={12}
                step={0.5}
                onChange={(v) => set("guidance", v)}
                display={form.guidance.toFixed(1)}
              />

              {/* seed */}
              <div className="field">
                <label className="lbl" htmlFor="seed">
                  Seed
                  <span className="val">{form.seed === "" ? "random" : ""}</span>
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    id="seed"
                    type="text"
                    inputMode="numeric"
                    placeholder="random"
                    value={form.seed}
                    onChange={(e) => set("seed", e.target.value.replace(/[^0-9]/g, ""))}
                  />
                  <button className="btn btn-ghost" type="button" onClick={randomizeSeed} title="Randomize seed">
                    <IconDice />
                  </button>
                </div>
              </div>

              {/* advanced */}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ width: "100%", marginBottom: showAdvanced ? 16 : 0 }}
                onClick={() => setShowAdvanced((s) => !s)}
              >
                {showAdvanced ? "Hide" : "Show"} advanced parameters
              </button>

              {showAdvanced && (
                <div style={{ marginBottom: 4 }}>
                  <Slider
                    label="Flow shift"
                    value={form.shift}
                    min={1}
                    max={16}
                    step={0.5}
                    onChange={(v) => set("shift", v)}
                    display={form.shift.toFixed(1)}
                  />
                  <Slider
                    label="Frame rate"
                    value={form.fps}
                    min={8}
                    max={30}
                    step={1}
                    onChange={(v) => set("fps", v)}
                    display={`${form.fps} fps`}
                  />
                  {form.mode === "df" && (
                    <>
                      <Slider
                        label="AR step"
                        value={form.arStep}
                        min={0}
                        max={12}
                        step={1}
                        onChange={(v) => set("arStep", v)}
                        display={form.arStep === 0 ? "sync" : `async ${form.arStep}`}
                        hint="Asynchronous denoising for smoother long takes"
                      />
                      <Slider
                        label="Noise conditioning"
                        value={form.addnoise}
                        min={0}
                        max={40}
                        step={1}
                        onChange={(v) => set("addnoise", v)}
                        display={String(form.addnoise)}
                        hint="~20 recommended for long-video consistency"
                      />
                      <Toggle
                        label="Causal attention"
                        desc="Enable AR attention blocks"
                        on={form.causalAttention}
                        onChange={(v) => set("causalAttention", v)}
                      />
                    </>
                  )}
                  <Toggle
                    label="Prompt enhancer"
                    desc="Expand the prompt with an LLM (T2V only)"
                    on={form.promptEnhancer}
                    onChange={(v) => set("promptEnhancer", v)}
                  />
                  <Toggle
                    label="TeaCache"
                    desc="Cache attention for faster sampling"
                    on={form.teacache}
                    onChange={(v) => set("teacache", v)}
                  />
                  <Toggle
                    label="CPU offload"
                    desc="Lower VRAM, slower generation"
                    on={form.offload}
                    onChange={(v) => set("offload", v)}
                  />
                </div>
              )}

              <button
                className="btn btn-primary"
                style={{ marginTop: 18 }}
                disabled={busy}
                onClick={onGenerate}
                type="button"
              >
                {busy ? (
                  <>Rendering…</>
                ) : (
                  <>
                    <IconBolt /> Generate video
                  </>
                )}
              </button>

              {demo && (
                <div className="note info" style={{ marginTop: 14 }}>
                  <span>
                    Demo mode renders a synthetic preview. Set{" "}
                    <span className="mono">SKYREELS_API_URL</span> to a GPU
                    backend for real video.
                  </span>
                </div>
              )}
            </div>
          </aside>
        </div>

        {/* -------------------------------------------------- gallery */}
        <div className="section-title">
          <h2>Session reel</h2>
          <span className="count">{gallery.length} render{gallery.length === 1 ? "" : "s"}</span>
        </div>
        {gallery.length === 0 ? (
          <div className="empty-gallery">
            Your renders from this session will collect here.
          </div>
        ) : (
          <div className="gallery">
            {gallery.map((g) => (
              <GalleryCard key={g.id} job={g} onOpen={() => {
                setJob(g);
                viewportRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
              }} />
            ))}
          </div>
        )}

        {/* --------------------------------------------------- footer */}
        <footer className="foot">
          <span>
            SkyReels-V2 · AutoRegressive Diffusion-Forcing film model by Skywork AI.
          </span>
          <span>
            <a href="https://github.com/SkyworkAI/SkyReels-V2" target="_blank" rel="noreferrer">
              Model repo
            </a>{" "}
            ·{" "}
            <a href="https://arxiv.org/pdf/2504.13074" target="_blank" rel="noreferrer">
              Technical report
            </a>
          </span>
        </footer>
      </main>
    </>
  );
}

/* --------------------------------------------------------- subcomponents */

function Viewport({ job, demo }: { job: Job | null; demo: boolean }) {
  const active = isActive(job?.status);
  const completed = job?.status === "completed";
  const failed = job?.status === "failed";
  const isDemoResult = !!job && (job.demo || demo) && !job.video_url;
  const seed = job?.seed ?? 1;

  return (
    <div className={`viewport ${completed && !isDemoResult ? "playing" : ""}`}>
      {/* empty */}
      {!job && (
        <div className="vp-empty">
          <div className="ring">
            <IconAperture />
          </div>
          <h4>The stage is set</h4>
          <p>Write a prompt and hit Generate to roll your first frames.</p>
        </div>
      )}

      {/* real completed video */}
      {completed && job?.video_url && !isDemoResult && (
        <video
          key={job.id}
          src={job.video_url}
          controls
          autoPlay
          loop
          muted
          playsInline
        />
      )}

      {/* demo synthetic render */}
      {job && (isDemoResult || active) && (
        <div className="demo-render">
          <DemoFilm seed={seed} animate />
          <span className="demo-badge">{demo ? "Demo" : "Preview"}</span>
          {isDemoResult && !active && (
            <div className="demo-caption">
              <div className="q">“{job.resolved_prompt}”</div>
            </div>
          )}
        </div>
      )}

      {/* progress overlay */}
      {active && (
        <div className="render-status">
          <div className="rs-inner">
            <div className="spinner-reel" />
            <div className="stage">{job?.stage || "Working"}</div>
            <div className="scanbar">
              <i style={{ transform: `scaleX(${Math.max(0.02, job?.progress || 0)})` }} />
            </div>
            <div className="pct mono">{Math.round((job?.progress || 0) * 100)}%</div>
          </div>
        </div>
      )}

      {/* failed */}
      {failed && (
        <div className="vp-empty">
          <div className="ring" style={{ color: "var(--coral)", borderColor: "rgba(255,106,69,0.4)" }}>
            <IconX />
          </div>
          <h4>Render failed</h4>
          <p>{job?.error || "The backend reported an error."}</p>
        </div>
      )}
    </div>
  );
}

function ResultMeta({ job }: { job: Job }) {
  const p = job.params || {};
  return (
    <div className="result-meta">
      <span className="chip">
        seed <b className="mono">{job.seed}</b>
      </span>
      {typeof p.resolution === "string" && (
        <span className="chip">
          <b>{p.resolution}</b>
        </span>
      )}
      {typeof p.num_frames === "number" && (
        <span className="chip">
          <b className="mono">{p.num_frames}</b> frames
        </span>
      )}
      {job.elapsed_seconds != null && (
        <span className="chip">
          <b className="mono">{job.elapsed_seconds}s</b>
        </span>
      )}
      {job.video_url ? (
        <a className="btn btn-ghost btn-sm" href={job.video_url} download style={{ marginLeft: "auto" }}>
          <IconDownload /> Download mp4
        </a>
      ) : (
        <span className="chip" style={{ marginLeft: "auto" }}>
          demo preview
        </span>
      )}
    </div>
  );
}

function GalleryCard({ job, onOpen }: { job: Job; onOpen: () => void }) {
  const p = job.params || {};
  const isReal = !!job.video_url && !job.demo;
  return (
    <div className="gcard" onClick={onOpen}>
      <div className="thumb">
        {isReal ? (
          <video src={job.video_url as string} muted loop preload="metadata" />
        ) : (
          <DemoFilm seed={job.seed ?? 1} animate={false} />
        )}
      </div>
      <div className="gbody">
        <div className="gp">{job.resolved_prompt || "Untitled render"}</div>
        <div className="gmeta">
          <span>{String(p.mode || "").toUpperCase() || "T2V"}</span>
          <span>·</span>
          <span>{String(p.resolution || "")}</span>
          <span>·</span>
          <span className="mono">#{job.seed}</span>
        </div>
      </div>
    </div>
  );
}

function ImageField({
  label,
  value,
  onPick,
  onClear,
}: {
  label: string;
  value: string | null;
  onPick: (f: File | undefined) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="field" style={{ marginBottom: 0 }}>
      <label className="lbl">{label}</label>
      <div
        className={`dropzone ${value ? "filled" : ""}`}
        onClick={() => !value && inputRef.current?.click()}
      >
        {value ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={value} alt={label} />
            <button
              type="button"
              className="dz-remove"
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
            >
              <IconX />
            </button>
          </>
        ) : (
          <div className="dz-hint">
            <div style={{ marginBottom: 6, color: "var(--amber)" }}>
              <IconUpload />
            </div>
            <b>Upload</b> an image
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => onPick(e.target.files?.[0])}
        />
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  display: string;
  hint?: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="field">
      <label className="lbl">
        {label} <span className="val mono">{display}</span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={cssVars({ "--pct": `${pct}%` })}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && (
        <div className="mono" style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 7 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

function Toggle({
  label,
  desc,
  on,
  onChange,
}: {
  label: string;
  desc?: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="toggle-row">
      <div className="t-label">
        {label}
        {desc && <small>{desc}</small>}
      </div>
      <div
        className="switch"
        data-on={on}
        role="switch"
        aria-checked={on}
        tabIndex={0}
        onClick={() => onChange(!on)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onChange(!on);
          }
        }}
      />
    </div>
  );
}
