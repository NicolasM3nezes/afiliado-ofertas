import { getAuthenticatedServerClient } from "@/lib/server-auth";

const ALLOWED_IMAGE_HOST_SUFFIXES = [
  "mlstatic.com",
  "mercadolivre.com.br",
  "mercadolibre.com",
  "susercontent.com",
  "shopee.com.br",
  "shopeeusercontent.com",
  "shopeesz.com",
];

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function allowedHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return ALLOWED_IMAGE_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

export async function GET(request) {
  try {
    await getAuthenticatedServerClient(request);
    const source = new URL(request.url).searchParams.get("url") || "";
    let parsed;
    try {
      parsed = new URL(source);
    } catch {
      return Response.json({ error: "URL de imagem inválida." }, { status: 400 });
    }

    if (parsed.protocol !== "https:" || !allowedHost(parsed.hostname)) {
      return Response.json({ error: "Host de imagem não permitido." }, { status: 400 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    let response;
    try {
      response = await fetch(parsed.toString(), {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          "User-Agent": "AfiliadoOfertas/1.0",
        },
        cache: "no-store",
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      return Response.json({ error: "Não foi possível carregar a imagem do produto." }, { status: 502 });
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().startsWith("image/")) {
      return Response.json({ error: "O endereço não retornou uma imagem." }, { status: 415 });
    }

    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > MAX_IMAGE_BYTES) {
      return Response.json({ error: "Imagem muito grande para copiar." }, { status: 413 });
    }

    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      return Response.json({ error: "Imagem muito grande para copiar." }, { status: 413 });
    }

    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const status = error?.status || 401;
    return Response.json({ error: error?.message || "Não autorizado." }, { status });
  }
}
