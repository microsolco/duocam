(() => {
'use strict';

const $ = s => document.querySelector(s);
const cv = $('#view'), ctx = cv.getContext('2d');
const vid = { rear: $('#vRear'), front: $('#vFront') };
const SIZES = { s: 0.24, m: 0.32, l: 0.42 };

const store = {
  get(k, d) { try { return localStorage.getItem('duocam.' + k) || d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('duocam.' + k, v); } catch {} }
};

const state = {
  mode: 'photo',
  corner: store.get('corner', 'br'),
  size: store.get('size', 'm'),
  swap: store.get('swap', '0') === '1',   // true = anteriore a tutto schermo, posteriore nel cerchio
  started: false,
  recording: false,
  streams: { rear: null, front: null },
  current: null                            // { file, url, kind }
};

const insets = { t: 0, b: 0 };
let recorder = null, chunks = [], recStart = 0, timerId = 0, wakeLock = null;

/* ---------- utilità UI ---------- */
function toast(msg, ms = 2400) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
function banner(msg) {
  const b = $('#banner');
  b.textContent = msg; b.classList.toggle('show', !!msg);
}
$('#banner').addEventListener('click', () => banner(''));

function readInsets() {
  const p = document.createElement('div');
  p.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
  document.body.appendChild(p);
  const cs = getComputedStyle(p);
  insets.t = parseFloat(cs.paddingTop) || 0;
  insets.b = parseFloat(cs.paddingBottom) || 0;
  p.remove();
}

const even = n => Math.round(n / 2) * 2;
function sizeCanvas() {
  if (state.recording) return;
  const iw = innerWidth, ih = innerHeight, L = 1920;
  if (ih >= iw) { cv.height = L; cv.width = even(L * iw / ih); }
  else { cv.width = L; cv.height = even(L * ih / iw); }
  readInsets();
}
addEventListener('resize', sizeCanvas);
addEventListener('orientationchange', () => setTimeout(sizeCanvas, 250));

/* ---------- fotocamere ---------- */
const gum = c => navigator.mediaDevices.getUserMedia(c);

async function openCam(facing, withAudio) {
  const ideal = facing === 'user' ? { width: { ideal: 1280 }, height: { ideal: 720 } } : { width: { ideal: 1920 }, height: { ideal: 1080 } };
  const tries = [
    { video: { facingMode: { exact: facing }, ...ideal }, audio: withAudio },
    { video: { facingMode: facing }, audio: withAudio },
    { video: { facingMode: facing }, audio: false }
  ];
  let last;
  for (const c of tries) {
    try { return await gum(c); }
    catch (e) { last = e; if (e.name === 'NotAllowedError') throw e; }
  }
  throw last;
}

function stopStream(s) { s && s.getTracks().forEach(t => t.stop()); }
function stopCameras() {
  stopStream(state.streams.rear); stopStream(state.streams.front);
  state.streams.rear = state.streams.front = null;
  vid.rear.srcObject = vid.front.srcObject = null;
}

async function attach(which, stream) {
  state.streams[which] = stream;
  vid[which].srcObject = stream;
  try { await vid[which].play(); } catch {}
}

// una camera è "viva" se la traccia è attiva e il video avanza davvero
const liveTrack = s => !!s && s.getVideoTracks().some(t => t.readyState === 'live');
async function framesAdvance(v) {
  const t0 = v.currentTime;
  await new Promise(r => setTimeout(r, 700));
  return v.currentTime > t0 && v.videoWidth > 0;
}
const isAlive = w => liveTrack(state.streams[w]) && vid[w].videoWidth > 0 && !vid[w].paused;

async function startCameras() {
  stopCameras();
  banner('');
  const rear = await openCam('environment', true);
  await attach('rear', rear);

  let front = null;
  try {
    front = await openCam('user', false);
    await attach('front', front);
  } catch (e) {
    if (e.name === 'NotAllowedError') throw e;
  }

  const rearOk = await framesAdvance(vid.rear);
  const frontOk = front ? await framesAdvance(vid.front) : false;

  if (rearOk && frontOk) return;                 // doppia camera attiva

  // Fallback: una sola camera
  if (!front || !frontOk) {
    stopStream(front); state.streams.front = null; vid.front.srcObject = null;
    if (!rearOk) { stopStream(rear); await attach('rear', await openCam('environment', true)); }
  } else if (!rearOk) {
    // iOS ha fermato la posteriore quando è partita l'anteriore
    stopStream(rear); state.streams.rear = null; vid.rear.srcObject = null;
  }
  banner('Il tuo dispositivo non consente di usare insieme le due fotocamere nel browser: sto usando una sola camera. Tocca per chiudere.');
}

/* ---------- composizione su canvas ---------- */
function drawCover(v, x, y, w, h, { mirror = false, circle = false } = {}) {
  const vw = v.videoWidth, vh = v.videoHeight;
  if (!vw || !vh) return;
  const s = Math.max(w / vw, h / vh), dw = vw * s, dh = vh * s;
  ctx.save();
  ctx.beginPath();
  if (circle) ctx.arc(x + w / 2, y + h / 2, w / 2, 0, Math.PI * 2); else ctx.rect(x, y, w, h);
  ctx.clip();
  if (mirror) {
    ctx.translate(x + w / 2, 0); ctx.scale(-1, 1);
    ctx.drawImage(v, -dw / 2, y + (h - dh) / 2, dw, dh);
  } else {
    ctx.drawImage(v, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }
  ctx.restore();
}

function pipRect() {
  const W = cv.width, H = cv.height, k = W / innerWidth;
  const d = Math.round(Math.min(W, H) * SIZES[state.size]);
  const mx = 16 * k, top = (insets.t + 64) * k, bot = (insets.b + 170) * k;
  const left = state.corner[1] === 'l', up = state.corner[0] === 't';
  return { x: left ? mx : W - mx - d, y: up ? top : H - bot - d, d, k };
}

function draw() {
  const W = cv.width, H = cv.height;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);

  let main = state.swap ? 'front' : 'rear';
  let pip = state.swap ? 'rear' : 'front';
  if (!isAlive(pip)) pip = null;
  if (!isAlive(main)) { main = pip; pip = null; }

  if (main) drawCover(vid[main], 0, 0, W, H, { mirror: main === 'front' });
  if (main && pip) {
    const r = pipRect();
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 18 * r.k;
    ctx.beginPath(); ctx.arc(r.x + r.d / 2, r.y + r.d / 2, r.d / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#000'; ctx.fill();
    ctx.restore();
    drawCover(vid[pip], r.x, r.y, r.d, r.d, { mirror: pip === 'front', circle: true });
    ctx.beginPath(); ctx.arc(r.x + r.d / 2, r.y + r.d / 2, r.d / 2 - 2 * r.k, 0, Math.PI * 2);
    ctx.lineWidth = 4 * r.k; ctx.strokeStyle = 'rgba(255,255,255,.92)'; ctx.stroke();
  }
}

function loop() { if (state.started) draw(); requestAnimationFrame(loop); }

/* ---------- scatto e registrazione ---------- */
const stamp = () => {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

function takePhoto() {
  draw();
  const f = $('#flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  cv.toBlob(blob => {
    if (!blob) return toast('Scatto non riuscito');
    review(new File([blob], `DuoCam-${stamp()}.jpg`, { type: 'image/jpeg' }), 'photo');
  }, 'image/jpeg', 0.93);
}

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  const c = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
  return c.find(t => MediaRecorder.isTypeSupported(t)) ?? '';
}

function startRec() {
  const mime = pickMime();
  if (mime === null) return toast('Registrazione non supportata su questo dispositivo');
  const out = cv.captureStream(30);
  const withAudio = [state.streams.rear, state.streams.front].find(s => s && s.getAudioTracks().length);
  if (withAudio) withAudio.getAudioTracks().forEach(t => out.addTrack(t.clone()));

  chunks = [];
  try { recorder = new MediaRecorder(out, { ...(mime && { mimeType: mime }), videoBitsPerSecond: 8e6 }); }
  catch { recorder = new MediaRecorder(out); }
  recorder.ondataavailable = e => e.data && e.data.size && chunks.push(e.data);
  recorder.onstop = () => {
    out.getTracks().forEach(t => t.stop());
    const type = (recorder.mimeType || mime || 'video/mp4').split(';')[0];
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    const blob = new Blob(chunks, { type });
    if (blob.size) review(new File([blob], `DuoCam-${stamp()}.${ext}`, { type }), 'video');
    else toast('Registrazione vuota');
  };
  recorder.start(1000);

  state.recording = true;
  recStart = Date.now();
  document.body.classList.add('is-rec');
  $('#shutter').classList.add('rec');
  $('#timer').classList.remove('off'); tick();
  timerId = setInterval(tick, 500);
}

function stopRec() {
  if (!state.recording) return;
  state.recording = false;
  clearInterval(timerId);
  $('#shutter').classList.remove('rec');
  $('#timer').classList.add('off');
  try { recorder.stop(); } catch {}
  sizeCanvas();
}

function tick() {
  const s = Math.floor((Date.now() - recStart) / 1000), p = n => String(n).padStart(2, '0');
  $('#timerTxt').textContent = `${p(Math.floor(s / 60))}:${p(s % 60)}`;
}

/* ---------- anteprima e salvataggio ---------- */
function review(file, kind) {
  if (state.current) URL.revokeObjectURL(state.current.url);
  const url = URL.createObjectURL(file);
  state.current = { file, url, kind };
  const m = $('#sheetMedia'); m.textContent = '';
  let el;
  if (kind === 'photo') { el = new Image(); el.src = url; }
  else { el = document.createElement('video'); el.src = url; el.controls = true; el.playsInline = true; el.loop = true; el.muted = false; }
  m.appendChild(el);
  $('#sheetHint').textContent = kind === 'photo'
    ? 'Nel foglio di condivisione scegli “Salva immagine”.'
    : 'Nel foglio di condivisione scegli “Salva video”.';
  $('#sheet').classList.add('show');
}

function closeReview() {
  $('#sheet').classList.remove('show');
  $('#sheetMedia').textContent = '';
  if (state.current) { URL.revokeObjectURL(state.current.url); state.current = null; }
}

async function saveCurrent() {
  const c = state.current; if (!c) return;
  try {
    if (navigator.canShare && navigator.canShare({ files: [c.file] })) {
      await navigator.share({ files: [c.file] });
      toast('Fatto');
    } else {
      const a = document.createElement('a');
      a.href = c.url; a.download = c.file.name; document.body.appendChild(a); a.click(); a.remove();
      toast('Condivisione non disponibile: file scaricato');
    }
  } catch (e) {
    if (e.name !== 'AbortError') toast('Salvataggio non riuscito: ' + e.message);
  }
}

/* ---------- controlli ---------- */
function syncUI() {
  document.querySelectorAll('#corners button').forEach(b => b.classList.toggle('on', b.dataset.c === state.corner));
  document.querySelectorAll('#sizes button').forEach(b => b.classList.toggle('on', b.dataset.s === state.size));
  document.querySelectorAll('#modes button').forEach(b => b.classList.toggle('on', b.dataset.m === state.mode));
  $('#shutter').classList.toggle('video', state.mode === 'video');
}

$('#corners').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  state.corner = b.dataset.c; store.set('corner', state.corner); syncUI();
});
$('#sizes').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  state.size = b.dataset.s; store.set('size', state.size); syncUI();
});
$('#btnSettings').addEventListener('click', () => $('#pop').classList.toggle('show'));
cv.addEventListener('click', () => $('#pop').classList.remove('show'));
$('#btnSwap').addEventListener('click', () => {
  state.swap = !state.swap; store.set('swap', state.swap ? '1' : '0');
});
$('#modes').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || state.recording) return;
  state.mode = b.dataset.m; syncUI();
});
$('#shutter').addEventListener('click', () => {
  if (!state.started) return;
  if (state.mode === 'photo') takePhoto();
  else state.recording ? stopRec() : startRec();
});
$('#btnSave').addEventListener('click', saveCurrent);
$('#btnDiscard').addEventListener('click', closeReview);

async function lockScreen() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
}

$('#btnStart').addEventListener('click', async () => {
  const err = $('#startErr'); err.textContent = '';
  if (!navigator.mediaDevices?.getUserMedia) {
    err.textContent = 'Fotocamera non disponibile: apri l’app tramite HTTPS.'; return;
  }
  try {
    await startCameras();
    state.started = true;
    $('#start').classList.remove('show');
    lockScreen();
  } catch (e) {
    err.textContent = e.name === 'NotAllowedError'
      ? 'Accesso negato. Abilita fotocamera e microfono in Impostazioni › Safari (o per l’app) e riprova.'
      : 'Impossibile avviare le fotocamere: ' + (e.message || e.name);
  }
});

document.addEventListener('visibilitychange', async () => {
  if (document.hidden) {
    if (state.recording) stopRec();
    stopCameras();
  } else if (state.started) {
    try { await startCameras(); lockScreen(); } catch (e) { toast('Fotocamere non riavviate: ' + e.message); }
  }
});

/* ---------- avvio ---------- */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
sizeCanvas(); syncUI(); loop();
})();
