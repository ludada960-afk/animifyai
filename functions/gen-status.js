// Get RunPod job status by ID
export async function onRequestGet({ request, env }) {
  const origin = request.headers.get('Origin') || '';
  const cors = {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Content-Type': 'application/json',
  };

  try {
    const url = new URL(request.url);
    const jobId = url.searchParams.get('id');
    if (!jobId) return new Response(JSON.stringify({ error: 'Missing job ID' }), { status: 400, headers: cors });

    const ep = env.RUNPOD_ENDPOINT;
    const key = env.RUNPOD_API_KEY;
    if (!ep || !key) return new Response(JSON.stringify({ error: 'Not configured' }), { status: 500, headers: cors });

    const r = await fetch(`https://api.runpod.ai/v2/${ep}/status/${jobId}`, {
      headers: { 'Authorization': 'Bearer ' + key },
    });

    const d = await r.json();

    if (d.status === 'COMPLETED' && d.output?.image) {
      return new Response(JSON.stringify({ status: 'COMPLETED', image: d.output.image, source: 'animagine-xl', elapsed: d.output.elapsed }), { status: 200, headers: cors });
    }

    return new Response(JSON.stringify({ status: d.status }), { status: 200, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}
