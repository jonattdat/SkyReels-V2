"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FAMILY_LABELS,
  type Job,
  type ModeSpec,
  type ModelsResponse,
  type ParamSpec,
} from "@/lib/types";
import DemoFilm from "./DemoFilm";
import {
  IconAperture,
  IconAudio,
  IconBolt,
  IconDice,
  IconDownload,
  IconLayers,
  IconLink,
  IconPlus,
  IconSparkle,
  IconUpload,
  IconVideo,
  IconX,
} from "./icons";

type InputValue = string | string[] | null;

const EXAMPLE_PROMPTS = [
  "A serene lake surrounded by towering mountains, with a few swans gracefully gliding across the water and sunlight dancing on the surface.",
  "A woman in a leather jacket and sunglasses riding a vintage motorcycle through a desert highway at sunset, her hair blowing wildly in the wind.",
  "Close-up of raindrops sliding down a neon-lit window on a rainy Tokyo street at night, glowing bokeh reflections, cinematic shallow depth of field.",
  "An astronaut drifting weightless inside a sunlit space station, dust particles floating through soft volumetric light, slow graceful motion.",
  "A red fox trotting through a snowy pine forest at dawn, its breath visible in the frozen air as gentle snowflakes drift down.",
];

const ACTIVE = new Set(["queued", "loading", "generating", "encoding"]);
const isActive = (s?: string) => !!s && ACTIVE.has(s);
const cssVars = (v: Record<string, string>) => v as React.CSSProperties;

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
  const [modes, setModes] = useState<ModeSpec[]>([]);
  const [catalogLabel, setCatalogLabel] = useState<string>("");
  const [modeId, setModeId] = useState<string>("");
  const [modelId, setModelId] = useState<string>("");
  const [resolution, setResolution] = useState<string>("540P");
  const [seed, setSeed] = useState<string>("");
  const [prompt, setPrompt] = useState<string>("");
  const [paramValues, setParamValues] = useState<Record<string, number | boolean>>({});
  const [inputValues, setInputValues] = useState<Record<string, InputValue>>({});

  const [health, setHealth] = useState<{ gpu_available?: boolean; mock?: boolean } | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [gallery, setGallery] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);

  const mode = useMemo(() => modes.find((m) => m.id === modeId), [modes, modeId]);

  const applyMode = useCallback((m: ModeSpec) => {
    setModeId(m.id);
    const model = m.models[0];
    setModelId(model?.id || "");
    setResolution(model?.resolution || m.resolutions[0] || "540P");
    const defaults: Record<string, number | boolean> = {};
    for (const p of m.params) {
      defaults[p.key] = (p.default ?? (p.kind === "bool" ? false : p.min ?? 0)) as number | boolean;
    }
    setParamValues(defaults);
    setInputValues({});
    setError(null);
  }, []);

  /* load catalog + health */
  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((d: ModelsResponse) => {
        const list = d.modes || [];
        setModes(list);
        setCatalogLabel(d.label || "");
        if (list.length) applyMode(list[0]);
      })
      .catch(() => {});
    fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => {});
  }, [applyMode]);

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
        /* transient */
      }
    }, demo ? 750 : 1500);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [job?.id, job?.status, demo]); // eslint-disable-line react-hooks/exhaustive-deps

  const familyGroups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, ModeSpec[]>();
    for (const m of modes) {
      if (!map.has(m.family)) {
        map.set(m.family, []);
        order.push(m.family);
      }
      map.get(m.family)!.push(m);
    }
    return order.map((f) => ({ family: f, modes: map.get(f)! }));
  }, [modes]);

  const activeModel = mode?.models.find((m) => m.id === modelId);
  const visibleParams = mode?.params.filter((p) => !p.advanced) || [];
  const advancedParams = mode?.params.filter((p) => p.advanced) || [];
  const fps = (paramValues.fps as number) || 24;

  /* actions */
  const setParam = (k: string, v: number | boolean) => setParamValues((s) => ({ ...s, [k]: v }));
  const setInput = (field: string, v: InputValue) => setInputValues((s) => ({ ...s, [field]: v }));

  function randomizeSeed() {
    setSeed(String(Math.floor(Math.random() * 4294967294)));
  }
  function surprisePrompt() {
    setPrompt(EXAMPLE_PROMPTS[Math.floor(Math.random() * EXAMPLE_PROMPTS.length)]);
  }

  function buildBody() {
    if (!mode) return {};
    const body: Record<string, unknown> = {
      mode: mode.id,
      family: mode.family,
      model_id: modelId || null,
      resolution,
      prompt: prompt.trim(),
      seed: seed.trim() === "" ? null : Number(seed),
      ...paramValues,
    };
    for (const inp of mode.inputs) {
      const v = inputValues[inp.field];
      if (inp.kind === "ref_images") {
        const arr = Array.isArray(v) ? v.filter(Boolean) : [];
        if (arr.length) body[inp.field] = arr;
      } else if (typeof v === "string" && v) {
        body[inp.field] = v;
      }
    }
    return body;
  }

  function validate(): string | null {
    if (!mode) return "No generation mode available.";
    if (mode.prompt_required && !prompt.trim()) return "Write a prompt to begin.";
    if (demo) return null; // demo ignores media inputs
    for (const inp of mode.inputs) {
      if (!inp.required) continue;
      const v = inputValues[inp.field];
      if (inp.kind === "ref_images") {
        if (!Array.isArray(v) || v.filter(Boolean).length === 0)
          return `Add at least one ${inp.label.toLowerCase()}.`;
      } else if (!v) {
        return `${inp.label} is required.`;
      }
    }
    return null;
  }

  async function onGenerate() {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildBody()),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Could not start generation.");
      else {
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
      <header className="topbar reveal d1">
        <div className="brand">
          <span className="brand-mark">
            <IconAperture />
          </span>
          <span>
            <span className="brand-name">
              Sky<b>Reels</b> Studio
            </span>
            <span className="brand-sub">{catalogLabel || "Generative Film Studio"}</span>
          </span>
        </div>
        <span className="status-pill">
          <span className={pillClass} />
          {pillText}
        </span>
      </header>

      <main className="shell">
        <section className="hero reveal d2">
          <h1>
            Direct light into <span className="glow">motion.</span>
          </h1>
          <p>
            One studio for the open-source SkyReels film models — V2 text/image
            video and diffusion-forced long takes, plus V3 reference-to-video,
            video extension, and audio-driven talking avatars.
          </p>
        </section>

        <div className="studio">
          {/* ============ LEFT: prompt + inputs + viewport ============ */}
          <div className="reveal d3">
            <div className="panel panel-pad" style={{ marginBottom: 24 }}>
              {mode?.prompt_tags && mode.prompt_tags.length > 0 && (
                <div className="field">
                  <label className="lbl">Shot transition</label>
                  <div className="tag-row">
                    {mode.prompt_tags.map((t) => (
                      <button
                        key={t}
                        type="button"
                        className="tag-chip"
                        onClick={() => setPrompt((p) => `${t} ${p.replace(/^\[[^\]]*\]\s*/, "")}`.trimEnd() + " ")}
                      >
                        {t.replace(/[[\]]/g, "").replace(/_/g, " ").toLowerCase()}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="field" style={{ marginBottom: mode && mode.inputs.length ? 18 : 0 }}>
                <label className="lbl" htmlFor="prompt">
                  Prompt {mode && !mode.prompt_required && <span className="val">optional</span>}
                  <button className="btn btn-ghost btn-sm" onClick={surprisePrompt} type="button">
                    <IconSparkle /> Surprise me
                  </button>
                </label>
                <textarea
                  id="prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={mode?.prompt_required ? "A cinematic wide shot of…" : "Optional guiding prompt…"}
                />
              </div>

              {mode && mode.inputs.length > 0 && (
                <div className="input-grid">
                  {mode.inputs.map((inp) => (
                    <DynamicInput
                      key={inp.field}
                      spec={inp}
                      value={inputValues[inp.field] ?? null}
                      onChange={(v) => setInput(inp.field, v)}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="panel panel-pad" ref={viewportRef}>
              <Viewport job={job} demo={demo} />
              {job && job.status === "completed" && <ResultMeta job={job} />}
              {error && (
                <div className="note err" style={{ marginTop: 16 }}>
                  <IconX /> <span>{error}</span>
                </div>
              )}
            </div>
          </div>

          {/* ============ RIGHT: controls ============ */}
          <aside className="panel reveal d4" style={{ position: "sticky", top: 20 }}>
            <div className="panel-head">
              <h3>Controls</h3>
              {mode && <span className="eyebrow">{mode.badge}</span>}
            </div>
            <div className="panel-pad">
              {/* mode, grouped by family */}
              <div className="field">
                <label className="lbl">Generation mode</label>
                {familyGroups.map((g) => (
                  <div key={g.family} style={{ marginBottom: 10 }}>
                    {familyGroups.length > 1 && (
                      <div className="family-label">{FAMILY_LABELS[g.family] || g.family}</div>
                    )}
                    <div className="mode-grid">
                      {g.modes.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          data-active={modeId === m.id}
                          className="mode-btn"
                          onClick={() => applyMode(m)}
                        >
                          {m.label}
                          <span className="sub">{m.badge}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {mode?.blurb && <p className="mode-blurb">{mode.blurb}</p>}

              {/* model */}
              {mode && mode.models.length > 0 && (
                <div className="field">
                  <label className="lbl" htmlFor="model">
                    Model {activeModel && <span className="val">{activeModel.params}</span>}
                  </label>
                  <select
                    id="model"
                    value={modelId}
                    onChange={(e) => {
                      const m = mode.models.find((x) => x.id === e.target.value);
                      setModelId(e.target.value);
                      if (m) setResolution(m.resolution);
                    }}
                  >
                    {mode.models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.id.replace(/^Skywork\/SkyReels-V\d-/, "")} · {m.params}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* resolution */}
              {mode && mode.resolutions.length > 0 && (
                <div className="field">
                  <label className="lbl">Resolution</label>
                  <div className="segmented">
                    {mode.resolutions.map((r) => (
                      <button key={r} type="button" data-active={resolution === r} onClick={() => setResolution(r)}>
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* visible params */}
              {visibleParams.map((p) => (
                <ParamControl
                  key={p.key}
                  spec={p}
                  value={paramValues[p.key]}
                  fps={fps}
                  onChange={(v) => setParam(p.key, v)}
                />
              ))}

              {/* seed */}
              <div className="field">
                <label className="lbl" htmlFor="seed">
                  Seed <span className="val">{seed === "" ? "random" : ""}</span>
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    id="seed"
                    type="text"
                    inputMode="numeric"
                    placeholder="random"
                    value={seed}
                    onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ""))}
                  />
                  <button className="btn btn-ghost" type="button" onClick={randomizeSeed} title="Randomize seed">
                    <IconDice />
                  </button>
                </div>
              </div>

              {/* advanced */}
              {advancedParams.length > 0 && (
                <>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ width: "100%", marginBottom: showAdvanced ? 16 : 0 }}
                    onClick={() => setShowAdvanced((s) => !s)}
                  >
                    {showAdvanced ? "Hide" : "Show"} advanced parameters
                  </button>
                  {showAdvanced &&
                    advancedParams.map((p) => (
                      <ParamControl
                        key={p.key}
                        spec={p}
                        value={paramValues[p.key]}
                        fps={fps}
                        onChange={(v) => setParam(p.key, v)}
                      />
                    ))}
                </>
              )}

              <button
                className="btn btn-primary"
                style={{ marginTop: 18 }}
                disabled={busy || !mode}
                onClick={onGenerate}
                type="button"
              >
                {busy ? <>Rendering…</> : <><IconBolt /> Generate video</>}
              </button>

              {demo && (
                <div className="note info" style={{ marginTop: 14 }}>
                  <span>
                    Demo mode renders a synthetic preview. Set{" "}
                    <span className="mono">SKYREELS_API_URL</span> to a V2 or V3
                    backend for real video.
                  </span>
                </div>
              )}
            </div>
          </aside>
        </div>

        {/* gallery */}
        <div className="section-title">
          <h2>Session reel</h2>
          <span className="count">
            {gallery.length} render{gallery.length === 1 ? "" : "s"}
          </span>
        </div>
        {gallery.length === 0 ? (
          <div className="empty-gallery">Your renders from this session will collect here.</div>
        ) : (
          <div className="gallery">
            {gallery.map((g) => (
              <GalleryCard
                key={g.id}
                job={g}
                onOpen={() => {
                  setJob(g);
                  viewportRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
              />
            ))}
          </div>
        )}

        <footer className="foot">
          <span>SkyReels V2 &amp; V3 · open-source film generation by Skywork AI.</span>
          <span>
            <a href="https://github.com/SkyworkAI/SkyReels-V2" target="_blank" rel="noreferrer">V2 repo</a>
            {" · "}
            <a href="https://github.com/SkyworkAI/SkyReels-V3" target="_blank" rel="noreferrer">V3 repo</a>
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
      {!job && (
        <div className="vp-empty">
          <div className="ring">
            <IconAperture />
          </div>
          <h4>The stage is set</h4>
          <p>Pick a mode, compose your inputs, and hit Generate.</p>
        </div>
      )}

      {completed && job?.video_url && !isDemoResult && (
        <video key={job.id} src={job.video_url} controls autoPlay loop muted playsInline />
      )}

      {job && (isDemoResult || active) && (
        <div className="demo-render">
          <DemoFilm seed={seed} animate />
          <span className="demo-badge">{demo ? "Demo" : "Preview"}</span>
          {isDemoResult && !active && job.resolved_prompt && (
            <div className="demo-caption">
              <div className="q">“{job.resolved_prompt}”</div>
            </div>
          )}
        </div>
      )}

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
      <span className="chip">seed <b className="mono">{job.seed}</b></span>
      {typeof p.resolution === "string" && <span className="chip"><b>{p.resolution}</b></span>}
      {job.family && <span className="chip"><b>{job.family.toUpperCase()}</b></span>}
      {job.elapsed_seconds != null && <span className="chip"><b className="mono">{job.elapsed_seconds}s</b></span>}
      {job.video_url ? (
        <a className="btn btn-ghost btn-sm" href={job.video_url} download style={{ marginLeft: "auto" }}>
          <IconDownload /> Download mp4
        </a>
      ) : (
        <span className="chip" style={{ marginLeft: "auto" }}>demo preview</span>
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
        <div className="gp">{job.resolved_prompt || String(p.mode || "Render")}</div>
        <div className="gmeta">
          <span>{String(p.mode || "").replace(/_/g, " ").toUpperCase() || "RENDER"}</span>
          <span>·</span>
          <span className="mono">#{job.seed}</span>
        </div>
      </div>
    </div>
  );
}

/* ---- dynamic media input ---- */

function DynamicInput({
  spec,
  value,
  onChange,
}: {
  spec: { kind: string; field: string; label: string; required?: boolean; min?: number; max?: number; allow_url?: boolean; accept?: string };
  value: InputValue;
  onChange: (v: InputValue) => void;
}) {
  if (spec.kind === "ref_images") {
    return (
      <RefImagesField
        label={spec.label}
        max={spec.max || 4}
        values={Array.isArray(value) ? value : []}
        onChange={(arr) => onChange(arr)}
        allowUrl={spec.allow_url}
      />
    );
  }
  if (spec.kind === "video" || spec.kind === "audio") {
    return (
      <MediaUrlField
        label={spec.label}
        kind={spec.kind}
        accept={spec.accept}
        value={typeof value === "string" ? value : null}
        onChange={(v) => onChange(v)}
      />
    );
  }
  // image / end_image
  return (
    <ImageField
      label={spec.label}
      value={typeof value === "string" ? value : null}
      onChange={(v) => onChange(v)}
      allowUrl={spec.allow_url}
    />
  );
}

function ImageField({
  label,
  value,
  onChange,
  allowUrl,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  allowUrl?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [showUrl, setShowUrl] = useState(false);
  return (
    <div className="field" style={{ marginBottom: 0 }}>
      <label className="lbl">
        {label}
        {allowUrl && (
          <button type="button" className="mini-link" onClick={() => setShowUrl((s) => !s)}>
            <IconLink /> URL
          </button>
        )}
      </label>
      <div className={`dropzone ${value ? "filled" : ""}`} onClick={() => !value && inputRef.current?.click()}>
        {value ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={value} alt={label} />
            <button type="button" className="dz-remove" onClick={(e) => { e.stopPropagation(); onChange(null); }}>
              <IconX />
            </button>
          </>
        ) : (
          <div className="dz-hint">
            <div style={{ marginBottom: 6, color: "var(--amber)" }}><IconUpload /></div>
            <b>Upload</b> an image
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) onChange(await fileToDataURL(f));
          }}
        />
      </div>
      {showUrl && !value && (
        <input
          type="text"
          placeholder="https://…/image.png"
          style={{ marginTop: 8 }}
          onKeyDown={(e) => {
            if (e.key === "Enter") onChange((e.target as HTMLInputElement).value.trim() || null);
          }}
          onBlur={(e) => onChange(e.target.value.trim() || null)}
        />
      )}
    </div>
  );
}

function RefImagesField({
  label,
  max,
  values,
  onChange,
  allowUrl,
}: {
  label: string;
  max: number;
  values: string[];
  onChange: (v: string[]) => void;
  allowUrl?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const add = (v: string) => onChange([...values, v].slice(0, max));
  const removeAt = (i: number) => onChange(values.filter((_, idx) => idx !== i));
  return (
    <div className="field" style={{ marginBottom: 0, gridColumn: "1 / -1" }}>
      <label className="lbl">
        <span><IconLayers /> {label}</span>
        <span className="val">{values.length}/{max}</span>
      </label>
      <div className="ref-grid">
        {values.map((v, i) => (
          <div className="ref-slot filled" key={i}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={v} alt={`ref ${i + 1}`} />
            <button type="button" className="dz-remove" onClick={() => removeAt(i)}>
              <IconX />
            </button>
          </div>
        ))}
        {values.length < max && (
          <div className="ref-slot add" onClick={() => inputRef.current?.click()}>
            <IconPlus />
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) add(await fileToDataURL(f));
              }}
            />
          </div>
        )}
      </div>
      {allowUrl && values.length < max && (
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input
            type="text"
            placeholder="or paste an image URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && url.trim()) {
                add(url.trim());
                setUrl("");
              }
            }}
          />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              if (url.trim()) {
                add(url.trim());
                setUrl("");
              }
            }}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}

function MediaUrlField({
  label,
  kind,
  accept,
  value,
  onChange,
}: {
  label: string;
  kind: "video" | "audio";
  accept?: string;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isData = value?.startsWith("data:");
  return (
    <div className="field" style={{ marginBottom: 0, gridColumn: "1 / -1" }}>
      <label className="lbl">
        <span>{kind === "video" ? <IconVideo /> : <IconAudio />} {label}</span>
      </label>
      {value ? (
        <div className="media-filled">
          <span className="media-name mono">{isData ? `uploaded ${kind}` : value}</span>
          <button type="button" className="dz-remove static" onClick={() => onChange(null)}>
            <IconX />
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            placeholder={`https://…/${kind === "video" ? "clip.mp4" : "voice.mp3"}`}
            onKeyDown={(e) => {
              if (e.key === "Enter") onChange((e.target as HTMLInputElement).value.trim() || null);
            }}
            onBlur={(e) => e.target.value.trim() && onChange(e.target.value.trim())}
          />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => inputRef.current?.click()}>
            <IconUpload />
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={accept || (kind === "video" ? "video/*" : "audio/*")}
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) onChange(await fileToDataURL(f));
            }}
          />
        </div>
      )}
      <div className="mono field-hint">Paste a URL (recommended) or upload a small file.</div>
    </div>
  );
}

/* ---- dynamic parameter control ---- */

function ParamControl({
  spec,
  value,
  fps,
  onChange,
}: {
  spec: ParamSpec;
  value: number | boolean | undefined;
  fps: number;
  onChange: (v: number | boolean) => void;
}) {
  if (spec.kind === "bool") {
    return (
      <Toggle
        label={spec.label}
        desc={spec.hint}
        on={value === true}
        onChange={(v) => onChange(v)}
      />
    );
  }
  const num = typeof value === "number" ? value : (spec.default as number) ?? spec.min ?? 0;
  let display: string;
  if (spec.kind === "frames") display = `${num}f · ${(num / fps).toFixed(1)}s`;
  else if (spec.kind === "seconds") display = `${num}s`;
  else if (spec.kind === "float") display = `${num.toFixed(1)}${spec.unit || ""}`;
  else display = `${num}${spec.unit || ""}`;

  return (
    <Slider
      label={spec.label}
      value={num}
      min={spec.min ?? 0}
      max={spec.max ?? 100}
      step={spec.step ?? 1}
      onChange={onChange}
      display={display}
      hint={spec.hint}
    />
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
        <div className="mono field-hint" style={{ marginTop: 7 }}>
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
