import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const healthy = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL
    && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    && process.env.APP_ENCRYPTION_KEY
  );

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      service: "afiliado-ofertas",
      timestamp: new Date().toISOString(),
    },
    {
      status: healthy ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
