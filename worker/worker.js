/**
 * AnimifyAI Worker v22 — Creem checkout + webhook + RunPod support
 */
const CONFIG = {
  LIFETIME_FREE: 2,
  RATE_LIMIT_WINDOW: 60000,
  RATE_LIMIT_MAX: 10,
  ABUSE_COOLDOWN_MINUTES: 30,
  ALLOWED_ORIGINS: ['https://animifyai.com','https://www.animifyai.com','https://animifyai.pages.dev','http://localhost:8788'],
  PLANS: {
    basic:   { credits: 150, type: 'subscription', monthly: 5.90, annual: 59 },
    basic_annual: { credits: 150, type: 'subscription_annual', price: 59 },
    premium: { credits: 500, type: 'subscription', monthly: 11.90, annual: 119 },
    premium_annual: { credits: 500, type: 'subscription_annual', price: 119 },
    pack50:  { credits: 50,  type: 'one_time', price: 3.90 },
    pack150: { credits: 150, type: 'one_time', price: 8.90 },
  },
  IMG_KV_TTL: 86400 * 30,
  // RunPod endpoint ID — set via env.RUNPOD_ENDPOINT (v2/{id}/runsync)
  CREEM_PRODUCTS: {
    basic:          'prod_15vtLeYfyG7nI6BcgmhJjz',
    basic_annual:   'prod_4UDix7fH3EoZ1X1YUToeVY',
    premium:        'prod_37cqIHXOc1XaYUZ2RJkOWR',
    premium_annual: 'prod_2u8P2miwKwVG09NhV5XfGe',
    pack50:         'prod_1WfKoUJ7Hk0R9EiuTcJC0E',
    pack150:        'prod_ocWNlUKX6OhhTldacJXHV',
  },
};

const STYLE_PROMPTS = {
  ghibli:    'anime art, Studio Ghibli style, soft watercolor, warm colors, hand-drawn, dreamy',
  shinkai:   'anime art, Makoto Shinkai style, cinematic lighting, luminous sky, vivid colors',
  ukiyoe:    'anime art, Japanese ukiyo-e print, bold outlines, flat colors, traditional',
  cyberpunk: 'anime art, cyberpunk, neon purple cyan, futuristic, dark moody, glowing',
  watercolor:'anime art, watercolor painting, soft pastel, delicate brush strokes, ethereal',
  chibi:     'anime art, chibi kawaii, cute big head, sparkling eyes, pastel, adorable',
};

/* ═══ Helpers ═══ */
const rateLimitMap = new Map();
let dbReady = false;

function corsHeaders(req) {
  const o = (req && req.headers && req.headers.get('Origin')) || '';
  let a = CONFIG.ALLOWED_ORIGINS[0];
  if (CONFIG.ALLOWED_ORIGINS.includes(o)) a = o;
  else if (o.includes('.animifyai.pages.dev') || o.includes('animifyai.pages.dev')) a = o;
  else if (o.startsWith('http://localhost:')) a = o;
  return {
    'Access-Control-Allow-Origin': a,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status, req) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(req) },
  });
}

function checkRateLimit(ip) {
  const now = Date.now();
  let entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) entry = { count: 0, resetAt: now + CONFIG.RATE_LIMIT_WINDOW };
  entry.count++;
  rateLimitMap.set(ip, entry);
  return entry.count <= CONFIG.RATE_LIMIT_MAX;
}

function ab2b64(b) {
  const u = new Uint8Array(b);
  let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
}

function b642uint8(b) {
  const r = atob(b), u = new Uint8Array(r.length);
  for (let i = 0; i < r.length; i++) u[i] = r.charCodeAt(i);
  return u;
}

function b642ab(b) {
  const prefixEnd = b.indexOf(';base64,');
  const raw = prefixEnd !== -1 ? b.substring(prefixEnd + 8) : b;
  return b642uint8(raw).buffer;
}

