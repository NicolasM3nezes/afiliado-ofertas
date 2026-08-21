import { createClient } from "@supabase/supabase-js";

export function createAuthenticatedSupabaseClient(token) {
  if (!token) {
    const error = new Error("Sessão não encontrada.");
    error.status = 401;
    throw error;
  }

  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    }
  );
}

export async function getAuthenticatedServerClient(request) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const supabase = createAuthenticatedSupabaseClient(token);

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    const authError = new Error("Sessão inválida ou expirada.");
    authError.status = 401;
    throw authError;
  }

  return { supabase, user: data.user, token };
}
