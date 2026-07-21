import { NextRequest, NextResponse } from "next/server";
import { backendError, backendFetch, isDemoMode } from "@/lib/backend";
import { createDemoJob } from "@/lib/demo";
import { cloudGenerate, isCloud } from "@/lib/skyreelsCloud";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Hosted SkyReels Cloud API (some modes, e.g. restyling/lip-sync, need no prompt).
  if (isCloud()) {
    const result = await cloudGenerate(body);
    return NextResponse.json(result.body, { status: result.status });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json({ error: "A prompt is required." }, { status: 422 });
  }

  if (isDemoMode()) {
    // V2 sizes by frames; V3 sizes by seconds — normalize to a frame count.
    const frames = Number(body.num_frames) || Number(body.duration) * 24 || 97;
    const job = createDemoJob({
      prompt,
      mode: (body.mode as string) || "t2v",
      resolution: (body.resolution as string) || "540P",
      frames,
      seed: (body.seed as number) ?? null,
    });
    return NextResponse.json(job, { status: 202 });
  }

  try {
    const res = await backendFetch(
      "/api/generate",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      30_000
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return backendError(err);
  }
}