async function hashStr(s) {
  return ab2b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

function todayKey() {
  const d = new Date();
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}

/* ═══ D1 Init ═══ */
async function ensureDB(env) {
  if (dbReady || !env.DB) return;
  try {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY, name TEXT, picture TEXT, password_hash TEXT, avatar TEXT,
      credits INTEGER DEFAULT 0, plan TEXT DEFAULT 'free',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run();
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS tokens (
      token TEXT PRIMARY KEY, email TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (email) REFERENCES users(email)
    )`).run();
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS ip_usage (
      ip TEXT NOT NULL, date TEXT NOT NULL, count INTEGER DEFAULT 1,
      PRIMARY KEY (ip, date)
    )`).run();
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS flux_state (
      date TEXT PRIMARY KEY, exhausted INTEGER NOT NULL DEFAULT 1
    )`).run();
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS free_usage (
      fp TEXT PRIMARY KEY, count INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run();
    dbReady = true;
  } catch (e) {
    console.error('D1 init failed:', e.message);
  }
}

/* ═══ D1 Data Layer (users / tokens / ip / flux) ═══ */
async function userByEmail(email, env) {
  if (!env.DB) return null;
  return await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email.toLowerCase()).first();
}

async function userByToken(token, env) {
  if (!env.DB) return null;
  const t = await env.DB.prepare('SELECT email FROM tokens WHERE token = ?').bind(token).first();
  if (!t) return null;
  return await userByEmail(t.email, env);
}

async function upsertUser(email, fields, env) {
  if (!env.DB) return;
  const em = email.toLowerCase();
  const existing = await userByEmail(em, env);
  if (existing) {
    const sets = [], vals = [];
    for (const [k, v] of Object.entries(fields)) { sets.push(k + ' = ?'); vals.push(v); }
    vals.push(em);
    await env.DB.prepare('UPDATE users SET ' + sets.join(', ') + ' WHERE email = ?').bind(...vals).run();
  } else {
    const keys = ['email'], placeholders = ['?'], vals = [em];
    for (const [k, v] of Object.entries(fields)) { keys.push(k); placeholders.push('?'); vals.push(v); }
    if (!keys.includes('created_at')) { keys.push('created_at'); placeholders.push('?'); vals.push(new Date().toISOString()); }
    if (!keys.includes('last_login')) { keys.push('last_login'); placeholders.push('?'); vals.push(new Date().toISOString()); }
    await env.DB.prepare('INSERT INTO users (' + keys.join(', ') + ') VALUES (' + placeholders.join(', ') + ')').bind(...vals).run();
  }
}

async function createToken(email, env) {
  if (!env.DB) return 'demo';
  const tk = ab2b64(crypto.getRandomValues(new Uint8Array(24)));
  await env.DB.prepare('INSERT OR REPLACE INTO tokens (token, email, created_at) VALUES (?, ?, ?)').bind(tk, email.toLowerCase(), new Date().toISOString()).run();
  return tk;
}

async function ipUsageGet(ip, env) {
  if (!env.DB) return 0;
  const r = await env.DB.prepare('SELECT count FROM ip_usage WHERE ip = ? AND date = ?').bind(ip, todayKey()).first();
  return r ? r.count : 0;
}

async function ipUsageIncrement(ip, env) {
  if (!env.DB) return;
  await env.DB.prepare('INSERT INTO ip_usage (ip, date, count) VALUES (?, ?, 1) ON CONFLICT(ip, date) DO UPDATE SET count = count + 1').bind(ip, todayKey()).run();
}

async function fluxIsExhausted(env) {
  if (!env.DB) return false;
  const r = await env.DB.prepare('SELECT exhausted FROM flux_state WHERE date = ?').bind(todayKey()).first();
  return r ? !!r.exhausted : false;
}

async function fluxMarkExhausted(env) {
  if (!env.DB) return;
  await env.DB.prepare('INSERT OR REPLACE INTO flux_state (date, exhausted) VALUES (?, 1)').bind(todayKey()).run();
}

/* ═══ Auth ═══ */
async function verifyGoogleToken(idToken, env) {
  try {
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + idToken);
    if (!r.ok) return null;
    const p = await r.json();
    const cid = env.GOOGLE_CLIENT_ID || '';
    if (cid && p.aud !== cid) return null;
    return { email: p.email, name: p.name || p.email.split('@')[0], picture: p.picture || '' };
  } catch { return null; }
}

async function verifyGoogleAccessToken(accessToken) {
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { 'Authorization': 'Bearer ' + accessToken },
    });
    if (!r.ok) return null;
    const p = await r.json();
    return { email: p.email, name: p.name || p.email.split('@')[0], picture: p.picture || '' };
  } catch { return null; }
}

async function getUserFromToken(req, env) {
  const a = req.headers.get('Authorization') || '';
  if (!a.startsWith('Bearer ')) return null;
  const token = a.slice(7);
  if (env.DB) {
    await ensureDB(env);
    return await userByToken(token, env);
  }
  // KV fallback
  if (!env.USAGE_KV) return null;
  const email = await env.USAGE_KV.get('token:' + token);
  if (!email) return null;
  const raw = await env.USAGE_KV.get('user:' + email);
  return raw ? JSON.parse(raw) : null;
}

async function handleAuth(req, env, mode) {
  await ensureDB(env);
  const db = env.DB;
  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid request' }, 400, req); }

  // Google OAuth (ID token from One Tap)
  if (body.googleToken) {
    const gu = await verifyGoogleToken(body.googleToken, env);
    if (!gu) return json({ error: 'Google verification failed' }, 401, req);
    const em = gu.email.toLowerCase();
    if (db) {
      await upsertUser(em, { name: gu.name, picture: gu.picture, last_login: new Date().toISOString() }, env);
      const tk = await createToken(em, env);
      const u = await userByEmail(em, env);
      return json({ email: u.email, name: u.name, picture: u.picture, token: tk, credits: u.credits, plan: u.plan }, 200, req);
    }
    return json({ email: em, name: gu.name, token: 'demo', credits: 0, plan: 'free' }, 200, req);
  }

  // Google OAuth (access_token from popup)
  if (body.googleAccessToken) {
    const gu = await verifyGoogleAccessToken(body.googleAccessToken);
    if (!gu) return json({ error: 'Google verification failed' }, 401, req);
    const em = gu.email.toLowerCase();
    if (db) {
      await upsertUser(em, { name: gu.name, picture: gu.picture, last_login: new Date().toISOString() }, env);
      const tk = await createToken(em, env);
      const u = await userByEmail(em, env);
      return json({ email: u.email, name: u.name, picture: u.picture, token: tk, credits: u.credits, plan: u.plan }, 200, req);
    }
    return json({ email: em, name: gu.name, token: 'demo', credits: 0, plan: 'free' }, 200, req);
  }

  // Email/Password
  const { email, password } = body;
  if (!email || !password) return json({ error: 'Email and password required' }, 400, req);
  const ph = await hashStr(password);
  const em = email.toLowerCase();

  if (mode === 'register') {
    if (db) {
      if (await userByEmail(em, env)) return json({ error: 'Account exists. Try Google login?' }, 409, req);
      await upsertUser(em, { password_hash: ph }, env);
      const tk = await createToken(em, env);
      return json({ email: em, token: tk, credits: 0, plan: 'free' }, 200, req);
    }
    return json({ email, token: 'demo', credits: 0, plan: 'free' }, 200, req);
  }

  if (db) {
    const u = await userByEmail(em, env);
    if (!u) return json({ error: 'Account not found' }, 404, req);
    if (u.password_hash && u.password_hash !== ph) return json({ error: 'Invalid password' }, 401, req);
    await upsertUser(em, { last_login: new Date().toISOString() }, env);
    const tk = await createToken(em, env);
    return json({ email: u.email, token: tk, credits: u.credits, plan: u.plan }, 200, req);
  }
  return json({ email, token: 'demo', credits: 0, plan: 'free' }, 200, req);
}

async function handleGitHubAuth(req, env) {
  await ensureDB(env);
  const { code } = await req.json();
  if (!code) return json({ error: 'No code provided' }, 400, req);
  const cid = env.GITHUB_CLIENT_ID, cs = env.GITHUB_CLIENT_SECRET;
  if (!cid || !cs) return json({ error: 'GitHub OAuth not configured' }, 503, req);

  const tr = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: cid, client_secret: cs, code }),
  });
  const td = await tr.json();
  if (td.error) return json({ error: 'GitHub: ' + td.error_description }, 400, req);

  const ur = await fetch('https://api.github.com/user', {
    headers: { 'Authorization': 'Bearer ' + td.access_token, 'User-Agent': 'AnimifyAI' },
  });
  const ud = await ur.json();
  if (!ud.login) return json({ error: 'GitHub user fetch failed' }, 400, req);

  let email = ud.email;
  if (!email) {
    const er = await fetch('https://api.github.com/user/emails', {
      headers: { 'Authorization': 'Bearer ' + td.access_token, 'User-Agent': 'AnimifyAI' },
    });
    const ems = await er.json();
    if (Array.isArray(ems)) { const p = ems.find(e => e.primary) || ems[0]; email = p?.email; }
  }
  if (!email) email = ud.login + '@github.users';

  const em = email.toLowerCase();
  if (env.DB) {
    await upsertUser(em, { name: ud.name || ud.login, avatar: ud.avatar_url, last_login: new Date().toISOString() }, env);
    const tk = await createToken(em, env);
    const u = await userByEmail(em, env);
    return json({ email: u.email, name: u.name, avatar: u.avatar, token: tk, credits: u.credits, plan: u.plan }, 200, req);
  }
  return json({ email: em, name: ud.name || ud.login, avatar: ud.avatar_url, token: 'demo', credits: 0, plan: 'free' }, 200, req);
}

/* ═══ Image Generation — paid=Klein, free=Schnell ═══ */
async function generateWithFlux(imgB64, stylePrompt, env, opts, paid) {
  const tok = env.CF_API_TOKEN;
  if (!tok) throw new Error('CF_API_TOKEN not configured');

  const quality = paid ? ', masterpiece, anime illustration, high quality, detailed' : ', anime style';
  const prompt = stylePrompt + quality;
  let w = 1024, h = 1024;
  if (opts?.width && opts?.height) {
    w = opts.width; h = opts.height;
    const max = paid ? 1024 : 768;
    if (w > max || h > max) { const r = Math.min(max / w, max / h); w = Math.round(w * r); h = Math.round(h * r); }
  }

  const accountUrl = 'https://api.cloudflare.com/client/v4/accounts/68e776bf8925253276ab30cca4971ca1/ai/run/';
  let url, body, headers;

  if (paid) {
    // Klein 4B: FormData img2img
    const ib = b642uint8(imgB64);
    const fd = new FormData();
    fd.append('prompt', prompt);
    fd.append('input_image_0', new Blob([ib], { type: 'image/jpeg' }), 'photo.jpg');
    fd.append('num_steps', '4');
    fd.append('width', String(w));
    fd.append('height', String(h));
    url = accountUrl + '@cf/black-forest-labs/flux-2-klein-4b';
    body = fd;
    headers = { 'Authorization': 'Bearer ' + tok };
  } else {
    // Schnell: also FormData (same Flux family)
    const ib = b642uint8(imgB64);
    const fd = new FormData();
    fd.append('prompt', prompt);
    fd.append('input_image_0', new Blob([ib], { type: 'image/jpeg' }), 'photo.jpg');
    fd.append('num_steps', '2');
    if (opts?.width && opts?.height) { fd.append('width', String(w)); fd.append('height', String(h)); }
    url = accountUrl + '@cf/black-forest-labs/flux-1-schnell';
    body = fd;
    headers = { 'Authorization': 'Bearer ' + tok };
  }

  const r = await fetch(url, { method: 'POST', headers, body });

  const ct = r.headers.get('Content-Type') || '';
  if (ct.includes('image/')) {
    return { imageBase64: ab2b64(await r.arrayBuffer()), source: paid ? 'klein' : 'schnell' };
  }

  const t = await r.text();
  if (!r.ok) throw new Error('Flux ' + r.status + ': ' + t.slice(0, 200));

  const d = JSON.parse(t);
  if (d.success && d.result?.image) return { imageBase64: d.result.image, source: paid ? 'klein' : 'schnell' };

  const errDetail = d.errors ? JSON.stringify(d.errors).slice(0, 300) : t.slice(0, 200);
  throw new Error('Flux: ' + errDetail);
}

async function generateWithRunpod(imgB64, style, env, paid) {
  const ep = env.RUNPOD_ENDPOINT;
  const key = env.RUNPOD_API_KEY;
  if (!ep || !key) throw new Error('RunPod not configured');
  const q = paid ? 'paid' : 'free';
  const r = await fetch(`https://api.runpod.ai/v2/${ep}/runsync`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: {
        image: imgB64,
        style: style,
        quality: q,
        strength: 0.75,
        guidance_scale: 7.5,
        num_steps: paid ? 6 : 4,
      },
    }),
  });
  if (!r.ok) { const t = await r.text(); throw new Error('RunPod ' + r.status + ': ' + t.slice(0, 200)); }
  const d = await r.json();
  if (d.status === 'COMPLETED' && d.output?.image) return { imageBase64: d.output.image, source: 'animagine-xl' };
  if (d.status === 'FAILED') throw new Error('RunPod failed: ' + (d.error || 'unknown').slice(0, 200));
  throw new Error('RunPod: ' + JSON.stringify(d).slice(0, 200));
}

