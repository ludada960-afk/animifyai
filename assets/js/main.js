/* AnimifyAI — v29: login gate before free generation, free trial messaging */
const CONFIG = {
  workerURL: '', // same-domain via Pages Functions proxy (no workers.dev blocking)
  maxFreeUses: 3,
  googleClientId: '848570946354-i84r1iam15kq0gm7bbq4s789p63nqab1.apps.googleusercontent.com',
  githubClientId: 'Ov23libAdXDFh6PCPdlW',
};

const state = { selectedStyle:'ghibli', uploadedImage:null, uploadedBase64:null, generatedImage:null, generatedImageUrl:null, isGenerating:false, user:null };

document.addEventListener('DOMContentLoaded', () => {
  initTheme(); initNav(); initUpload(); initStyles(); initFAQ();
  initScrollAnimations(); initAuth(); initShowcaseSliders(); initGallery();
  applyCustomShowcase(); applyCustomBlogImages(); updateCreditsDisplay();
});

/* ═══ Theme ═══ */
function initTheme() {
  const s = localStorage.getItem('theme');
  if (s) document.documentElement.setAttribute('data-theme', s);
  else if (matchMedia('(prefers-color-scheme:dark)').matches) document.documentElement.setAttribute('data-theme', 'dark');
  updateThemeIcon();
  document.querySelectorAll('.theme-toggle').forEach(b => b.addEventListener('click', () => {
    const n = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', n);
    localStorage.setItem('theme', n);
    updateThemeIcon();
  }));
}
function updateThemeIcon() {
  const d = document.documentElement.getAttribute('data-theme') === 'dark';
  document.querySelectorAll('.theme-toggle').forEach(b => b.textContent = d ? '☀️' : '🌙');
}

/* ═══ Nav ═══ */
function initNav() {
  const t = document.querySelector('.menu-toggle'), l = document.querySelector('.nav-links');
  if (t && l) {
    t.addEventListener('click', () => l.classList.toggle('open'));
    l.querySelectorAll('a').forEach(a => a.addEventListener('click', () => l.classList.remove('open')));
  }
}

/* ═══ Auth: GitHub + Google + Email ═══ */
let gisReady = false;
function initAuth() {
  const saved = localStorage.getItem('animifyai_user');
  if (saved) try { state.user = JSON.parse(saved); updateAuthUI(); } catch {}
  const urlParams = new URLSearchParams(window.location.search);
  const ghCode = urlParams.get('code');
  if (ghCode) { window.history.replaceState({}, '', location.pathname); handleGitHubCallback(ghCode); }
  if (urlParams.get('payment') === 'success') { window.history.replaceState({}, '', location.pathname); handlePayPalReturn(); }
  if (CONFIG.googleClientId) {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true; s.onload = initGoogleIdentity;
    document.head.appendChild(s);
  }
}

function initGoogleIdentity() {
  if (!window.google?.accounts) return;
  window.google.accounts.id.initialize({
    client_id: CONFIG.googleClientId,
    callback: handleGoogleResponse,
    auto_select: false,
    cancel_on_tap_outside: false,
    itp_support: true,
    use_fedcm_for_prompt: true,
    context: 'signin',
  });
  gisReady = true;
  renderGoogleButtons();
  if (!state.user) setTimeout(() => showGoogleOneTap(), 800);
}

function showGoogleOneTap() {
  if (!gisReady || state.user) return;
  window.google.accounts.id.prompt((notification) => {
    if (notification.isNotDisplayed()) {
      const reason = notification.getNotDisplayedReason();
      console.log('One Tap not shown: ' + reason);
      if (reason === 'opt_out_or_no_session' || reason === 'unknown_reason') {
        showOneTapFallback();
      }
    }
    if (notification.isSkippedMoment()) {
      console.log('One Tap skipped: ' + notification.getSkippedReason());
      showOneTapFallback();
    }
    if (notification.isDismissedMoment()) {
      console.log('One Tap dismissed');
    }
  });
}

