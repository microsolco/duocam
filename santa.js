/* Rilevamento volti (MediaPipe) + cappello e barba da Babbo Natale disegnati su canvas. */
(() => {
'use strict';

const MP_BUNDLE = './vendor/vision_bundle.mjs';
const MP_WASM = './vendor/wasm';
const MP_MODEL = './vendor/blaze_face_short_range.tflite';

const tracks = [];
let detector = null, video = null, running = false, lastTime = -1, notify = () => {};

const Santa = { enabled: true, ready: false };

/* ---------- rilevamento ---------- */
async function createDetector(vision) {
  const { FaceDetector, FilesetResolver } = vision;
  const fileset = await FilesetResolver.forVisionTasks(MP_WASM);
  const make = delegate => FaceDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MP_MODEL, delegate },
    runningMode: 'VIDEO',
    minDetectionConfidence: 0.5
  });
  try { return await make('GPU'); } catch { return await make('CPU'); }
}

Santa.init = async (videoEl, onStatus) => {
  video = videoEl;
  if (onStatus) notify = onStatus;
  if (detector || Santa._loading) return;
  Santa._loading = true;
  try {
    notify('Carico il riconoscimento volti…');
    const vision = await import(MP_BUNDLE);
    detector = await createDetector(vision);
    Santa.ready = true;
    running = true;
    notify('🎅 Pronto: inquadra un viso');
    loop();
  } catch (e) {
    notify('Riconoscimento volti non disponibile: ' + (e.message || e.name));
  } finally {
    Santa._loading = false;
  }
};

function loop() {
  if (!running) return;
  const v = video;
  if (Santa.enabled && v && v.readyState >= 2 && v.videoWidth && v.currentTime !== lastTime) {
    lastTime = v.currentTime;
    try {
      const res = detector.detectForVideo(v, performance.now());
      update(res.detections || [], v.videoWidth, v.videoHeight);
    } catch {}
  }
  setTimeout(loop, 40);
}

function update(dets, vw, vh) {
  const now = performance.now();
  for (const d of dets) {
    const k = d.keypoints;
    if (!k || k.length < 4) continue;
    let a = { x: k[0].x * vw, y: k[0].y * vh }, b = { x: k[1].x * vw, y: k[1].y * vh };
    if (a.x > b.x) [a, b] = [b, a];                       // a = occhio a sinistra nell'immagine
    const E = Math.hypot(b.x - a.x, b.y - a.y);
    if (E < 6) continue;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const dx = k[3].x * vw - cx, dy = k[3].y * vh - cy;   // bocca nel sistema locale del viso
    const my = Math.min(1.8, Math.max(0.8, (-dx * Math.sin(ang) + dy * Math.cos(ang)) / E));

    let t = null, best = 1.3 * E;
    for (const c of tracks) {
      const dist = Math.hypot(c.x - cx, c.y - cy);
      if (dist < Math.max(best, 1.3 * c.E)) { best = dist; t = c; }
    }
    if (!t) { tracks.push({ x: cx, y: cy, E, a: ang, my, seen: now }); continue; }
    const f = 0.6;
    t.x += (cx - t.x) * f; t.y += (cy - t.y) * f; t.E += (E - t.E) * f;
    t.a += (ang - t.a) * f; t.my += (my - t.my) * f; t.seen = now;
  }
  for (let i = tracks.length - 1; i >= 0; i--) if (now - tracks[i].seen > 400) tracks.splice(i, 1);
}

/* ---------- disegno (unità = distanza tra gli occhi) ---------- */
function blob(ctx, circles) {
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#c9d0db'; ctx.lineWidth = 0.05;
  for (const [x, y, r] of circles) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); }
  for (const [x, y, r] of circles) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
}

function drawBeard(ctx, my) {
  const half = [[1.22, 0.45], [1.28, 0.8], [1.2, my + 0.2], [1.0, my + 0.9], [0.65, my + 1.45], [0.25, my + 1.8]];
  const left = half.map(([x, y]) => [-x, y]);
  const outline = [...left, ...half.slice().reverse()];     // da sinistra, sotto il mento, a destra
  // interno
  ctx.beginPath();
  outline.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.lineTo(0.6, my - 0.32); ctx.quadraticCurveTo(0, my - 0.05, -0.6, my - 0.32);
  ctx.closePath();
  ctx.fillStyle = '#fff'; ctx.fill();
  // bordo "soffice"
  const circles = [];
  for (let i = 0; i < outline.length; i++) {
    const [x, y] = outline[i];
    circles.push([x, y, 0.27]);
    if (i + 1 < outline.length) circles.push([(x + outline[i + 1][0]) / 2, (y + outline[i + 1][1]) / 2, 0.25]);
  }
  blob(ctx, circles);
  ctx.beginPath();                                          // riempie di nuovo l'interno sopra i contorni interni
  outline.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill();
  // baffi
  blob(ctx, [[-0.3, my - 0.2, 0.24], [-0.56, my - 0.1, 0.2], [-0.78, my + 0.02, 0.16],
             [0.3, my - 0.2, 0.24], [0.56, my - 0.1, 0.2], [0.78, my + 0.02, 0.16]]);
}

function drawHat(ctx) {
  const g = ctx.createLinearGradient(-1.2, -2.7, 1.4, -0.8);
  g.addColorStop(0, '#e8252d'); g.addColorStop(1, '#a31219');
  ctx.beginPath();
  ctx.moveTo(-1.2, -0.8);
  ctx.bezierCurveTo(-1.2, -1.9, -0.4, -2.75, 0.55, -2.6);
  ctx.bezierCurveTo(1.15, -2.5, 1.6, -2.05, 1.55, -1.45);
  ctx.bezierCurveTo(1.3, -1.8, 1.1, -1.4, 1.2, -0.8);
  ctx.closePath();
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = '#74090f'; ctx.lineWidth = 0.035; ctx.lineJoin = 'round'; ctx.stroke();
  // pompon
  blob(ctx, [[1.55, -1.35, 0.3], [1.78, -1.28, 0.15], [1.34, -1.2, 0.15], [1.6, -1.62, 0.15], [1.4, -1.5, 0.14]]);
  // fascia
  const band = [];
  for (let x = -1.34; x <= 1.35; x += 0.2) band.push([x, -0.75, 0.27]);
  blob(ctx, band);
  ctx.fillStyle = '#fff'; ctx.fillRect(-1.34, -0.9, 2.68, 0.3);
}

Santa.draw = ctx => {
  const now = performance.now();
  for (const t of tracks) {
    const age = now - t.seen;
    const alpha = age < 120 ? 1 : Math.max(0, 1 - (age - 120) / 280);
    if (alpha <= 0) continue;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(t.x, t.y); ctx.rotate(t.a); ctx.scale(t.E, t.E);
    drawBeard(ctx, t.my);
    drawHat(ctx);
    ctx.restore();
  }
};

Santa._tracks = tracks;
window.Santa = Santa;
})();