async function saveImage(imageBase64, style, source, kv) {
  if (!kv) return null;
  try {
    const id = crypto.randomUUID();
    await kv.put('img:' + id, JSON.stringify({ imageBase64, style, source, createdAt: Date.now() }), { expirationTtl: CONFIG.IMG_KV_TTL });
    return id;
  } catch (e) { console.error('saveImage error:', e.message); return null; }
}

async function handleGenerate(req, env) {
  await ensureDB(env);
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';

  if (!checkRateLimit(ip)) return json({ error: 'Too many requests. Slow down.', code: 'RATE_LIMITED' }, 429, req);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid request' }, 400, req); }
  const { image, style, fingerprint, width, height } = body;
  if (!image) return json({ error: 'No image provided' }, 400, req);
  if (!style || !STYLE_PROMPTS[style]) return json({ error: 'Invalid style' }, 400, req);

  const user = await getUserFromToken(req, env);
  const kv = env.USAGE_KV;

  // Free or paid?
  const isPaid = !!(user && (user.credits > 0 || user.plan !== 'free'));

  if (!isPaid) {
    // Free trial: check lifetime limit
    if (env.DB) {
      const fp = fingerprint || ip;
      const r = await env.DB.prepare('SELECT count FROM free_usage WHERE fp = ?').bind(fp).first();
      if (r && r.count >= CONFIG.LIFETIME_FREE) {
        return json({ error: 'You have used all 2 free generations. Upgrade to continue.', code: 'NO_FREE' }, 402, req);
      }
      if (await fluxIsExhausted(env)) {
        return json({ error: 'Service at capacity. Please upgrade or try later.', code: 'FLUX_EXHAUSTED' }, 402, req);
      }
    }
  }

  const prompt = STYLE_PROMPTS[style];
  let result;
  try {
    // Prefer RunPod if configured, fall back to CF Workers AI
    if (env.RUNPOD_ENDPOINT && env.RUNPOD_API_KEY) {
      result = await generateWithRunpod(image, style, env, isPaid);
    } else {
      result = await generateWithFlux(image, prompt, env, { width, height }, isPaid);
    }
  } catch (e) {
    const msg = e.message || '';
    if (msg.includes('429') || msg.includes('quota') || msg.includes('exceeded') || msg.includes('limit') || msg.includes('capacity')) {
      if (env.DB) await fluxMarkExhausted(env);
      else if (kv) await markFluxExhausted(kv);
      return json({ error: 'Service at capacity. Free tier temporarily unavailable. Please upgrade or try later.', code: 'FLUX_EXHAUSTED' }, 402, req);
    }
    // If RunPod fails, try fallback to CF Klein
    if (env.RUNPOD_ENDPOINT && !msg.includes('RunPod not configured')) {
      try {
        result = await generateWithFlux(image, prompt, env, { width, height }, isPaid);
      } catch (e2) {
        return json({ error: 'AI engine unavailable. Please try again in a moment.', details: e2.message }, 503, req);
      }
    }
    if (!result) return json({ error: 'AI engine unavailable. Please try again in a moment.', details: msg }, 503, req);
  }

  const imageId = await saveImage(result.imageBase64, style, result.source, kv);
  const imageUrl = imageId ? new URL(req.url).origin + '/api/image/' + imageId : null;

  let remaining = null;
  if (isPaid && env.DB) {
    await env.DB.prepare('UPDATE users SET credits = credits - 1 WHERE email = ?').bind(user.email.toLowerCase()).run();
    remaining = user.credits - 1;
  } else if (env.DB) {
    const fp = fingerprint || ip;
    await env.DB.prepare('INSERT INTO free_usage (fp, count, created_at) VALUES (?, 1, ?) ON CONFLICT(fp) DO UPDATE SET count = count + 1').bind(fp, new Date().toISOString()).run();
    const r = await env.DB.prepare('SELECT count FROM free_usage WHERE fp = ?').bind(fp).first();
    remaining = Math.max(0, CONFIG.LIFETIME_FREE - (r ? r.count : 0));
  } else if (kv) {
    if (user) { /* handled above */ }
    else {
      await incrementIPUsage(ip, kv);
      const newUsed = await getIPUsage(ip, kv);
      remaining = Math.max(0, CONFIG.LIFETIME_FREE - newUsed);
    }
  }

  return json({ success: true, image: result.imageBase64, imageUrl, source: result.source, remaining }, 200, req);
}

