import { NextResponse } from "next/server";
import { backendFetch, isDemoMode } from "@/lib/backend";
import { DEMO_MODELS } from "@/lib/demo";

export const dynamic = "force-dynamic";

export async function GET() {
  if (isDemoMode()) {
    return NextResponse.json(DEMO_MODELS);
  }
  try {
    const res = await backendFetch("/api/models", {}, 10_000);
    const data = await res.json();
    return NextResponse.json({ ...data, demo: false }, { status: res.status });
  } catch {
    // Fall back to the static catalog so the UI still renders if the backend
    // is briefly unreachable.
    return NextResponse.json({ ...DEMO_MODELS, demo: false, degraded: true });
  }
}
