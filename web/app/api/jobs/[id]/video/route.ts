import { NextRequest, NextResponse } from "next/server";
import { backendError, backendFetch, isDemoMode } from "@/lib/backend";
import { isDemoId } from "@/lib/demo";
import { cloudPoll, isCloud } from "@/lib/skyreelsCloud";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (isCloud() && !isDemoId(id)) {
    // The hosted result is a public URL; redirect to it.
    const job = await cloudPoll(id);
    if (job.video_url) return NextResponse.redirect(job.video_url);
    return NextResponse.json({ error: "Video not ready" }, { status: 404 });
  }

  if (isDemoId(id) || isDemoMode()) {
    return NextResponse.json(
      { error: "Demo mode has no rendered video. Connect a GPU backend to generate real mp4 output." },
      { status: 404 }
    );
  }

  try {
    const res = await backendFetch(`/api/jobs/${encodeURIComponent(id)}/video`, {}, 60_000);
    if (!res.ok || !res.body) {
      return NextResponse.json({ error: "Video not available" }, { status: res.status });
    }
    // Stream the mp4 straight through to the browser.
    return new NextResponse(res.body, {
      status: 200,
      headers: {
        "content-type": res.headers.get("content-type") || "video/mp4",
        "content-disposition": `inline; filename="skyreels_${id}.mp4"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return backendError(err);
  }
}
