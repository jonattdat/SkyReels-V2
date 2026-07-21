# SkyReels Studio — Vercel front-end

A cinematic web studio for the open-source SkyReels film models —
[SkyReels-V2](https://github.com/SkyworkAI/SkyReels-V2) **and**
[SkyReels-V3](https://github.com/SkyworkAI/SkyReels-V3). Deploy the UI to **Vercel** in a
couple of clicks; point it at a GPU box (or hosted API) running the inference server when
you're ready to render real video.

<p align="center"><em>V2: Text-to-Video · Image-to-Video · Diffusion-Forcing &nbsp;|&nbsp; V3: Reference-to-Video · Video Extension · Talking Avatar</em></p>

The UI is **capability-driven**: it reads the connected backend's `/api/models` and renders
its controls from that. One front-end therefore drives either family — a V2 backend
(`api_server.py` in this repo) or a V3 backend (`api_server.py` in the SkyReels-V3 repo).
With no backend configured it runs a self-contained demo of every mode.

---

## Why it's split in two

SkyReels-V2 is a 1.3B–14B diffusion model that needs a **CUDA GPU** and downloads
multi-gigabyte weights. Vercel is serverless and has **no GPU**, so the model can't run
there. The clean architecture is therefore two pieces:

```
┌────────────────────────┐        HTTPS         ┌──────────────────────────────┐
│  Vercel (this folder)  │  ───────────────▶    │  GPU host (../api_server.py) │
│  Next.js UI + API proxy│   POST /api/generate │  FastAPI + SkyReels pipelines│
│  browser never sees    │  GET  /api/jobs/:id  │  T2V · I2V · Diffusion Force │
│  the GPU or the API key│  ◀───────────────    │  returns mp4                 │
└────────────────────────┘      job + video     └──────────────────────────────┘
```

The browser only ever talks to Next.js route handlers (`app/api/*`). They forward requests
to the inference backend server-side, attaching the shared API key so it's never exposed to
the client.

### Demo mode (zero backend)

If `SKYREELS_API_URL` is **not set**, the site runs in a self-contained **demo mode**: it
synthesises an animated preview and simulated progress so the deployed URL is fully
interactive before you've stood up any GPU. Demo jobs are *stateless* (all state is encoded
in the job id), so they work across Vercel's ephemeral serverless instances. Wire up a
backend to swap synthetic previews for real mp4 output — no frontend changes needed.

---

## Deploy the front-end to Vercel

1. Push this repo to GitHub (already done if you're reading this on GitHub).
2. In Vercel → **Add New… → Project**, import the repo.
3. Set **Root Directory** to `web`. Vercel auto-detects Next.js.
4. (Optional) add environment variables — see below. Skip them to deploy in demo mode.
5. **Deploy.** You'll get a live URL immediately.

### Environment variables

| Variable            | Required | Description                                                        |
| ------------------- | -------- | ------------------------------------------------------------------ |
| `SKYREELS_API_URL`  | no       | Base URL of your inference API. Unset ⇒ demo mode.                 |
| `SKYREELS_API_KEY`  | no       | Shared secret; must match the backend's `SKYREELS_API_KEY`.        |

Copy `.env.example` to `.env.local` for local development.

---

## Stand up the inference backend (GPU)

The backend lives one directory up: [`../api_server.py`](../api_server.py).

```bash
# On a machine with a CUDA GPU (see the main README for model/VRAM guidance):
cd ..
pip install -r requirements.txt        # torch + the model runtime
pip install -r requirements-api.txt    # fastapi, uvicorn, ...
python api_server.py                    # serves on 0.0.0.0:8000
```

Then expose it to Vercel over HTTPS and set `SKYREELS_API_URL` to that address. Options:

- A reverse proxy (Caddy/Nginx + TLS) in front of the GPU box.
- A tunnel such as `ngrok http 8000` or a Cloudflare Tunnel for quick tests.
- A GPU host that already gives you a public HTTPS endpoint (RunPod, Lambda, etc.).

Lock it down with a shared secret:

```bash
SKYREELS_API_KEY=your-long-random-secret python api_server.py
# …and set the same SKYREELS_API_KEY in Vercel.
```

### No GPU handy? Run the backend in mock mode

```bash
pip install -r requirements-api.txt
SKYREELS_MOCK=1 python api_server.py     # synthesises small placeholder mp4s
```

This exercises the *real* API contract (queue, polling, mp4 download) end-to-end without
torch or a GPU — useful for testing the deployed frontend against a live backend.

### Backend endpoints

| Method | Path                     | Purpose                              |
| ------ | ------------------------ | ------------------------------------ |
| GET    | `/health`                | Liveness, GPU/mock status            |
| GET    | `/api/models`            | Model catalog, modes, resolutions    |
| POST   | `/api/generate`          | Enqueue a job → `202` with job id     |
| GET    | `/api/jobs/{id}`         | Poll status/progress                 |
| GET    | `/api/jobs/{id}/video`   | Download the rendered mp4            |
| POST   | `/api/jobs/{id}/cancel`  | Request cancellation                 |

Backend configuration (env): `SKYREELS_MOCK`, `SKYREELS_API_KEY`, `SKYREELS_CORS_ORIGINS`,
`SKYREELS_OUTPUT_DIR`, `SKYREELS_HOST`, `SKYREELS_PORT`, `SKYREELS_DEFAULT_OFFLOAD`.

---

## Local development

```bash
cd web
npm install
npm run dev        # http://localhost:3000  (demo mode)

# against a local backend:
SKYREELS_API_URL=http://127.0.0.1:8000 npm run dev
```

## What the UI does

- **Three modes** — Text-to-Video, Image-to-Video, and Diffusion-Forcing (long video,
  start/end-frame control).
- **Full parameter control** — model variant, resolution, duration (frames), inference
  steps, guidance scale, seed, and an advanced tray (flow shift, fps, AR step, noise
  conditioning, causal attention, prompt enhancer, TeaCache, CPU offload).
- **Live job tracking** — submit, watch staged progress, then play/download the result.
- **Session reel** — a gallery of everything rendered this session.

## Tech

Next.js 15 (App Router) · React 19 · TypeScript · zero UI-framework CSS · Fraunces + Geist.
No client secrets, no external runtime calls (a strict fit for Vercel).
