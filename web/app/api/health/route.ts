import { NextResponse } from "next/server";
import { backendFetch, isDemoMode } from "@/lib/backend";
import { isCloud } from "@/lib/skyreelsCloud";

export const dynamic = "force-dynamic";

export async function GET() {
  if (isCloud()) {
    return NextResponse.json({
      status: "ok",
      provider: "skyreels-cloud",
      demo: false,
      mock: false,
      gpu_available: true,
      backend_configured: true,
    });
  }
  if (isDemoMode()) {
    return NextResponse.json({
      status: "ok",
      demo: true,
      mock: true,
      gpu_available: false,
      backend_configured: false,
    });
  }
  try {
    const res = await backendFetch("/health", {}, 8000);
    const data = await res.json();
    return NextResponse.json({ ...data, demo: false, backend_configured: true });
  } catch {
    return NextResponse.json(
      { status: "unreachable", demo: false, backend_configured: true },
      { status: 200 }
    );
  }
}
