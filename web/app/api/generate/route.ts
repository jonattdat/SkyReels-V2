import { NextRequest, NextResponse } from "next/server";
import { backendError, backendFetch, isDemoMode } from "@/lib/backend";
import { createDemoJob } from "@/lib/demo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json({ error: "A prompt is required." }, { status: 422 });
  }

  if (isDemoMode()) {
    const job = createDemoJob({
      prompt,
      mode: (body.mode as string) || "t2v",
      resolution: (body.resolution as string) || "540P",
      num_frames: Number(body.num_frames) || 97,
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