let oneTapFallbackShown = false;
function showOneTapFallback() {
  if (oneTapFallbackShown || state.user) return;
  oneTapFallbackShown = true;
  const banner = document.createElement('div');
  banner.className = 'one-tap-fallback';
  banner.innerHTML = `
    <div class="otf-content">
      <img src="/assets/images/mascot-clean.png" alt="" width="28" height="28">
      <span>Sign in to save your creations</span>
    </div>
    <button class="otf-google-btn" onclick="this.closest('.one-tap-fallback').remove(); showAuthModal('login');">
      <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
      Google
    </button>
    <button class="otf-close" onclick="this.closest('.one-tap-fallback').remove()">✕</button>
  `;
  document.body.appendChild(banner);
  setTimeout(() => banner.classList.add('show'), 100);
  setTimeout(() => { banner.classList.remove('show'); setTimeout(() => banner.remove(), 300); }, 15000);
}

function renderGoogleButtons() {
  document.querySelectorAll('.google-btn-container').forEach(el => {
    if (!el.querySelector('iframe') && gisReady) {
      window.google.accounts.id.renderButton(el, {
        theme: 'outline', size: 'large', type: 'standard',
        text: 'continue_with', shape: 'rectangular',
      });
    }
  });
}

function signInWithGoogle() {
  if (!gisReady) { showToast('Google Sign-In is loading, please wait and retry.', 'info'); return; }
  if (!window.google?.accounts?.oauth2) { showToast('Google Sign-In unavailable. Try Email or GitHub.', 'info'); return; }
  const client = window.google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.googleClientId,
    callback: handleGoogleResponse,
    scope: 'email profile',
    prompt: '',
  });
  client.requestAccessToken();
}

async function handleGoogleResponse(resp) {
  if (!resp?.access_token) { showToast('Google sign-in failed', 'error'); return; }
  try {
    const r = await fetch(CONFIG.workerURL + '/api/auth/google', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ googleAccessToken: resp.access_token }),
    });
    const d = await r.json();
    if (d.error) { showToast(d.error, 'error'); return; }
    state.user = { email: d.email, name: d.name, picture: d.picture, token: d.token, credits: d.credits, plan: d.plan };
    localStorage.setItem('animifyai_user', JSON.stringify(state.user));
    updateAuthUI(); updateCreditsDisplay(); closeModal('authModal'); initGallery();
    showToast('Welcome, ' + (d.name || d.email) + '!', 'success');
  } catch { showToast('Google login failed. Check console for details.', 'error'); }
}

function loginWithGitHub() {
  if (!CONFIG.githubClientId) { showToast('GitHub login not configured', 'error'); return; }
  const redirectUri = location.origin + '/en/';
  window.location.href = `https://github.com/login/oauth/authorize?client_id=${CONFIG.githubClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=user:email`;
}

async function handleGitHubCallback(code) {
  try {
    const res = await fetch(CONFIG.workerURL + '/api/auth/github', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (data.error) { showToast(data.error, 'error'); return; }
    state.user = { email: data.email, name: data.name, avatar: data.avatar, token: data.token, credits: data.credits, plan: data.plan };
    localStorage.setItem('animifyai_user', JSON.stringify(state.user));
    updateAuthUI(); updateCreditsDisplay();
    showToast('Welcome, ' + (data.name || data.email) + '!', 'success');
  } catch { showToast('GitHub login failed', 'error'); }
}

function showAuthModal(mode) {
  const m = document.getElementById('authModal');
  if (!m) return;
  m.classList.add('active');
  m.dataset.mode = mode;
  const t = m.querySelector('h2'), st = m.querySelector('.modal-subtitle'),
        ng = m.querySelector('.name-group'), sb = m.querySelector('.auth-submit'),
        ft = m.querySelector('.form-footer');
  if (mode === 'register') {
    t.textContent = 'Create Account'; st.textContent = 'Create your free account and try all 6 styles';
    if (ng) ng.style.display = 'block'; if (sb) sb.textContent = 'Create Account';
    ft.innerHTML = 'Already have an account? <a href="#" onclick="showAuthModal(\'login\');return false">Sign in</a>';
  } else {
    t.textContent = 'Welcome to AnimifyAI'; st.textContent = 'Sign in to save your creations';
    if (ng) ng.style.display = 'none'; if (sb) sb.textContent = 'Sign In';
    ft.innerHTML = 'New here? <a href="#" onclick="showAuthModal(\'register\');return false">Create account</a>';
  }
  setTimeout(() => renderGoogleButtons(), 200);
}

function closeModal(id) { document.getElementById(id)?.classList.remove('active'); }

async function handleAuth(e) {
  e.preventDefault();
  const m = document.getElementById('authModal'), mode = m?.dataset.mode || 'login';
  const email = document.getElementById('authEmail')?.value, pw = document.getElementById('authPassword')?.value;
  if (!email || !pw) { showToast('Please fill all fields', 'error'); return; }
  try {
    const res = await fetch(CONFIG.workerURL + '/api/auth/' + mode, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, password: pw, fingerprint: getFP() }) });
    const d = await res.json();
    if (d.error) { showToast(d.error, 'error'); return; }
    state.user = { email: d.email, token: d.token, credits: d.credits, plan: d.plan };
    localStorage.setItem('animifyai_user', JSON.stringify(state.user));
    closeModal('authModal'); updateAuthUI(); updateCreditsDisplay();
    showToast(mode === 'register' ? 'Account created! 2 free credits ready.' : 'Welcome back!', 'success');
  } catch {
    state.user = { email, token: 'local', credits: CONFIG.maxFreeUses, plan: 'free' };
    localStorage.setItem('animifyai_user', JSON.stringify(state.user));
    closeModal('authModal'); updateAuthUI(); updateCreditsDisplay();
    showToast('Signed in (offline mode)', 'info');
  }
}