/* ═══ KV Fallbacks (for environments without D1) ═══ */
async function getIPUsage(ip, kv) {
  if (!kv) return 0;
  const key = 'daily:ip:' + ip + ':' + todayKey();
  return parseInt(await kv.get(key) || '0');
}

async function incrementIPUsage(ip, kv) {
  if (!kv) return;
  const key = 'daily:ip:' + ip + ':' + todayKey();
  const used = parseInt(await kv.get(key) || '0');
  await kv.put(key, String(used + 1), { expirationTtl: 86400 + 3600 });
}

async function markFluxExhausted(kv) {
  if (!kv) return;
  const key = 'flux_exhausted:' + todayKey();
  await kv.put(key, '1', { expirationTtl: 86400 + 3600 });
}

/* ═══ Image Serving ═══ */
async function handleImage(req, env, id) {
  const kv = env.USAGE_KV;
  if (!kv) return new Response('Not found', { status: 404 });
  const raw = await kv.get('img:' + id);
  if (!raw) return new Response('Image not found or expired', { status: 404 });
  try {
    const data = JSON.parse(raw);
    return new Response(b642ab(data.imageBase64), {
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public,max-age=86400', ...corsHeaders(req) },
    });
  } catch { return new Response('Invalid image', { status: 500 }); }
}

