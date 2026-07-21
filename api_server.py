"""
SkyReels-V2 inference API server.

A thin FastAPI wrapper around the SkyReels-V2 inference pipelines
(Text-to-Video, Image-to-Video, and Diffusion Forcing) that exposes an
asynchronous REST API suitable for driving a web frontend (see ./web).

Video generation is slow and needs a GPU, so requests are queued and run
serially on a single background worker. Clients submit a job, then poll for
status/progress and finally download the resulting mp4.

Run it (GPU host):

    pip install -r requirements.txt          # the heavy model deps (torch, ...)
    pip install -r requirements-api.txt      # the API deps (fastapi, uvicorn, ...)
    python api_server.py                     # serves on 0.0.0.0:8000

Run it without a GPU, for developing/deploying the frontend end-to-end:

    pip install -r requirements-api.txt
    SKYREELS_MOCK=1 python api_server.py      # synthesizes placeholder videos

Environment variables
---------------------
SKYREELS_MOCK          "1" to synthesize placeholder videos (no torch/GPU needed).
SKYREELS_API_KEY       If set, clients must send it as `x-api-key` / Bearer token.
SKYREELS_CORS_ORIGINS  Comma-separated allowed origins (default "*").
SKYREELS_OUTPUT_DIR    Where generated mp4s are written (default "result/api").
SKYREELS_HOST          Bind host (default "0.0.0.0").
SKYREELS_PORT          Bind port (default "8000").
SKYREELS_DEFAULT_OFFLOAD  "1" to default new jobs to CPU offload (lower VRAM).
"""

from __future__ import annotations

import base64
import gc
import io
import os
import queue
import random
import threading
import time
import traceback
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #

MOCK = os.environ.get("SKYREELS_MOCK", "").lower() in ("1", "true", "yes")
API_KEY = os.environ.get("SKYREELS_API_KEY", "").strip()
CORS_ORIGINS = [
    o.strip() for o in os.environ.get("SKYREELS_CORS_ORIGINS", "*").split(",") if o.strip()
]
OUTPUT_DIR = os.environ.get("SKYREELS_OUTPUT_DIR", os.path.join("result", "api"))
DEFAULT_OFFLOAD = os.environ.get("SKYREELS_DEFAULT_OFFLOAD", "").lower() in ("1", "true", "yes")

os.makedirs(OUTPUT_DIR, exist_ok=True)

RESOLUTIONS = {
    "540P": (544, 960),
    "720P": (720, 1280),
}

# The default negative prompt used by the reference scripts.
NEGATIVE_PROMPT = (
    "Bright tones, overexposed, static, blurred details, subtitles, style, works, "
    "paintings, images, static, overall gray, worst quality, low quality, JPEG "
    "compression residue, ugly, incomplete, extra fingers, poorly drawn hands, "
    "poorly drawn faces, deformed, disfigured, misshapen limbs, fused fingers, "
    "still picture, messy background, three legs, many people in the background, "
    "walking backwards"
)

# Catalog of published model variants, grouped by generation mode. Kept in sync
# with the README download table. `params` is informational (used by the UI to
# warn about VRAM); `resolution` is the native resolution of the checkpoint.
MODEL_CATALOG: list[dict[str, Any]] = [
    # Text-to-Video
    {"id": "Skywork/SkyReels-V2-T2V-14B-540P", "mode": "t2v", "params": "14B", "resolution": "540P"},
    {"id": "Skywork/SkyReels-V2-T2V-14B-720P", "mode": "t2v", "params": "14B", "resolution": "720P"},
    # Image-to-Video
    {"id": "Skywork/SkyReels-V2-I2V-1.3B-540P", "mode": "i2v", "params": "1.3B", "resolution": "540P"},
    {"id": "Skywork/SkyReels-V2-I2V-14B-540P", "mode": "i2v", "params": "14B", "resolution": "540P"},
    {"id": "Skywork/SkyReels-V2-I2V-14B-720P", "mode": "i2v", "params": "14B", "resolution": "720P"},
    # Diffusion Forcing (long video / video extension / start-end frame control)
    {"id": "Skywork/SkyReels-V2-DF-1.3B-540P", "mode": "df", "params": "1.3B", "resolution": "540P"},
    {"id": "Skywork/SkyReels-V2-DF-14B-540P", "mode": "df", "params": "14B", "resolution": "540P"},
    {"id": "Skywork/SkyReels-V2-DF-14B-720P", "mode": "df", "params": "14B", "resolution": "720P"},
]