function logout() {
  state.user = null; localStorage.removeItem('animifyai_user');
  updateAuthUI(); updateCreditsDisplay(); showToast('Signed out', 'info');
}

function updateAuthUI() {
  document.querySelectorAll('.auth-logged-in').forEach(e => e.style.display = state.user ? '' : 'none');
  document.querySelectorAll('.auth-logged-out').forEach(e => e.style.display = state.user ? 'none' : '');
  document.querySelectorAll('.user-email').forEach(e => { if (state.user) e.textContent = state.user.name || state.user.email; });
}

async function updateCreditsDisplay() {
  const b = document.querySelector('.credits-badge');
  if (!b) return;
  const btn = document.getElementById('generateBtn');

  // ── Simulation mode (admin test) ──
  const sim = localStorage.getItem('animifyai_sim_exhausted');
  if (sim) {
    b.innerHTML = '<strong>0</strong> free left';
    if (btn) { btn.textContent = '💎 Upgrade to Generate'; btn.setAttribute('data-action', 'paywall'); }
    if (sim === 'global') {
      b.innerHTML = '<strong>0</strong> free left (service busy)';
    }
    return;
  }

  try {
    const res = await fetch(CONFIG.workerURL + '/api/usage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(state.user?.token ? { Authorization: 'Bearer ' + state.user.token } : {}) },
      body: JSON.stringify({ fingerprint: getFP() }),
    });
    const d = await res.json();
    if (d.fluxExhausted || (d.remaining !== undefined && d.remaining <= 0)) {
      b.innerHTML = '<strong>0</strong> free left';
      if (btn) { btn.textContent = '💎 Upgrade to Generate'; btn.setAttribute('data-action', 'paywall'); }
    } else if (d.remaining !== undefined) {
      state.dailyRemaining = d.remaining;
      const maxText = d.lifetimeMax ? ` of ${d.lifetimeMax}` : '';
      b.innerHTML = `<strong>${d.remaining}</strong> free${maxText} left`;
      if (btn) { btn.textContent = '✨ Generate Anime Art'; btn.removeAttribute('data-action'); }
    }
  } catch {
    b.innerHTML = '<strong>?</strong> free left';
  }
}

function getFP() {
  let f = localStorage.getItem('animifyai_fp');
  if (!f) { f = btoa([navigator.userAgent, navigator.language, screen.width, screen.height, new Date().getTimezoneOffset()].join('|')).slice(0, 32); localStorage.setItem('animifyai_fp', f); }
  return f;
}