/* ═══ PayPal ═══ */
function paypalBase(env) {
  return (env && env.PAYPAL_LIVE === 'true') ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

async function paypalToken(env) {
  const cid = (env && env.PAYPAL_CLIENT_ID) || 'AcR5wNDrRwYKfuX9c1y7q6qiZcHsuX6o3cWeKYQvjrczxHjuUCc4mePY6tEQ0EhfmpdlY2KjImUH5h9E';
  const cs = (env && env.PAYPAL_CLIENT_SECRET) || 'ELhFvWtz1geWLJZEa0s5UJxQFUkMs2ERCUAUWTRtkSzXWvrEKYjDhv8CvVEPGnJx3xfBejp_KtzOs2TM';
  const r = await fetch(paypalBase(env) + '/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Authorization': 'Basic ' + btoa(cid + ':' + cs),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) { const t = await r.text(); throw new Error('PayPal auth failed: ' + r.status + ' ' + t.slice(0, 200)); }
  const d = await r.json();
  return d.access_token;
}

async function handlePayPalOrder(req, env) {
  try {
    let body;
    try { body = await req.json(); } catch { return json({ error: 'Invalid' }, 400, req); }
    const { plan, email } = body;
    if (!plan || !CONFIG.PLANS[plan]) return json({ error: 'Invalid plan' }, 400, req);

    let amount, desc;
    if (plan === 'basic') { amount = '5.90'; desc = 'AnimifyAI Basic - 150 credits/month'; }
    else if (plan === 'basic_annual') { amount = '59.00'; desc = 'AnimifyAI Basic Annual - 150 credits/month'; }
    else if (plan === 'premium') { amount = '11.90'; desc = 'AnimifyAI Premium - 500 credits/month'; }
    else if (plan === 'premium_annual') { amount = '119.00'; desc = 'AnimifyAI Premium Annual - 500 credits/month'; }
    else if (plan === 'pack50') { amount = '3.90'; desc = 'AnimifyAI 50 Credit Pack'; }
    else if (plan === 'pack150') { amount = '8.90'; desc = 'AnimifyAI 150 Credit Pack'; }

    const token = await paypalToken(env);
    const r = await fetch(paypalBase(env) + '/v2/checkout/orders', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{ amount: { currency_code: 'USD', value: amount }, description: desc }],
        payment_source: {
          paypal: {
            experience_context: {
              payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED',
              landing_page: 'LOGIN',
              user_action: 'PAY_NOW',
              return_url: 'https://animifyai.com/en/?payment=success',
              cancel_url: 'https://animifyai.com/en/pricing/',
            },
          },
        },
      }),
    });
    const d = await r.json();
    if (d.id) {
      const approveUrl = d.links?.find(l => l.rel === 'payer-action')?.href || d.links?.find(l => l.rel === 'approve')?.href || '';
      return json({ orderID: d.id, approveUrl }, 200, req);
    }
    return json({ error: d.message || 'PayPal order failed' }, 400, req);
  } catch (e) { return json({ error: e.message }, 503, req); }
}

async function handlePayPalCapture(req, env) {
  await ensureDB(env);
  try {
    let body;
    try { body = await req.json(); } catch { return json({ error: 'Invalid' }, 400, req); }
    const { orderID, plan, email } = body;
    if (!orderID) return json({ error: 'No orderID' }, 400, req);

    const token = await paypalToken(env);
    const r = await fetch(paypalBase(env) + '/v2/checkout/orders/' + orderID + '/capture', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    });
    const d = await r.json();

    if (d.status === 'COMPLETED' && plan && CONFIG.PLANS[plan]) {
      const em = (email || d.payer?.email_address || '').toLowerCase();
      if (em) {
        if (env.DB) {
          await upsertUser(em, {}, env);
          await env.DB.prepare('UPDATE users SET credits = credits + ? WHERE email = ?').bind(CONFIG.PLANS[plan].credits, em).run();
          if (CONFIG.PLANS[plan].type === 'subscription') {
            await env.DB.prepare('UPDATE users SET plan = ? WHERE email = ?').bind(plan, em).run();
          }
        } else if (env.USAGE_KV) {
          const ur = await env.USAGE_KV.get('user:' + em);
          if (ur) {
            const u = JSON.parse(ur);
            u.credits += CONFIG.PLANS[plan].credits;
            if (CONFIG.PLANS[plan].type === 'subscription') u.plan = plan;
            await env.USAGE_KV.put('user:' + em, JSON.stringify(u), { expirationTtl: 86400 * 365 });
          }
        }
      }
    }
    return json({ status: d.status, id: d.id }, 200, req);
  } catch (e) { return json({ error: e.message }, 503, req); }
}

