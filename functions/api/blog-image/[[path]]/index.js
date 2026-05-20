// Pages Function: GET /api/blog-image/:slug/:field
export async function onRequest({ request, env, params }) {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  const kv = env.USAGE_KV;
  if (!kv) return new Response('KV not available', { status: 503 });

  const pathParts = (params && params.path) || [];
  if (pathParts.length < 2) {
    return new Response('Invalid path', { status: 400 });
  }

  const key = 'blog_img:' + pathParts[0] + ':' + pathParts[1];
  const raw = await kv.get(key);
  if (!raw) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });

  // Strip data URL prefix if present (both with and without colon variants)
  let b64 = raw;
  const prefixEnd = b64.indexOf(';base64,');
  if (prefixEnd !== -1) {
    b64 = b64.substring(prefixEnd + 8); // skip ';base64,'
  }

  const binStr = atob(b64);
  const len = binStr.length;
  const buf = new ArrayBuffer(len);
  const view = new Uint8Array(buf);
  for (let i = 0; i < len; i++) {
    view[i] = binStr.charCodeAt(i);
  }

  return new Response(buf, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
