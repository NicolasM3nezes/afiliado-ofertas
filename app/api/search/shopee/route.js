import { NextResponse } from "next/server";

export async function GET(request) {
  const current = new URL(request.url);
  const target = new URL("/api/search/general", request.url);
  target.searchParams.set("query", String(current.searchParams.get("query") || "").trim());
  target.searchParams.set("platform", "shopee");
  return NextResponse.redirect(target, 307);
}
