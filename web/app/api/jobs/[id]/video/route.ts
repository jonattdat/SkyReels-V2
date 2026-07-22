import { NextRequest, NextResponse } from "next/server";
import { backendError, backendFetch, isDemoMode } from "@/lib/backend";
import { isDemoId } from "@/lib/demo";
import { cloudResultUrl, isCloud } from "@/lib/skyreelsCloud";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Hosted SkyReels: the result lives on an OSS bucket that blocks our browser
  // referer. Fetch it server-side (no referer is sent) and stream it back as a
  // same-origin download, so it works from any domain.
  if (isCloud() && !isDemoId(id)) {
    const url = await cloudResultUrl(id);
    if (!url) return NextResponse.json({ error: "Video not ready" }, { status: 404 });
    const range = req.headers.get("range");
    let upstream: Response;
    try {
      upstream = await fetch(url, {
        headers: range ? { range } : {},
        cache: "no-store",
      });
    } catch {
      return NextResponse.json({ error: "Could not fetch the result video." }, { status: 502 });
    }
    if (!upstream.ok && upstream.status !== 206) {
      return NextResponse.json({ error: "Result video unavailable." }, { status: 502 });
    }
    const headers = new Headers();
    headers.set("content-type", upstream.headers.get("content-type") || "video/mp4");
    const cl = upstream.headers.get("content-length");
    if (cl) headers.set("content-length", cl);
    const cr = upstream.headers.get("content-range");
    if (cr) headers.set("content-range", cr);
    headers.set("accept-ranges", "bytes");
    headers.set("content-disposition", `attachment; filename="skyreels_${id.split(".").pop()}.mp4"`);
    headers.set("cache-control", "no-store");
    return new NextResponse(upstream.body, { status: upstream.status, headers });
  }

  if (isDemoId(id) || isDemoMode()) {
    return NextResponse.json(
      { error: "Demo mode has no rendered video. Connect a backend to generate real mp4 output." },
      { status: 404 }
    );
  }

  try {
    const res = await backendFetch(`/api/jobs/${encodeURIComponent(id)}/video`, {}, 60_000);
    if (!res.ok || !res.body) {
      return NextResponse.json({ error: "Video not available" }, { status: res.status });
    }
    return new NextResponse(res.body, {
      status: 200,
      headers: {
        "content-type": res.headers.get("content-type") || "video/mp4",
        "content-disposition": `attachment; filename="skyreels_${id}.mp4"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return backendError(err);
  }
}