MODE_LABELS = {
    "t2v": "Text to Video",
    "i2v": "Image to Video",
    "df": "Diffusion Forcing",
}

FAMILY = "v2"
FAMILY_LABEL = "SkyReels V2"


def _models_for(mode: str) -> list[dict[str, Any]]:
    return [{"id": m["id"], "params": m["params"], "resolution": m["resolution"]}
            for m in MODEL_CATALOG if m["mode"] == mode]


# Shared numeric/toggle parameter definitions (the UI renders controls from these).
_P_STEPS = {"key": "inference_steps", "label": "Inference steps", "kind": "int",
            "min": 10, "max": 50, "step": 1, "default": 30}
_P_GUIDANCE = {"key": "guidance_scale", "label": "Guidance scale", "kind": "float",
               "min": 1, "max": 12, "step": 0.5, "default": 6.0}
_P_SHIFT = {"key": "shift", "label": "Flow shift", "kind": "float", "min": 1, "max": 16,
            "step": 0.5, "default": 8.0, "advanced": True}
_P_FPS = {"key": "fps", "label": "Frame rate", "kind": "int", "min": 8, "max": 30,
          "step": 1, "default": 24, "advanced": True, "unit": " fps"}
_P_TEACACHE = {"key": "teacache", "label": "TeaCache", "kind": "bool", "default": False,
               "advanced": True, "hint": "Cache attention for faster sampling"}
_P_OFFLOAD = {"key": "offload", "label": "CPU offload", "kind": "bool", "default": False,
              "advanced": True, "hint": "Lower VRAM, slower generation"}

# Capability specs consumed by the front-end. `inputs` = required/optional media,
# `params` = numeric/toggle controls. Kept parallel to the V3 server's schema.
MODE_SPECS: list[dict[str, Any]] = [
    {
        "id": "t2v", "label": "Text to Video", "family": FAMILY, "badge": "T2V",
        "blurb": "Generate video straight from a text prompt.",
        "models": _models_for("t2v"), "resolutions": list(RESOLUTIONS.keys()),
        "prompt_required": True, "inputs": [],
        "params": [
            {"key": "num_frames", "label": "Duration", "kind": "frames", "min": 17, "max": 121,
             "step": 4, "default": 97},
            _P_STEPS, _P_GUIDANCE, _P_SHIFT, _P_FPS,
            {"key": "prompt_enhancer", "label": "Prompt enhancer", "kind": "bool", "default": False,
             "advanced": True, "hint": "Expand the prompt with an LLM (T2V only)"},
            _P_TEACACHE, _P_OFFLOAD,
        ],
    },
    {
        "id": "i2v", "label": "Image to Video", "family": FAMILY, "badge": "I2V",
        "blurb": "Animate a source image, guided by a text prompt.",
        "models": _models_for("i2v"), "resolutions": list(RESOLUTIONS.keys()),
        "prompt_required": True,
        "inputs": [
            {"kind": "image", "field": "image", "label": "Source image", "required": True,
             "allow_url": True, "accept": "image/*"},
        ],
        "params": [
            {"key": "num_frames", "label": "Duration", "kind": "frames", "min": 17, "max": 121,
             "step": 4, "default": 97},
            _P_STEPS, _P_GUIDANCE, _P_SHIFT, _P_FPS, _P_TEACACHE, _P_OFFLOAD,
        ],
    },
    {
        "id": "df", "label": "Diffusion Forcing", "family": FAMILY, "badge": "DF",
        "blurb": "Long-form / infinite video with optional start and end frame control.",
        "models": _models_for("df"), "resolutions": list(RESOLUTIONS.keys()),
        "prompt_required": True,
        "inputs": [
            {"kind": "image", "field": "image", "label": "Start frame (optional)", "required": False,
             "allow_url": True, "accept": "image/*"},
            {"kind": "image", "field": "end_image", "label": "End frame (optional)", "required": False,
             "allow_url": True, "accept": "image/*"},
        ],
        "params": [
            {"key": "num_frames", "label": "Duration", "kind": "frames", "min": 17, "max": 257,
             "step": 4, "default": 97},
            _P_STEPS, _P_GUIDANCE, _P_SHIFT, _P_FPS,
            {"key": "ar_step", "label": "AR step", "kind": "int", "min": 0, "max": 12, "step": 1,
             "default": 0, "advanced": True, "hint": "Asynchronous denoising for smoother long takes"},
            {"key": "addnoise_condition", "label": "Noise conditioning", "kind": "int", "min": 0,
             "max": 40, "step": 1, "default": 0, "advanced": True, "hint": "~20 aids long-video consistency"},
            {"key": "causal_attention", "label": "Causal attention", "kind": "bool", "default": False,
             "advanced": True, "hint": "Enable AR attention blocks"},
            _P_TEACACHE, _P_OFFLOAD,
        ],
    },
]