/* ═══ Creem ═══ */
function creemSecret(env) {
  return (env && env.CREEM_SECRET) || 'creem_4qfekyg7KdpuBknKg739KO';
}

function creemSig(env) {
  return (env && env.CREEM_WEBHOOK_SECRET) || '';
}

async function handleCreemCheckout(req, env) {
  try {
    let body;
    try { body = await req.json(); } catch { return json({ error: 'Invalid' }, 400, req); }
    const { plan, email } = body;
    if (!plan || !CONFIG.PLANS[plan]) return json({ error: 'Invalid plan' }, 400, req);
    const pid = CONFIG.CREEM_PRODUCTS[plan];
    if (!pid) return json({ error: 'No product mapping' }, 400, req);

    const r = await fetch('https://api.creem.io/v1/checkouts', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + creemSecret(env),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        product_id: pid,
        success_url: 'https://animifyai.com/en/payment/success/',
        cancel_url: 'https://animifyai.com/en/payment/cancel/',
        metadata: { email: (email || '').toLowerCase() },
      }),
    });
    const d = await r.json();
    if (d.checkout_url) return json({ url: d.checkout_url }, 200, req);
    return json({ error: d.message || 'Creem checkout failed' }, 400, req);
  } catch (e) { return json({ error: e.message }, 503, req); }
}

async function handleCreemWebhook(req, env) {
  try {
    const raw = await req.text();
    const sig = req.headers.get('creem-signature') || '';
    const secret = creemSig(env);

    // Verify webhook signature if secret is set
    if (secret) {
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
      const ok = await crypto.subtle.verify('HMAC', key, hex2buf(sig), new TextEncoder().encode(raw));
      if (!ok) return new Response('Invalid signature', { status: 401 });
    }

    const ev = JSON.parse(raw);
    if (ev.event === 'checkout.completed' || ev.event === 'subscription.paid' || ev.event === 'subscription.active') {
      const pid = ev.data?.product_id;
      const email = (ev.data?.customer?.email || ev.data?.metadata?.email || '').toLowerCase();
      if (!pid || !email) return new Response('Missing data', { status: 200 });

      // Find plan by product ID
      let plan = null;
      for (const [k, v] of Object.entries(CONFIG.CREEM_PRODUCTS)) {
        if (v === pid) { plan = k; break; }
      }
      if (!plan || !CONFIG.PLANS[plan]) return new Response('Unknown product', { status: 200 });

      if (env.DB) {
        await ensureDB(env);
        await upsertUser(email, {}, env);
        await env.DB.prepare('UPDATE users SET credits = credits + ? WHERE email = ?').bind(CONFIG.PLANS[plan].credits, email).run();
        if (CONFIG.PLANS[plan].type === 'subscription' || CONFIG.PLANS[plan].type === 'subscription_annual') {
          await env.DB.prepare('UPDATE users SET plan = ? WHERE email = ?').bind(plan, email).run();
        }
      }
      console.log('[creem] Credited ' + email + ' with ' + CONFIG.PLANS[plan].credits + ' credits (' + plan + ')');
    }
    return new Response('OK', { status: 200 });
  } catch (e) { return new Response('Webhook error: ' + e.message, { status: 200 }); }
}

function hex2buf(hex) {
  const len = hex.length / 2;
  const buf = new Uint8Array(len);
  for (let i = 0; i < len; i++) buf[i] = parseInt(hex.substr(i * 2, 2), 16);
  return buf.buffer;
}

/* ═══ Blog Images (KV-backed) ═══ */
async function handleBlogImagesIndex(req, env) {
  const kv = env.USAGE_KV;
  if (!kv) return json({ images: {} }, 200, req);
  const raw = await kv.get('blog_images_index');
  return json(raw ? JSON.parse(raw) : { images: {} }, 200, req);
}

async function handleBlogImageServe(req, env, slug, slot) {
  const kv = env.USAGE_KV;
  if (!kv) return new Response('Not found', { status: 404 });
  const raw = await kv.get('blog_img:' + slug + ':' + slot);
  if (!raw) return new Response('Not found', { status: 404 });
  return new Response(b642ab(raw), {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public,max-age=86400', ...corsHeaders(req) },
  });
}

async function handleShowcaseImageServe(req, env, type, id, field) {
  const kv = env.USAGE_KV;
  if (!kv) return new Response('Not found', { status: 404 });
  const raw = await kv.get('showcase_img:' + type + ':' + id + ':' + field);
  if (!raw) return new Response('Not found', { status: 404 });
  return new Response(b642ab(raw), {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public,max-age=86400', ...corsHeaders(req) },
  });
}

async function handleAdminBlogImages(req, env) {
  const kv = env.USAGE_KV;
  if (!kv) return json({ error: 'KV not available' }, 503, req);
  const body = await req.json();
  const { slug, field, imageBase64 } = body;
  if (!slug || !field || !imageBase64) return json({ error: 'slug, field, imageBase64 required' }, 400, req);

  await kv.put('blog_img:' + slug + ':' + field, imageBase64, { expirationTtl: CONFIG.IMG_KV_TTL });

  const raw = await kv.get('blog_images_index');
  const index = raw ? JSON.parse(raw) : { images: {} };
  if (!index.images[slug]) index.images[slug] = [];
  if (!index.images[slug].includes(field)) index.images[slug].push(field);
  await kv.put('blog_images_index', JSON.stringify(index));

  return json({ success: true, slug, field }, 200, req);
}

