import { NextRequest, NextResponse } from "next/server";
import { backendError, backendFetch, isDemoMode } from "@/lib/backend";
import { getDemoJob, isDemoId } from "@/lib/demo";
import { cloudPoll, isCloud } from "@/lib/skyreelsCloud";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (isCloud() && !isDemoId(id)) {
    return NextResponse.json(await cloudPoll(id));
  }

  if (isDemoId(id) || isDemoMode()) {
    const job = getDemoJob(id);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    return NextResponse.json(job);
  }

  try {
    const res = await backendFetch(`/api/jobs/${encodeURIComponent(id)}`, {}, 10_000);
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return backendError(err);
  }
}
