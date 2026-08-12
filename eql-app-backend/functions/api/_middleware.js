// Cloudflare Pages Function middleware — wraps every route under /api/*.
//
// This API exists purely to be called from the EQ Legends Randomizer
// desktop app (Electron), never from a same-origin web page, so CORS
// is required from the start.
//
// Bearer-token auth (not cookies) is used throughout, so a wildcard
// origin is safe here — there's no credentialed-cookie CSRF surface.

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
  };
}

export async function onRequest(context) {
  const { request, next } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const response = await next();
  const headers = new Headers(response.headers);
  const ch = corsHeaders();
  Object.keys(ch).forEach(function (key) {
    headers.set(key, ch[key]);
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: headers
  });
}
