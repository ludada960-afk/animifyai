export async function onRequest({ env }) {
  const ep = env.RUNPOD_ENDPOINT;
  const key = env.RUNPOD_API_KEY;
  try {
    const r = await fetch(`https://api.runpod.ai/v2/${ep}/health`, {
      headers: { 'Authorization': 'Bearer ' + key },
    });
    const t = await r.text();
    return new Response(JSON.stringify({
      endpoint: ep,
      keyOk: !!key,
      runpodStatus: r.status,
      runpodBody: t.slice(0, 500)
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({
      endpoint: ep,
      keyOk: !!key,
      error: e.message
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