/* ═══ Upload ═══ */
function initUpload() {
  const a = document.getElementById('uploadArea'), i = document.getElementById('fileInput');
  if (!a || !i) return;
  a.addEventListener('click', e => { if (!e.target.closest('.remove-btn')) i.click(); });
  i.addEventListener('change', () => { if (i.files[0]) handleFile(i.files[0]); });
  a.addEventListener('dragover', e => { e.preventDefault(); a.classList.add('dragover'); });
  a.addEventListener('dragleave', () => a.classList.remove('dragover'));
  a.addEventListener('drop', e => { e.preventDefault(); a.classList.remove('dragover'); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
}

function handleFile(file) {
  if (!file.type.startsWith('image/')) { showToast('Please upload an image', 'error'); return; }
  if (file.size > 10*1024*1024) { showToast('Max 10MB', 'error'); return; }
  state.uploadedImage = file;

  // Resize to max 1024px before encoding — matches Flux.2 output range
  const img = new Image();
  img.onload = () => {
    const MAX = 1024;
    let w = img.width, h = img.height;
    if (w > MAX || h > MAX) {
      const ratio = Math.min(MAX / w, MAX / h);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
    }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    const dataUrl = c.toDataURL('image/jpeg', 0.85);
    state.uploadedBase64 = dataUrl.split(',')[1];
    state.imageWidth = w;   // store for Flux.2 output sizing
    state.imageHeight = h;

    const a = document.getElementById('uploadArea');
    a.classList.add('has-image');
    a.innerHTML = `<img src="${dataUrl}" alt="Uploaded"><button class="remove-btn" onclick="removeUpload(event)">✕</button>`;
  };
  img.src = URL.createObjectURL(file);
}

function removeUpload(e) {
  e.stopPropagation();
  state.uploadedImage = null; state.uploadedBase64 = null; state.generatedImage = null; state.imageWidth = null; state.imageHeight = null;
  const a = document.getElementById('uploadArea');
  a.classList.remove('has-image');
  a.innerHTML = '<div class="upload-icon"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div><div class="upload-text">Drop image here or click to upload</div><div class="upload-hint">JPG, PNG, WebP · Max 10MB</div>';
  document.getElementById('fileInput').value = '';
  // Hide result area
  const ra = document.getElementById('resultArea');
  if (ra) {
    ra.classList.remove('visible');
    document.getElementById('resultImage').style.display = 'none';
    document.getElementById('genLoading')?.classList.remove('active');
  }
}

/* ═══ Styles ═══ */
function initStyles() {
  document.querySelectorAll('.style-chip').forEach(c => c.addEventListener('click', () => {
    document.querySelectorAll('.style-chip').forEach(x => x.classList.remove('active'));
    c.classList.add('active'); state.selectedStyle = c.dataset.style;
  }));
  document.querySelectorAll('.style-card[data-style]').forEach(c => c.addEventListener('click', () => {
    state.selectedStyle = c.dataset.style;
    document.querySelectorAll('.style-chip').forEach(x => x.classList.toggle('active', x.dataset.style === state.selectedStyle));
    document.getElementById('generator')?.scrollIntoView({ behavior: 'smooth' });
  }));
}

/* ═══ Style select from transformation section ═══ */
function selectStyleAndScroll(style) {
  state.selectedStyle = style;
  document.querySelectorAll('.style-chip').forEach(x => x.classList.toggle('active', x.dataset.style === style));
  document.getElementById('generator')?.scrollIntoView({ behavior: 'smooth' });
}

/* ═══ Loading helpers ═══ */
function showLoading() {
  const ra = document.getElementById('resultArea');
  if (ra) ra.classList.add('visible');
  const load = document.getElementById('genLoading');
  if (load) load.classList.add('active');
  document.getElementById('resultImage').style.display = 'none';
  document.getElementById('resultShare').style.display = 'none';
}
function hideLoading() {
  const load = document.getElementById('genLoading');
  if (load) load.classList.remove('active');
}

/* ═══ Generation ═══ */
async function generateImage() {
  if (state.isGenerating) return;

  if (!state.user) { showAuthModal('register'); return; }

  // Check if button is in paywall mode (no free quota)
  const btn = document.getElementById('generateBtn');
  if (btn?.getAttribute('data-action') === 'paywall') { showPaywall(); return; }

  if (!state.uploadedBase64) { showToast('Please upload an image first', 'error'); return; }

  state.isGenerating = true;
  btn?.setAttribute('disabled', '');
  showLoading();

  try {
    const res = await fetch(CONFIG.workerURL + '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(state.user?.token ? { Authorization: 'Bearer ' + state.user.token } : {}) },
      body: JSON.stringify({ image: state.uploadedBase64, style: state.selectedStyle, fingerprint: getFP(), width: state.imageWidth || 1024, height: state.imageHeight || 1024 }),
    });
    const d = await res.json();

    if (d.error) {
      hideLoading();
      document.getElementById('resultArea')?.classList.remove('visible');
      if (d.code === 'IP_LIMIT' || d.code === 'FLUX_EXHAUSTED' || d.code === 'NO_CREDITS') {
        showPaywall();
        return;
      }
      throw new Error(d.details ? d.error + ' — ' + d.details : d.error);
    }
    if (!d.image) throw new Error('No image returned');

    // Load generated image, crop to match input aspect ratio
    const rawDataUrl = 'data:image/png;base64,' + d.image;
    state.generatedImageUrl = d.imageUrl || null;

    const cropImg = new Image();
    cropImg.onload = () => {
      const inW = state.imageWidth || cropImg.naturalWidth;
      const inH = state.imageHeight || cropImg.naturalHeight;
      const inRatio = inW / inH;
      const outRatio = cropImg.naturalWidth / cropImg.naturalHeight;
      let finalUrl = rawDataUrl;

      if (Math.abs(inRatio - outRatio) > 0.03) {
        const c = document.createElement('canvas');
        let sw, sh, sx, sy;
        if (outRatio > inRatio) {
          sh = cropImg.naturalHeight;
          sw = Math.round(sh * inRatio);
          sx = Math.round((cropImg.naturalWidth - sw) / 2); sy = 0;
        } else {
          sw = cropImg.naturalWidth;
          sh = Math.round(sw / inRatio);
          sx = 0; sy = Math.round((cropImg.naturalHeight - sh) / 2);
        }
        c.width = sw; c.height = sh;
        c.getContext('2d').drawImage(cropImg, sx, sy, sw, sh, 0, 0, sw, sh);
        finalUrl = c.toDataURL('image/jpeg', 0.92);
      }

      state.generatedImage = finalUrl;
      hideLoading();
      showResult();
      updateCreditsDisplay();
      showToast('Anime art created! (' + (d.source || 'AI') + ')', 'success');
      document.getElementById('resultArea')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    cropImg.src = rawDataUrl;

    if (state.user && d.remaining !== undefined) {
      state.user.credits = d.remaining;
      localStorage.setItem('animifyai_user', JSON.stringify(state.user));
    }
  } catch (e) {
    hideLoading();
    document.getElementById('resultArea')?.classList.remove('visible');
    showToast(e.message || 'Generation failed. Please try again.', 'error');
  } finally {
    state.isGenerating = false;
    btn?.removeAttribute('disabled');
  }
}

function showResult() {
  const ra = document.getElementById('resultArea');
  const img = document.getElementById('resultImage');
  const share = document.getElementById('resultShare');
  if (!ra || !img || !state.generatedImage) return;
  ra.classList.add('visible');
  img.src = state.generatedImage;
  img.style.display = 'block';
  share.style.display = 'flex';
  // Download button
  document.getElementById('downloadBtn').onclick = () => {
    const a = document.createElement('a'); a.href = state.generatedImage;
    a.download = 'animifyai-' + state.selectedStyle + '.png'; a.click();
  };
  // Gallery - show save button if logged in, or prompt to login
  const saveBtn = document.getElementById('saveToGalleryBtn');
  if (saveBtn) {
    saveBtn.onclick = () => {
      if (!state.user) { showAuthModal('login'); return; }
      saveToGallery();
    };
  }
}

/* ═══ Save to Gallery ═══ */
function saveToGallery() {
  if (!state.user) { showAuthModal('login'); return; }
  if (!state.generatedImage || !state.generatedImageUrl) {
    showToast('Generate an image first', 'info'); return;
  }
  let gallery = JSON.parse(localStorage.getItem('animifyai_gallery') || '[]');
  gallery.unshift({
    url: state.generatedImageUrl || state.generatedImage,
    style: state.selectedStyle,
    date: new Date().toISOString(),
    thumb: state.generatedImage
  });
  if (gallery.length > 20) gallery = gallery.slice(0, 20);
  localStorage.setItem('animifyai_gallery', JSON.stringify(gallery));
  showToast('Saved to My Gallery!', 'success');
  renderGallery();
}

function initGallery() {
  if (state.user) {
    document.getElementById('myGallery').style.display = '';
    document.getElementById('galleryLoginPrompt').style.display = 'none';
    renderGallery();
  }
}

function renderGallery() {
  const grid = document.getElementById('galleryGrid');
  if (!grid) return;
  const gallery = JSON.parse(localStorage.getItem('animifyai_gallery') || '[]');
  if (gallery.length === 0) {
    grid.innerHTML = '<div class="gallery-empty">Your creations will appear here after you generate and save them.</div>';
    return;
  }
  grid.innerHTML = gallery.map((item, i) => `
    <div class="gallery-thumb" onclick="window.open('${item.url}','_blank')" title="${item.style} · ${new Date(item.date).toLocaleDateString()}">
      <img src="${item.thumb}" alt="${item.style}" loading="lazy">
      <div class="gallery-thumb-style">${item.style}</div>
    </div>
  `).join('');
}

/* ═══ Showcase Sliders (Demo Before/After) ═══ */
function initShowcaseSliders() {
  document.querySelectorAll('.showcase-compare').forEach(sc => {
    let drag = false;
    const handle = sc.querySelector('.sc-handle');
    const before = sc.querySelector('.sc-before');
    // Prevent native image drag on all images inside the compare container
    sc.querySelectorAll('img').forEach(img => {
      img.addEventListener('dragstart', e => e.preventDefault());
    });
    function upd(x) {
      const r = sc.getBoundingClientRect();
      let p = ((x - r.left) / r.width) * 100;
      p = Math.max(5, Math.min(95, p));
      handle.style.left = p + '%';
      before.style.clipPath = `inset(0 ${100-p}% 0 0)`;
    }
    sc.addEventListener('mousedown', e => { e.preventDefault(); drag = true; upd(e.clientX); });
    sc.addEventListener('touchstart', e => { e.preventDefault(); drag = true; upd(e.touches[0].clientX); }, { passive: false });
    document.addEventListener('mousemove', e => { if (drag) { e.preventDefault(); upd(e.clientX); } });
    document.addEventListener('touchmove', e => { if (drag) { e.preventDefault(); upd(e.touches[0].clientX); } }, { passive: false });
    document.addEventListener('mouseup', () => drag = false);
    document.addEventListener('touchend', () => drag = false);
  });
}

/* ═══ Apply custom showcase images from admin ═══ */
async function applyCustomShowcase() {
  let updated = 0;

  // Helper: get image URL (base64 direct or KV-backed API)
  function showcaseImgUrl(val, type, id, field) {
    if (val && val.startsWith('data:')) return val; // base64 from localStorage
    return '/api/showcase-image/' + type + '/' + (id || 'unknown') + '/' + field;
  }

  // Helper
  function applyShowcaseData(data) {
    if (data.sliders) {
      document.querySelectorAll('.showcase-compare').forEach((sc, i) => {
        const s = data.sliders[i];
        if (!s) return;
        const beforeImg = sc.querySelector('.sc-before');
        const afterImg = sc.querySelector('.sc-after');
        const beforeLabel = sc.querySelector('.sc-label-before');
        const afterLabel = sc.querySelector('.sc-label-after');
        if (beforeImg) { beforeImg.src = showcaseImgUrl(s.before, 'slider', s.id || '', 'before'); updated++; }
        if (afterImg) { afterImg.src = showcaseImgUrl(s.after, 'slider', s.id || '', 'after'); afterImg.style.filter = s.filter || 'none'; updated++; }
        if (beforeLabel) beforeLabel.textContent = s.beforeLabel || 'Original';
        if (afterLabel) afterLabel.textContent = s.afterLabel || 'After';
      });
    }
    if (data.transforms) {
      document.querySelectorAll('.tf-anime-card').forEach((card, i) => {
        const t = data.transforms[i];
        if (!t) return;
        const bgImg = card.querySelector('.tf-anime-bg');
        const insetImg = card.querySelector('.tf-original-inset img');
        if (bgImg) { bgImg.src = showcaseImgUrl(t.bg, 'transform', t.id || '', 'bg'); updated++; }
        if (insetImg) { insetImg.src = showcaseImgUrl(t.inset, 'transform', t.id || '', 'inset'); updated++; }
      });
    }
  }

  // 1) Try localStorage first
  try {
    const saved = localStorage.getItem('animifyai_showcase');
    if (saved) {
      applyShowcaseData(JSON.parse(saved));
      if (updated > 0) { console.log('AnimifyAI: Loaded ' + updated + ' custom showcase from localStorage'); return; }
    }
  } catch(e) { console.warn('AnimifyAI: localStorage showcase read failed —', e.message); }

  // 2) Fall back to KV via same-domain Pages Function
  try {
    const resp = await fetch('/api/showcase');
    if (resp.ok) {
      const data = await resp.json();
      if (data && (data.sliders?.length || data.transforms?.length)) {
        applyShowcaseData(data);
        if (updated > 0) console.log('AnimifyAI: Loaded ' + updated + ' custom showcase from Worker KV');
      }
    }
  } catch(e) { console.warn('AnimifyAI: Worker showcase fetch failed —', e.message); }
}

/* ═══ Apply custom blog images from admin (localStorage → Worker → hardcoded) ═══ */
async function applyCustomBlogImages() {
  let updated = 0;
  let workerIndex = null;

  // Helper: swap an image src if we have a URL
  function swapIf(selector, url) {
    const el = document.querySelector(selector);
    if (el && url) { el.src = url; updated++; return true; }
    return false;
  }

  // 1) Try localStorage first (admin instant preview)
  try {
    const saved = localStorage.getItem('animifyai_showcase');
    if (saved) {
      const data = JSON.parse(saved);
      if (data.blogImages && Object.keys(data.blogImages).length > 0) {
        // Blog index cards
        document.querySelectorAll('.blog-card').forEach(card => {
          const href = card.getAttribute('href') || '';
          const slug = href.split('/').filter(Boolean).pop();
          const img = data.blogImages[slug];
          if (img?.hero) {
            const thumb = card.querySelector('.card-thumb img');
            if (thumb) { thumb.src = img.hero; updated++; }
          }
        });

        // Article page
        const articleSlug = getArticleSlug();
        if (articleSlug && data.blogImages[articleSlug]) {
          const imgs = data.blogImages[articleSlug];
          swapIf('.article-hero-img', imgs.hero);
          swapIf('img[data-blog-slot="inline1"]', imgs.inline1);
          swapIf('img[data-blog-slot="inline2"]', imgs.inline2);
        }
        if (updated > 0) console.log('AnimifyAI: Loaded ' + updated + ' custom blog images from localStorage');
        return;
      }
    }
  } catch(e) { console.warn('AnimifyAI: localStorage blog images read failed —', e.message); }

  // 2) Fall back to KV via same-domain
  try {
    // Use preloaded data from inline <head> script if available
    let resp;
    if (window.__blogImagesPreload) {
      const data = await window.__blogImagesPreload;
      resp = { ok: !!data, json: async () => data };
    } else {
      resp = await fetch('/api/blog-images');
    }
    if (resp.ok) {
      const idx = await resp.json();
      if (idx && idx.images && Object.keys(idx.images).length > 0) {
        workerIndex = idx.images;

        // Blog index cards
        document.querySelectorAll('.blog-card').forEach(card => {
          const href = card.getAttribute('href') || '';
          const slug = href.split('/').filter(Boolean).pop();
          const fields = workerIndex[slug];
          if (fields && fields.includes('hero')) {
            const thumb = card.querySelector('.card-thumb img');
            if (thumb) { thumb.src = '/api/blog-image/' + slug + '/hero'; updated++; }
          }
        });

        // Article page
        const articleSlug = getArticleSlug();
        if (articleSlug && workerIndex[articleSlug]) {
          const fields = workerIndex[articleSlug];
          if (fields.includes('hero')) swapIf('.article-hero-img', '/api/blog-image/' + articleSlug + '/hero');
          if (fields.includes('inline1')) swapIf('img[data-blog-slot="inline1"]', '/api/blog-image/' + articleSlug + '/inline1');
          if (fields.includes('inline2')) swapIf('img[data-blog-slot="inline2"]', '/api/blog-image/' + articleSlug + '/inline2');
        }
        if (updated > 0) console.log('AnimifyAI: Loaded ' + updated + ' custom blog images from KV');
        return;
      }
    }
  } catch(e) { console.warn('AnimifyAI: KV blog images fetch failed —', e.message); }
}

function getArticleSlug() {
  const path = window.location.pathname;
  const parts = path.split('/').filter(Boolean);
  return parts.length >= 3 ? parts[parts.length - 1] : null;
}

function shareTwitter() {
  const url = encodeURIComponent(state.generatedImageUrl || 'https://animifyai.pages.dev/en/');
  window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent('Just made anime art with AnimifyAI! ✨')}&url=${url}`, '_blank', 'width=600,height=400');
}
function shareFacebook() {
  const url = encodeURIComponent(state.generatedImageUrl || 'https://animifyai.pages.dev/en/');
  window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, '_blank', 'width=600,height=400');
}
function copyLink() {
  const url = state.generatedImageUrl || 'https://animifyai.pages.dev/en/';
  navigator.clipboard?.writeText(url).then(() => showToast('Link copied!', 'success')).catch(() => showToast('Copy failed', 'error'));
}

/* ═══ Payments ═══ */
function showPaywall() { document.getElementById('paywallModal')?.classList.add('active'); }

async function selectPlan(plan) {
  closeModal('paywallModal');
  const email = state.user?.email || '';
  try {
    const r = await fetch(CONFIG.workerURL + '/api/paypal/order', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ plan, email })
    });
    const d = await r.json();
    if (d.approveUrl) {
      sessionStorage.setItem('paypal_plan', plan);
      sessionStorage.setItem('paypal_order', d.orderID);
      sessionStorage.setItem('paypal_email', email);
      window.location.href = d.approveUrl;
      return;
    }
    const sr = await fetch(CONFIG.workerURL + '/api/checkout', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ plan, email })
    });
    const sd = await sr.json();
    if (sd.url) window.location.href = sd.url;
    else showToast(sd.error || d.error || 'Payment unavailable', 'error');
  } catch { showToast('Could not connect to payment', 'error'); }
}

async function handlePayPalReturn() {
  const plan = sessionStorage.getItem('paypal_plan');
  const orderID = sessionStorage.getItem('paypal_order');
  const email = sessionStorage.getItem('paypal_email');
  if (!plan || !orderID) return;
  sessionStorage.removeItem('paypal_plan');
  sessionStorage.removeItem('paypal_order');
  sessionStorage.removeItem('paypal_email');
  showToast('Processing payment...', 'info');
  try {
    const r = await fetch(CONFIG.workerURL + '/api/paypal/capture', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ orderID, plan, email })
    });
    const d = await r.json();
    if (d.status === 'COMPLETED') {
      showToast('Payment successful! Credits added.', 'success');
      if (state.user) {
        const p = { basic:100, premium:300, pack50:50, pack150:150 };
        state.user.credits = (state.user.credits || 0) + (p[plan] || 0);
        localStorage.setItem('animifyai_user', JSON.stringify(state.user));
        updateCreditsDisplay();
      }
    } else {
      showToast('Payment status: ' + (d.status || 'pending'), 'error');
    }
  } catch { showToast('Payment verification failed', 'error'); }
}

/* ═══ FAQ ═══ */
function initFAQ() {
  document.querySelectorAll('.faq-q').forEach(b => b.addEventListener('click', () => {
    const i = b.parentElement, o = i.classList.contains('open');
    document.querySelectorAll('.faq-item').forEach(x => x.classList.remove('open'));
    if (!o) i.classList.add('open');
  }));
}

/* ═══ Scroll Animations ═══ */
function initScrollAnimations() {
  const obs = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); }), { threshold: 0.1 });
  document.querySelectorAll('.fade-in').forEach(e => obs.observe(e));
}

/* ═══ Toast ═══ */
function showToast(msg, type) {
  let c = document.querySelector('.toast-container');
  if (!c) { c = document.createElement('div'); c.className = 'toast-container'; document.body.appendChild(c); }
  const t = document.createElement('div'); t.className = 'toast ' + (type || 'info'); t.textContent = msg;
  c.appendChild(t); setTimeout(() => t.remove(), 3200);
}

/* ═══ Sample ═══ */
function loadSample(url) {
  fetch(url).then(r => r.blob()).then(b => handleFile(new File([b], 'sample.jpg', { type: 'image/jpeg' }))).catch(() => showToast('Could not load sample', 'error'));
}

/* ═══ Self-service usage reset ═══ */
async function resetMyUsage() {
  try {
    const fp = getFP();
    const r = await fetch(CONFIG.workerURL + '/api/reset-my-usage', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({fingerprint: fp})
    });
    const d = await r.json();
    if (d.success) {
      localStorage.setItem('animifyai_used', '0');
      updateCreditsDisplay();
      closeModal('paywallModal');
      showToast('Credits reset! You have 2 free generations.', 'success');
    } else {
      showToast(d.error || 'Reset failed', 'error');
    }
  } catch { showToast('Could not reset usage. Try again.', 'error'); }
}

/* ═══ Expose globals ═══ */
Object.assign(window, { generateImage, removeUpload, showAuthModal, closeModal, handleAuth, logout, selectPlan, showPaywall, resetMyUsage, shareTwitter, shareFacebook, copyLink, loadSample, loginWithGitHub, signInWithGoogle, saveToGallery, selectStyleAndScroll });