/* ═══ Showcase Data (KV-backed) ═══ */
async function handleShowcaseData(req, env) {
  const kv = env.USAGE_KV;
  if (!kv) return json({ sliders: [], transforms: [] }, 200, req);
  const raw = await kv.get('showcase_data');
  return json(raw ? JSON.parse(raw) : { sliders: [], transforms: [] }, 200, req);
}

async function handleAdminShowcase(req, env) {
  const kv = env.USAGE_KV;
  if (!kv) return json({ error: 'KV not available' }, 503, req);
  const body = await req.json();
  const { sliders, transforms } = body;
  if (!sliders && !transforms) return json({ error: 'sliders or transforms required' }, 400, req);

  if (sliders) {
    for (const s of sliders) {
      for (const field of ['before', 'after']) {
        const val = s[field];
        if (val && typeof val === 'string' && val.startsWith('data:')) {
          await kv.put('showcase_img:slider:' + (s.id || 'unknown') + ':' + field, val);
          s[field] = '';
        }
      }
    }
  }
  if (transforms) {
    for (const t of transforms) {
      for (const field of ['bg', 'inset']) {
        const val = t[field];
        if (val && typeof val === 'string' && val.startsWith('data:')) {
          await kv.put('showcase_img:transform:' + (t.id || 'unknown') + ':' + field, val);
          t[field] = '';
        }
      }
    }
  }

  const raw = await kv.get('showcase_data');
  const existing = raw ? JSON.parse(raw) : { sliders: [], transforms: [] };
  if (sliders) existing.sliders = sliders;
  if (transforms) existing.transforms = transforms;
  await kv.put('showcase_data', JSON.stringify(existing));

  return json({ success: true, sliders: existing.sliders.length, transforms: existing.transforms.length }, 200, req);
}

/* ═══ Usage / Admin / Media ═══ */
async function handleUsage(req, env) {
  await ensureDB(env);
  const user = await getUserFromToken(req, env);
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const fp = body.fingerprint || ip;

  if (user && (user.credits > 0 || user.plan !== 'free')) {
    return json({ remaining: user.credits, plan: user.plan, authenticated: true, model: 'credits' }, 200, req);
  }

  // Free tier (unauthenticated OR logged-in with no credits)
  if (env.DB) {
    const r = await env.DB.prepare('SELECT count FROM free_usage WHERE fp = ?').bind(fp).first();
    const used = r ? r.count : 0;
    const exhausted = await fluxIsExhausted(env);
    const remaining = exhausted ? 0 : Math.max(0, CONFIG.LIFETIME_FREE - used);
    return json({ remaining, fluxExhausted: exhausted, authenticated: !!user, model: 'lifetime', lifetimeMax: CONFIG.LIFETIME_FREE }, 200, req);
  }

  return json({ remaining: CONFIG.LIFETIME_FREE, fluxExhausted: false, authenticated: !!user, model: 'lifetime', lifetimeMax: CONFIG.LIFETIME_FREE }, 200, req);
}

async function handleAdmin(req, env, path) {
  await ensureDB(env);
  const a = req.headers.get('Authorization') || '';
  if (!a.startsWith('Bearer ') || a.slice(7) !== (env.ADMIN_PASSWORD || 'animifyai2025'))
    return json({ error: 'Unauthorized' }, 401, req);

  const kv = env.USAGE_KV;

  if (path === '/api/admin/posts' && req.method === 'GET') {
    const list = await kv.list({ prefix: 'blog:' });
    const posts = [];
    for (const k of list.keys) { const v = await kv.get(k.name); if (v) posts.push(JSON.parse(v)); }
    return json({ posts }, 200, req);
  }
  if (path === '/api/admin/posts' && req.method === 'POST') {
    const p = await req.json();
    if (!p.slug || !p.title) return json({ error: 'slug + title required' }, 400, req);
    p.updatedAt = new Date().toISOString();
    p.createdAt = p.createdAt || p.updatedAt;
    await kv.put('blog:' + p.slug, JSON.stringify(p));
    return json({ success: true, post: p }, 200, req);
  }
  if (path.startsWith('/api/admin/posts/') && req.method === 'DELETE') {
    await kv.delete('blog:' + path.replace('/api/admin/posts/', ''));
    return json({ success: true }, 200, req);
  }

  if (path === '/api/admin/upload' && req.method === 'POST') {
    const { filename, data, folder } = await req.json();
    if (!filename || !data) return json({ error: 'filename + data required' }, 400, req);
    await kv.put('media:' + (folder || 'uploads') + '/' + filename, data);
    return json({ success: true, url: '/api/media/' + (folder || 'uploads') + '/' + filename }, 200, req);
  }
  if (path === '/api/admin/media' && req.method === 'GET') {
    const list = await kv.list({ prefix: 'media:' });
    const items = list.keys.map(x => ({
      key: x.name,
      path: '/api/' + x.name.replace(':', '/'),
      name: x.name.split('/').pop(),
      folder: x.name.replace('media:', '').split('/')[0],
    }));
    return json({ items }, 200, req);
  }
  if (path.startsWith('/api/admin/media/') && req.method === 'DELETE') {
    await kv.delete('media:' + path.replace('/api/admin/media/', ''));
    return json({ success: true }, 200, req);
  }

  if (path === '/api/admin/stats') {
    const day = todayKey();
    let totalUsers = 0, activeSessions = 0, totalPosts = 0, fluxExhausted = false;

    if (env.DB) {
      const uc = await env.DB.prepare('SELECT COUNT(*) as c FROM users').first();
      totalUsers = uc ? uc.c : 0;
      const sc = await env.DB.prepare('SELECT COUNT(*) as c FROM tokens').first();
      activeSessions = sc ? sc.c : 0;
      const fe = await env.DB.prepare('SELECT exhausted FROM flux_state WHERE date = ?').bind(day).first();
      fluxExhausted = fe ? !!fe.exhausted : false;
    }
    if (kv) {
      const posts = await kv.list({ prefix: 'blog:' });
      totalPosts = posts.keys.length;
      if (!env.DB) {
        const users = await kv.list({ prefix: 'user:' });
        const sessions = await kv.list({ prefix: 'token:' });
        totalUsers = users.keys.length;
        activeSessions = sessions.keys.length;
        fluxExhausted = !!(await kv.get('flux_exhausted:' + day));
      }
    }

    return json({
      totalUsers, activeSessions, totalPosts, fluxExhausted,
      dailyFreePerIP: CONFIG.LIFETIME_FREE,
    }, 200, req);
  }

  if (path === '/api/admin/reset-usage' && req.method === 'POST') {
    const { ip } = await req.json();
    const day = todayKey();
    if (env.DB) {
      await env.DB.prepare('DELETE FROM ip_usage WHERE ip = ? AND date = ?').bind(ip || '', day).run();
    }
    if (kv) {
      await kv.delete('daily:ip:' + (ip || '') + ':' + day);
    }
    return json({ success: true, cleared: 'daily:ip:' + (ip || '') + ':' + day }, 200, req);
  }

  if (path === '/api/admin/blog-images' && req.method === 'POST') return handleAdminBlogImages(req, env);
  if (path === '/api/admin/showcase' && req.method === 'POST') return handleAdminShowcase(req, env);

  return json({ error: 'Not found' }, 404, req);
}

