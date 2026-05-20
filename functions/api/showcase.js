// Pages Function: GET /api/showcase (public) + POST (admin sync)
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

  // GET — return metadata (migrate base64→individual keys on first access)
  if (request.method === 'GET') {
    if (!kv) return json({ sliders: [], transforms: [] }, corsHeaders);
    const raw = await kv.get('showcase_data');
    if (!raw) return json({ sliders: [], transforms: [] }, corsHeaders);

    const data = JSON.parse(raw);
    let migrated = false;

    // Migrate sliders: extract base64 to individual KV keys
    if (data.sliders) {
      for (const s of data.sliders) {
        for (const field of ['before', 'after']) {
          const val = s[field];
          if (val && typeof val === 'string' && val.startsWith('data:')) {
            const imgKey = `showcase_img:slider:${s.id || 'idx_' + data.sliders.indexOf(s)}:${field}`;
            await kv.put(imgKey, val);
            s[field] = ''; // clear base64, replaced by URL at load time
            migrated = true;
          }
        }
      }
    }

    // Migrate transforms
    if (data.transforms) {
      for (const t of data.transforms) {
        for (const field of ['bg', 'inset']) {
          const val = t[field];
          if (val && typeof val === 'string' && val.startsWith('data:')) {
            const imgKey = `showcase_img:transform:${t.id || 'idx_' + data.transforms.indexOf(t)}:${field}`;
            await kv.put(imgKey, val);
            t[field] = '';
            migrated = true;
          }
        }
      }
    }

    // Save migrated metadata
    if (migrated) {
      await kv.put('showcase_data', JSON.stringify(data));
    }

    return json(data, corsHeaders);
  }

  // POST — admin sync
  if (request.method === 'POST') {
    const auth = request.headers.get('Authorization') || '';
    if (!auth.startsWith('Bearer ') || auth.slice(7) !== (env.ADMIN_PASSWORD || 'animifyai2025')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (!kv) return new Response(JSON.stringify({ error: 'KV not available' }), { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    try {
      const body = await request.json();
      const { sliders, transforms } = body;
      if (!sliders && !transforms) return new Response(JSON.stringify({ error: 'sliders or transforms required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      // Store images individually in KV, keep metadata separate
      if (sliders) {
        for (const s of sliders) {
          for (const field of ['before', 'after']) {
            const val = s[field];
            if (val && typeof val === 'string' && val.startsWith('data:')) {
              await kv.put(`showcase_img:slider:${s.id || 'unknown'}:${field}`, val);
              s[field] = ''; // clear from metadata
            }
          }
        }
      }
      if (transforms) {
        for (const t of transforms) {
          for (const field of ['bg', 'inset']) {
            const val = t[field];
            if (val && typeof val === 'string' && val.startsWith('data:')) {
              await kv.put(`showcase_img:transform:${t.id || 'unknown'}:${field}`, val);
              t[field] = '';
            }
          }
        }
      }

      // Merge with existing metadata
      const raw = await kv.get('showcase_data');
      const existing = raw ? JSON.parse(raw) : { sliders: [], transforms: [] };
      if (sliders) existing.sliders = sliders;
      if (transforms) existing.transforms = transforms;
      await kv.put('showcase_data', JSON.stringify(existing));

      return new Response(JSON.stringify({ success: true, sliders: existing.sliders.length, transforms: existing.transforms.length }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function json(data, extraHeaders) {
  return new Response(JSON.stringify(data), {
    headers: {
      ...extraHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=600, stale-while-revalidate=86400',
      'CDN-Cache-Control': 'public, max-age=600',
    },
  });
}