# --------------------------------------------------------------------------- #
# Request / response schemas
# --------------------------------------------------------------------------- #


class GenerateRequest(BaseModel):
    """Everything the UI can send. Only `prompt` is strictly required."""

    prompt: str = Field(..., min_length=1, max_length=4000)
    mode: str = Field("t2v", description="t2v | i2v | df")
    model_id: Optional[str] = None
    resolution: str = Field("540P", description="540P | 720P")
    num_frames: int = Field(97, ge=17, le=2000)
    inference_steps: int = Field(30, ge=1, le=100)
    guidance_scale: float = Field(6.0, ge=0.0, le=20.0)
    shift: float = Field(8.0, ge=0.0, le=20.0)
    fps: int = Field(24, ge=1, le=60)
    seed: Optional[int] = Field(None, ge=0, le=4294967294)
    negative_prompt: Optional[str] = None
    prompt_enhancer: bool = False
    offload: Optional[bool] = None
    teacache: bool = False
    teacache_thresh: float = Field(0.2, ge=0.0, le=1.0)
    use_ret_steps: bool = False

    # Image-to-Video / Diffusion Forcing conditioning (base64 data URLs or raw base64)
    image: Optional[str] = None
    end_image: Optional[str] = None

    # Diffusion Forcing specific
    ar_step: int = Field(0, ge=0)
    causal_attention: bool = False
    causal_block_size: int = Field(1, ge=1)
    base_num_frames: int = Field(97, ge=17, le=2000)
    overlap_history: Optional[int] = None
    addnoise_condition: int = Field(0, ge=0, le=100)


# --------------------------------------------------------------------------- #
# Job model + in-memory store
# --------------------------------------------------------------------------- #

VALID_STATES = ("queued", "loading", "generating", "encoding", "completed", "failed", "canceled")


@dataclass
class Job:
    id: str
    params: dict[str, Any]
    status: str = "queued"
    progress: float = 0.0
    stage: str = "Queued"
    error: Optional[str] = None
    video_path: Optional[str] = None
    resolved_prompt: Optional[str] = None
    seed: Optional[int] = None
    created_at: float = field(default_factory=lambda: _now())
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    cancel_requested: bool = False

    def public(self) -> dict[str, Any]:
        elapsed = None
        if self.started_at:
            end = self.finished_at or _now()
            elapsed = round(end - self.started_at, 1)
        # Never leak raw base64 conditioning images back to the client.
        safe_params = {k: v for k, v in self.params.items() if k not in ("image", "end_image")}
        safe_params["has_image"] = bool(self.params.get("image"))
        safe_params["has_end_image"] = bool(self.params.get("end_image"))
        return {
            "id": self.id,
            "status": self.status,
            "progress": round(self.progress, 3),
            "stage": self.stage,
            "error": self.error,
            "seed": self.seed,
            "resolved_prompt": self.resolved_prompt,
            "has_video": bool(self.video_path and os.path.exists(self.video_path)),
            "video_url": f"/api/jobs/{self.id}/video" if self.video_path else None,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "elapsed_seconds": elapsed,
            "params": safe_params,
        }


