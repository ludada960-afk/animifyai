// Pages Function — direct generate handler (bypasses Worker for RunPod)
export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('Origin') || '';
  const cors = {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Content-Type': 'application/json',
  };

  try {
    const body = await request.json();
    const { image, style } = body;
    if (!image || !style) return new Response(JSON.stringify({ error: 'Missing image or style' }), { status: 400, headers: cors });

    const ep = env.RUNPOD_ENDPOINT;
    const key = env.RUNPOD_API_KEY;

    if (!ep || !key) {
      return new Response(JSON.stringify({ error: 'RunPod not configured', code: 'NO_RUNPOD' }), { status: 500, headers: cors });
    }

    const r = await fetch(`https://api.runpod.ai/v2/${ep}/runsync`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: {
          image: image,
          style: style,
          quality: 'paid',
          strength: 0.75,
          guidance_scale: 7.5,
          num_steps: 6,
        },
      }),
    });

    if (!r.ok) {
      const t = await r.text();
      return new Response(JSON.stringify({ error: 'RunPod error', details: t.slice(0, 300) }), { status: 502, headers: cors });
    }

    const d = await r.json();

    if (d.status === 'COMPLETED' && d.output?.image) {
      return new Response(JSON.stringify({ image: d.output.image, source: 'animagine-xl', elapsed: d.output.elapsed }), { status: 200, headers: cors });
    }

    return new Response(JSON.stringify({ error: 'RunPod: ' + (d.status || 'unknown') }), { status: 500, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}
