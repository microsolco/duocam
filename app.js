(() => {
'use strict';

const $ = s => document.querySelector(s);
const cv = $('#view'), ctx = cv.getContext('2d');
const vid = { rear: $('#vRear') };

const store = {
  get(k, d) { try { return localStorage.getItem('duocam.' + k) || d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('duocam.' + k, v); } catch {} }
};

const state = {
  mode: 'photo',
  started: false,
  recording: false,
  streams: { rear: null },
  current: null                            // { file, url, kind }
};

let recorder = null, chunks = [], recStart = 0, timerId = 0, wakeLock = null;

/* ---------- utilità UI ---------- */
function toast(msg, ms = 2400) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

const even = n => Math.round(n / 2) * 2;
function sizeCanvas() {
  if (state.recording) return;
  const iw = innerWidth, ih = innerHeight, L = 1920;
  if (ih >= iw) { cv.height = L; cv.width = even(L * iw / ih); }
  else { cv.width = L; cv.height = even(L * ih / iw); }
}
addEventListener('resize', sizeCanvas);
addEventListener('orientationchange', () => setTimeout(sizeCanvas, 250));

/* ---------- fotocamera posteriore ---------- */
const gum = c => navigator.mediaDevices.getUserMedia(c);

async function openCam(withAudio) {
  const tries = [
    { video: { facingMode: { exact: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: withAudio },
    { video: { facingMode: 'environment' }, audio: withAudio },
    { video: { facingMode: 'environment' }, audio: false }
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
  stopStream(state.streams.rear);
  state.streams.rear = null;
  vid.rear.srcObject = null;
}

async function attach(which, stream) {
  state.streams[which] = stream;
  vid[which].srcObject = stream;
  try { await vid[which].play(); } catch {}
}

async function startCameras() {
  stopCameras();
  await attach('rear', await openCam(true));
}

/* ---------- composizione su canvas ---------- */
function draw() {
  const W = cv.width, H = cv.height, v = vid.rear;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const vw = v.videoWidth, vh = v.videoHeight;
  if (!vw || !vh) return;

  // riempie lo schermo (cover)
  const s = Math.max(W / vw, H / vh), dx = (W - vw * s) / 2, dy = (H - vh * s) / 2;
  ctx.drawImage(v, dx, dy, vw * s, vh * s);

  // cappello e barba da Babbo Natale (coordinate del video)
  if (window.Santa && Santa.enabled && Santa.ready) {
    ctx.save(); ctx.translate(dx, dy); ctx.scale(s, s); Santa.draw(ctx); ctx.restore();
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
  const src = state.streams.rear;
  if (src) src.getAudioTracks().forEach(t => out.addTrack(t.clone()));

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
  document.querySelectorAll('#modes button').forEach(b => b.classList.toggle('on', b.dataset.m === state.mode));
  $('#shutter').classList.toggle('video', state.mode === 'video');
}

Santa.enabled = store.get('santa', '1') === '1';
$('#btnSanta').classList.toggle('off', !Santa.enabled);
$('#btnSanta').addEventListener('click', () => {
  Santa.enabled = !Santa.enabled; store.set('santa', Santa.enabled ? '1' : '0');
  $('#btnSanta').classList.toggle('off', !Santa.enabled);
  toast(Santa.enabled ? '🎅 Babbo Natale attivo' : 'Babbo Natale disattivato');
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
    Santa.init(vid.rear, msg => toast(msg, 3000));
  } catch (e) {
    err.textContent = e.name === 'NotAllowedError'
      ? 'Accesso negato. Abilita fotocamera e microfono in Impostazioni › Safari (o per l’app) e riprova.'
      : 'Impossibile avviare la fotocamera: ' + (e.message || e.name);
  }
});

document.addEventListener('visibilitychange', async () => {
  if (document.hidden) {
    if (state.recording) stopRec();
    stopCameras();
  } else if (state.started) {
    try { await startCameras(); lockScreen(); } catch (e) { toast('Fotocamera non riavviata: ' + e.message); }
  }
});

/* ---------- avvio ---------- */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
sizeCanvas(); syncUI(); loop();
})();