def _now() -> float:
    return time.time()


class JobStore:
    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._order: list[str] = []
        self._lock = threading.Lock()

    def add(self, job: Job) -> None:
        with self._lock:
            self._jobs[job.id] = job
            self._order.append(job.id)
            # Keep memory bounded: drop the oldest finished jobs beyond a cap.
            if len(self._order) > 200:
                oldest = self._order.pop(0)
                self._jobs.pop(oldest, None)

    def get(self, job_id: str) -> Optional[Job]:
        with self._lock:
            return self._jobs.get(job_id)

    def list(self, limit: int = 50) -> list[Job]:
        with self._lock:
            ids = self._order[-limit:][::-1]
            return [self._jobs[i] for i in ids if i in self._jobs]


STORE = JobStore()
JOB_QUEUE: "queue.Queue[str]" = queue.Queue()


# --------------------------------------------------------------------------- #
# Generation worker
# --------------------------------------------------------------------------- #

# Cache of loaded pipelines, keyed by (mode, model_id, offload). Loading a model
# is expensive, so we keep the most recent one resident.
_PIPELINE_CACHE: dict[tuple, Any] = {}
_PIPELINE_LOCK = threading.Lock()


def _decode_image(data: Optional[str]):
    """Decode a base64 (optionally data-URL) string into a PIL RGB image."""
    if not data:
        return None
    from PIL import Image  # local import: only needed when an image is present

    if data.startswith("data:"):
        data = data.split(",", 1)[1]
    raw = base64.b64decode(data)
    return Image.open(io.BytesIO(raw)).convert("RGB")


def _resolve_dimensions(resolution: str, image) -> tuple[int, int]:
    if resolution not in RESOLUTIONS:
        raise ValueError(f"Invalid resolution: {resolution}")
    height, width = RESOLUTIONS[resolution]
    if image is not None:
        iw, ih = image.size
        if ih > iw:  # portrait conditioning image -> swap to portrait output
            height, width = width, height
    return height, width


def _progress_ticker(job: Job, expected_seconds: float, stop: threading.Event) -> None:
    """Advance progress smoothly toward 0.95 while generation runs."""
    start = _now()
    while not stop.is_set():
        if job.started_at:
            frac = min(0.95, (_now() - start) / max(expected_seconds, 1.0) * 0.95)
            if frac > job.progress:
                job.progress = frac
        time.sleep(0.5)


def _estimate_seconds(params: dict[str, Any]) -> float:
    steps = params.get("inference_steps", 30)
    frames = params.get("num_frames", 97)
    is_720 = params.get("resolution") == "720P"
    base = 0.9 if MOCK else 3.5
    factor = 1.0 + (1.4 if is_720 else 0.0)
    return max(2.0, base * steps * (frames / 97.0) * factor / (8.0 if MOCK else 1.0))