async function handleMedia(req, env, path) {
  const kv = env.USAGE_KV;
  if (!kv) return new Response('Not found', { status: 404 });
  const d = await kv.get('media:' + path.replace('/api/media/', ''));
  if (!d) return new Response('Not found', { status: 404 });
  const ext = path.split('.').pop().toLowerCase();
  const types = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
  return new Response(b642ab(d), {
    headers: { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'public,max-age=86400', ...corsHeaders(req) },
  });
}

/* ═══ Router ═══ */
export default {
  async fetch(req, env) {
    const u = new URL(req.url), p = u.pathname;
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) });

    try {
      if (p === '/api/auth/register' && req.method === 'POST') return handleAuth(req, env, 'register');
      if (p === '/api/auth/login' && req.method === 'POST') return handleAuth(req, env, 'login');
      if (p === '/api/auth/google' && req.method === 'POST') return handleAuth(req, env, 'google');
      if (p === '/api/auth/github' && req.method === 'POST') return handleGitHubAuth(req, env);

      if (p === '/api/generate' && req.method === 'POST') return handleGenerate(req, env);

      if (p.startsWith('/api/image/')) return handleImage(req, env, p.replace('/api/image/', ''));

      if (p === '/api/paypal/order' && req.method === 'POST') return handlePayPalOrder(req, env);
      if (p === '/api/paypal/capture' && req.method === 'POST') return handlePayPalCapture(req, env);
      if (p === '/api/creem/checkout' && req.method === 'POST') return handleCreemCheckout(req, env);
      if (p === '/api/creem/webhook' && req.method === 'POST') return handleCreemWebhook(req, env);

      if (p === '/api/usage' && req.method === 'POST') return handleUsage(req, env);
      if (p.startsWith('/api/admin/')) return handleAdmin(req, env, p);
      if (p.startsWith('/api/media/')) return handleMedia(req, env, p);

      if (p === '/api/reset-my-usage' && req.method === 'POST') {
        const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
        let b;
        try { b = await req.json(); } catch { b = {}; }
        const fp = (b && b.fingerprint) || ip;
        if (env.DB) {
          await env.DB.prepare('DELETE FROM free_usage WHERE fp = ?').bind(fp).run();
        }
        return json({ success: true, message: 'Free trial reset. You have 2 free generations again.' }, 200, req);
      }

      if (p === '/api/blog-images') return handleBlogImagesIndex(req, env);
      if (p.startsWith('/api/blog-image/')) {
        const parts = p.replace('/api/blog-image/', '').split('/');
        if (parts.length === 2) return handleBlogImageServe(req, env, parts[0], parts[1]);
        return json({ error: 'Invalid path' }, 400, req);
      }
      if (p.startsWith('/api/showcase-image/')) {
        const parts = p.replace('/api/showcase-image/', '').split('/');
        if (parts.length === 3) return handleShowcaseImageServe(req, env, parts[0], parts[1], parts[2]);
        return json({ error: 'Invalid path' }, 400, req);
      }
      if (p === '/api/showcase') return handleShowcaseData(req, env);

      if (p === '/api/health') {
        return json({
          status: 'ok',
          version: 'v20',
          storage: env.DB ? 'D1+KV' : 'KV',
          flux2: !!env.CF_API_TOKEN,
          dailyFreePerIP: CONFIG.LIFETIME_FREE,
          dynamicGlobalCap: true,
        }, 200, req);
      }

      return json({ error: 'Not found' }, 404, req);
    } catch (e) {
      return json({ error: 'Internal error', message: e.message }, 500, req);
    }
  },
};
