// Pages Function: GET /api/blog-images (public) + POST /api/admin/blog-images (admin sync)
export async function onRequest({ request, env }) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const kv = env.USAGE_KV;

  // GET — return index
  if (request.method === 'GET') {
    if (!kv) return new Response(JSON.stringify({ images: {} }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const raw = await kv.get('blog_images_index');
    return new Response(raw || JSON.stringify({ images: {} }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400', 'CDN-Cache-Control': 'public, max-age=300' },
    });
  }

  // POST — admin sync (check auth)
  if (request.method === 'POST') {
    const auth = request.headers.get('Authorization') || '';
    if (!auth.startsWith('Bearer ') || auth.slice(7) !== (env.ADMIN_PASSWORD || 'animifyai2025')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (!kv) return new Response(JSON.stringify({ error: 'KV not available' }), { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    try {
      const body = await request.json();
      const { slug, field, imageBase64 } = body;
      if (!slug || !field || !imageBase64) return new Response(JSON.stringify({ error: 'slug, field, imageBase64 required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      await kv.put('blog_img:' + slug + ':' + field, imageBase64, { expirationTtl: 2592000 }); // 30 days

      const raw = await kv.get('blog_images_index');
      const index = raw ? JSON.parse(raw) : { images: {} };
      if (!index.images[slug]) index.images[slug] = [];
      if (!index.images[slug].includes(field)) index.images[slug].push(field);
      await kv.put('blog_images_index', JSON.stringify(index));

      return new Response(JSON.stringify({ success: true, slug, field }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