def _run_mock(job: Job, stop: threading.Event) -> str:
    """Synthesize a short animated placeholder mp4 (no torch / GPU)."""
    import imageio
    import numpy as np

    job.status = "generating"
    job.stage = "Synthesizing preview (mock mode)"
    params = job.params
    height, width = RESOLUTIONS.get(params.get("resolution", "540P"), (544, 960))
    # Downscale mock output to keep it fast and small.
    scale = 4
    h, w = height // scale, width // scale
    n = min(48, max(16, params.get("num_frames", 97) // 2))
    seed = job.seed or 0
    rng = np.random.default_rng(seed)
    hue_a = rng.random(3)
    hue_b = rng.random(3)
    frames = []
    yy, xx = np.mgrid[0:h, 0:w]
    for i in range(n):
        if stop.is_set() or job.cancel_requested:
            break
        t = i / max(n - 1, 1)
        wave = 0.5 + 0.5 * np.sin(2 * np.pi * (xx / w * 2 + t) + yy / h * 3)
        col = (1 - wave)[..., None] * hue_a + wave[..., None] * hue_b
        col = (col * 0.6 + 0.2 + 0.2 * np.sin(2 * np.pi * t))
        frame = np.clip(col * 255, 0, 255).astype(np.uint8)
        frames.append(frame)
        job.progress = min(0.95, 0.1 + 0.85 * (i / n))
        time.sleep(0.03)

    job.stage = "Encoding"
    job.status = "encoding"
    out = os.path.join(OUTPUT_DIR, f"{job.id}.mp4")
    imageio.mimwrite(out, frames, fps=params.get("fps", 24), quality=7,
                     output_params=["-loglevel", "error"])
    return out


def _load_pipeline(mode: str, model_id: str, offload: bool):
    key = (mode, model_id, offload)
    with _PIPELINE_LOCK:
        if key in _PIPELINE_CACHE:
            return _PIPELINE_CACHE[key]
        import torch  # noqa: F401
        from skyreels_v2_infer.modules import download_model

        resolved = download_model(model_id)
        if mode == "t2v":
            from skyreels_v2_infer.pipelines import Text2VideoPipeline

            pipe = Text2VideoPipeline(
                model_path=resolved, dit_path=resolved, use_usp=False, offload=offload
            )
        elif mode == "i2v":
            from skyreels_v2_infer.pipelines import Image2VideoPipeline

            pipe = Image2VideoPipeline(
                model_path=resolved, dit_path=resolved, use_usp=False, offload=offload
            )
        elif mode == "df":
            import torch as _torch
            from skyreels_v2_infer import DiffusionForcingPipeline

            pipe = DiffusionForcingPipeline(
                resolved,
                dit_path=resolved,
                device=_torch.device("cuda"),
                weight_dtype=_torch.bfloat16,
                use_usp=False,
                offload=offload,
            )
        else:
            raise ValueError(f"Unknown mode: {mode}")
        # Only cache one pipeline at a time to avoid OOM.
        _PIPELINE_CACHE.clear()
        _PIPELINE_CACHE[key] = (resolved, pipe)
        return resolved, pipe


def _run_real(job: Job, stop: threading.Event) -> str:
    """Run the actual SkyReels-V2 inference. Requires torch + a CUDA GPU."""
    import torch
    from skyreels_v2_infer.pipelines import PromptEnhancer, resizecrop

    params = job.params
    mode = params["mode"]
    model_id = params["model_id"]
    offload = bool(params.get("offload"))

    job.status = "loading"
    job.stage = f"Loading {model_id}"
    resolved_model, pipe = _load_pipeline(mode, model_id, offload)

    image = _decode_image(params.get("image"))
    end_image = _decode_image(params.get("end_image"))
    height, width = _resolve_dimensions(params["resolution"], image)

    prompt_input = params["prompt"]
    if params.get("prompt_enhancer") and image is None:
        job.stage = "Enhancing prompt"
        enhancer = PromptEnhancer()
        prompt_input = enhancer(prompt_input)
        del enhancer
        gc.collect()
        torch.cuda.empty_cache()
    job.resolved_prompt = prompt_input

    negative_prompt = params.get("negative_prompt") or NEGATIVE_PROMPT
    seed = job.seed
    generator = torch.Generator(device="cuda").manual_seed(seed)

    # teacache setup mirrors the reference scripts.
    if params.get("teacache"):
        if mode == "df" and params.get("ar_step", 0) > 0:
            num_steps = params["inference_steps"] + (
                ((params["base_num_frames"] - 1) // 4 + 1) // params["causal_block_size"] - 1
            ) * params["ar_step"]
        else:
            num_steps = params["inference_steps"]
        pipe.transformer.initialize_teacache(
            enable_teacache=True,
            num_steps=num_steps,
            teacache_thresh=params.get("teacache_thresh", 0.2),
            use_ret_steps=params.get("use_ret_steps", False),
            ckpt_dir=resolved_model,
        )

    if image is not None:
        image = resizecrop(image, height, width).convert("RGB")
    if end_image is not None:
        end_image = resizecrop(end_image, height, width).convert("RGB")

    job.status = "generating"
    job.stage = "Generating frames"
    stop_ticker = threading.Event()
    ticker = threading.Thread(
        target=_progress_ticker, args=(job, _estimate_seconds(params), stop_ticker), daemon=True
    )
    ticker.start()

    try:
        with torch.cuda.amp.autocast(dtype=pipe.transformer.dtype), torch.no_grad():
            if mode == "df":
                if params.get("causal_attention"):
                    pipe.transformer.set_ar_attention(params["causal_block_size"])
                video_frames = pipe(
                    prompt=prompt_input,
                    negative_prompt=negative_prompt,
                    image=image,
                    end_image=end_image,
                    height=height,
                    width=width,
                    num_frames=params["num_frames"],
                    num_inference_steps=params["inference_steps"],
                    shift=params["shift"],
                    guidance_scale=params["guidance_scale"],
                    generator=generator,
                    overlap_history=params.get("overlap_history"),
                    addnoise_condition=params.get("addnoise_condition", 0),
                    base_num_frames=params["base_num_frames"],
                    ar_step=params.get("ar_step", 0),
                    causal_block_size=params.get("causal_block_size", 1),
                    fps=params["fps"],
                )[0]
            else:
                kwargs = {
                    "prompt": prompt_input,
                    "negative_prompt": negative_prompt,
                    "num_frames": params["num_frames"],
                    "num_inference_steps": params["inference_steps"],
                    "guidance_scale": params["guidance_scale"],
                    "shift": params["shift"],
                    "generator": generator,
                    "height": height,
                    "width": width,
                }
                if image is not None:
                    kwargs["image"] = image
                video_frames = pipe(**kwargs)[0]
    finally:
        stop_ticker.set()

    job.status = "encoding"
    job.stage = "Encoding video"
    import imageio

    out = os.path.join(OUTPUT_DIR, f"{job.id}.mp4")
    imageio.mimwrite(out, video_frames, fps=params["fps"], quality=8,
                     output_params=["-loglevel", "error"])
    del video_frames
    gc.collect()
    torch.cuda.empty_cache()
    return out


def _worker() -> None:
    while True:
        job_id = JOB_QUEUE.get()
        job = STORE.get(job_id)
        if job is None:
            JOB_QUEUE.task_done()
            continue
        if job.cancel_requested:
            job.status = "canceled"
            job.stage = "Canceled"
            job.finished_at = _now()
            JOB_QUEUE.task_done()
            continue
        job.started_at = _now()
        job.progress = 0.02
        stop = threading.Event()
        try:
            if MOCK:
                path = _run_mock(job, stop)
            else:
                path = _run_real(job, stop)
            if job.cancel_requested:
                job.status = "canceled"
                job.stage = "Canceled"
            else:
                job.video_path = path
                job.status = "completed"
                job.stage = "Completed"
                job.progress = 1.0
        except Exception as exc:  # noqa: BLE001 - surface any failure to the client
            job.status = "failed"
            job.stage = "Failed"
            job.error = f"{type(exc).__name__}: {exc}"
            traceback.print_exc()
        finally:
            job.finished_at = _now()
            JOB_QUEUE.task_done()


_worker_thread = threading.Thread(target=_worker, daemon=True)
_worker_thread.start()


# --------------------------------------------------------------------------- #
# FastAPI app
# --------------------------------------------------------------------------- #

app = FastAPI(title="SkyReels-V2 API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS or ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def require_api_key(
    x_api_key: Optional[str] = Header(None, alias="x-api-key"),
    authorization: Optional[str] = Header(None),
) -> None:
    if not API_KEY:
        return
    token = x_api_key
    if not token and authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    if token != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


def _pick_default_model(mode: str) -> str:
    for m in MODEL_CATALOG:
        if m["mode"] == mode:
            return m["id"]
    return MODEL_CATALOG[0]["id"]


@app.get("/health")
async def health() -> dict[str, Any]:
    gpu = False
    if not MOCK:
        try:
            import torch

            gpu = torch.cuda.is_available()
        except Exception:  # noqa: BLE001
            gpu = False
    return {
        "status": "ok",
        "mock": MOCK,
        "gpu_available": gpu,
        "queue_depth": JOB_QUEUE.qsize(),
        "auth_required": bool(API_KEY),
    }


@app.get("/api/models", dependencies=[Depends(require_api_key)])
async def models() -> dict[str, Any]:
    return {
        "family": FAMILY,
        "label": FAMILY_LABEL,
        "modes": MODE_SPECS,
        "resolutions": list(RESOLUTIONS.keys()),
    }


@app.post("/api/generate", dependencies=[Depends(require_api_key)])
async def generate(req: GenerateRequest) -> JSONResponse:
    if req.mode not in MODE_LABELS:
        raise HTTPException(status_code=422, detail=f"Invalid mode: {req.mode}")
    if req.resolution not in RESOLUTIONS:
        raise HTTPException(status_code=422, detail=f"Invalid resolution: {req.resolution}")
    if req.mode == "i2v" and not req.image and not MOCK:
        raise HTTPException(status_code=422, detail="Image-to-Video requires an input image")

    params = req.model_dump()
    if not params.get("model_id"):
        params["model_id"] = _pick_default_model(req.mode)
    if params.get("offload") is None:
        params["offload"] = DEFAULT_OFFLOAD

    seed = req.seed
    if seed is None:
        random.seed(time.time())
        seed = int(random.randrange(4294967294))

    job = Job(id=uuid.uuid4().hex[:12], params=params, seed=seed)
    job.resolved_prompt = req.prompt
    STORE.add(job)
    JOB_QUEUE.put(job.id)
    return JSONResponse(status_code=202, content=job.public())


@app.get("/api/jobs", dependencies=[Depends(require_api_key)])
async def list_jobs(limit: int = 50) -> dict[str, Any]:
    return {"jobs": [j.public() for j in STORE.list(limit=limit)]}


@app.get("/api/jobs/{job_id}", dependencies=[Depends(require_api_key)])
async def get_job(job_id: str) -> dict[str, Any]:
    job = STORE.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job.public()


@app.post("/api/jobs/{job_id}/cancel", dependencies=[Depends(require_api_key)])
async def cancel_job(job_id: str) -> dict[str, Any]:
    job = STORE.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status in ("completed", "failed", "canceled"):
        return job.public()
    job.cancel_requested = True
    return job.public()


@app.get("/api/jobs/{job_id}/video", dependencies=[Depends(require_api_key)])
async def get_video(job_id: str) -> FileResponse:
    job = STORE.get(job_id)
    if job is None or not job.video_path or not os.path.exists(job.video_path):
        raise HTTPException(status_code=404, detail="Video not available")
    return FileResponse(job.video_path, media_type="video/mp4", filename=f"skyreels_{job_id}.mp4")


@app.get("/")
async def root() -> dict[str, Any]:
    return {
        "name": "SkyReels-V2 API",
        "mock": MOCK,
        "docs": "/docs",
        "endpoints": ["/health", "/api/models", "/api/generate", "/api/jobs", "/api/jobs/{id}"],
    }


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("SKYREELS_HOST", "0.0.0.0")
    port = int(os.environ.get("SKYREELS_PORT", "8000"))
    mode = "MOCK" if MOCK else "GPU"
    print(f"Starting SkyReels-V2 API ({mode} mode) on {host}:{port}")
    uvicorn.run(app, host=host, port=port)
