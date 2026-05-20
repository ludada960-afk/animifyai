// Catch-all proxy for Worker API endpoints (auth, payment, generate, usage, etc.)
// Forwards to Worker internally — avoids workers.dev blocking in China
const WORKER_URL = 'https://animifyai-worker.ludada960.workers.dev';

export async function onRequest({ request, env, params }) {
  const url = new URL(request.url);
  const route = (params && params.route) || [];
  const apiPath = '/api/' + route.join('/');

  // Build target URL with query string
  let targetUrl = WORKER_URL + apiPath;
  if (url.search) targetUrl += url.search;

  // Forward the request
  const headers = new Headers(request.headers);
  headers.set('X-Forwarded-Host', url.host);
  headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''));

  const resp = await fetch(targetUrl, {
    method: request.method,
    headers,
    body: request.method !== 'GET' && request.method !== 'HEAD' ? await request.text() : undefined,
  });

  // Return proxied response with CORS
  const respHeaders = new Headers(resp.headers);
  respHeaders.set('Access-Control-Allow-Origin', '*');
  respHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  respHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  return new Response(resp.body, {
    status: resp.status,
    headers: respHeaders,
  });
}
