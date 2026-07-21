import { NextResponse } from "next/server";
import { backendFetch, isDemoMode } from "@/lib/backend";
import { DEMO_MODELS } from "@/lib/demo";
import { CLOUD_CATALOG, isCloud } from "@/lib/skyreelsCloud";

export const dynamic = "force-dynamic";

export async function GET() {
  if (isCloud()) {
    return NextResponse.json(CLOUD_CATALOG);
  }
  if (isDemoMode()) {
    return NextResponse.json(DEMO_MODELS);
  }
  try {
    const res = await backendFetch("/api/models", {}, 10_000);
    const data = await res.json();
    return NextResponse.json({ ...data, demo: false }, { status: res.status });
  } catch {
    return NextResponse.json({ ...DEMO_MODELS, demo: false, degraded: true });
  }
}
