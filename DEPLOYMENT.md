# AnimifyAI v3 Deployment Guide

## Critical Bug Fix in v3
**Previous versions used @cf/stable-diffusion-xl-base-1.0 (text-to-image only) which CANNOT do photo-to-anime transformation.**
v3 switches to @cf/stable-diffusion-v1-5-img2img (image-to-image) as primary engine + Gemini as backup.

## Step 1: Cloudflare Pages
Push `animifyai/` to GitHub → CF Dashboard → Pages → Connect repo → Deploy → Add custom domain `animifyai.com`

## Step 2: Worker API
```bash
cd worker/ && npm i -g wrangler && wrangler login
wrangler kv:namespace create USAGE_KV  # Copy ID to wrangler.toml
wrangler secret put CF_API_TOKEN
wrangler secret put GEMINI_API_KEY
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
wrangler secret put ADMIN_PASSWORD
wrangler secret put GOOGLE_CLIENT_ID  # For Google OAuth
wrangler deploy
```

## Step 3: Frontend Config
Edit `assets/js/main.js`:
- `workerURL` → your actual worker URL
- `googleClientId` → your Google OAuth client ID

## Step 4: Google OAuth Setup
1. Google Cloud Console → APIs → Credentials → Create OAuth Client ID
2. Type: Web application
3. Authorized JS origins: `https://animifyai.com`
4. Authorized redirect URIs: `https://animifyai.com/en/`, `https://animifyai.com/zh/`
5. Copy Client ID to main.js + `wrangler secret put GOOGLE_CLIENT_ID`

## Step 5: Stripe
Create products: Basic $4.90/mo, Premium $8.90/mo, Pack50 $2.90, Pack150 $5.90
```bash
wrangler secret put STRIPE_PRICE_BASIC    # price_xxx
wrangler secret put STRIPE_PRICE_PREMIUM
wrangler secret put STRIPE_PRICE_PACK50
wrangler secret put STRIPE_PRICE_PACK150
```
Webhook URL: `https://YOUR_WORKER/api/stripe-webhook`

## Step 6: Admin Panel
Access at `https://animifyai.com/admin/` — password is your ADMIN_PASSWORD secret.
Features: dashboard stats, blog CRUD, media upload (images auto-mapped to API paths).

## Step 7: ROTATE API KEYS
Development keys were visible. Regenerate immediately after deployment.

## Quick Checklist
- [ ] Pages deployed + custom domain
- [ ] KV namespace ID in wrangler.toml
- [ ] All secrets set
- [ ] Worker URL in main.js
- [ ] Google Client ID configured
- [ ] Stripe products + webhook
- [ ] API keys rotated
- [ ] Test upload→generate→download flow
- [ ] Test Google sign-in
- [ ] Test dark mode toggle

Contact: ludada960@gmail.com
