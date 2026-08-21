import { NextResponse } from "next/server";
import { getAuthenticatedServerClient } from "@/lib/server-auth";

function clampLimit(value) {
  const parsed = Number(value || 30);
  if (!Number.isFinite(parsed)) return 30;
  return Math.min(Math.max(Math.trunc(parsed), 1), 100);
}

export async function GET(request) {
  try {
    const { supabase } = await getAuthenticatedServerClient(request);
    const { searchParams } = new URL(request.url);
    const limit = clampLimit(searchParams.get("limit"));

    const [searchesResult, offersResult] = await Promise.all([
      supabase
        .from("search_runs")
        .select("id,query,filters,total_found,status,error_message,started_at,completed_at,marketplace:marketplaces(slug,name)")
        .order("started_at", { ascending: false })
        .limit(limit),
      supabase
        .from("offers")
        .select("id,current_price,original_price,discount_percent,score,status,affiliate_url,found_at,created_at,product:products(title,thumbnail_url,permalink,marketplace:marketplaces(slug,name)),generated_messages(id,message_text,created_at)")
        .order("created_at", { ascending: false })
        .limit(limit),
    ]);

    if (searchesResult.error) throw searchesResult.error;
    if (offersResult.error) throw offersResult.error;

    return NextResponse.json({
      searches: searchesResult.data || [],
      offers: offersResult.data || [],
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Falha ao carregar histórico." },
      { status: error?.status || 500 }
    );
  }
}
