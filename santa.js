/* Rilevamento volti (MediaPipe) + cappello, barba, baffi e sopracciglia da Babbo Natale disegnati su canvas. */
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
    minDetectionConfidence: 0.45
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
  setTimeout(loop, 33);
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

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
    const sin = Math.sin(ang), cos = Math.cos(ang);
    // punto (naso, bocca) nel sistema locale del viso, in unità "distanza tra gli occhi"
    const local = p => {
      const dx = p.x * vw - cx, dy = p.y * vh - cy;
      return { x: (dx * cos + dy * sin) / E, y: (-dx * sin + dy * cos) / E };
    };
    const my = clamp(local(k[3]).y, 0.8, 1.8);
    const ny = clamp(k[2] ? local(k[2]).y : 0.6, 0.3, 1.2);
    const bw = d.boundingBox && d.boundingBox.width ? d.boundingBox.width / E : 2.4;
    const fw = clamp(bw, 1.9, 3.0);                       // larghezza del viso in unità E

    let t = null, best = Infinity;
    for (const c of tracks) {
      const dist = Math.hypot(c.x - cx, c.y - cy);
      if (dist < 1.3 * Math.max(E, c.E) && dist < best) { best = dist; t = c; }
    }
    if (!t) { tracks.push({ x: cx, y: cy, E, a: ang, my, ny, fw, seen: now, born: now }); continue; }
    const f = 0.6;
    t.x += (cx - t.x) * f; t.y += (cy - t.y) * f; t.E += (E - t.E) * f;
    t.a += (ang - t.a) * f; t.my += (my - t.my) * 0.4; t.ny += (ny - t.ny) * 0.4; t.fw += (fw - t.fw) * 0.3;
    t.seen = now;
  }
  for (let i = tracks.length - 1; i >= 0; i--) if (now - tracks[i].seen > 400) tracks.splice(i, 1);
}

// per prove e test: passa rilevamenti già pronti
Santa.feed = (dets, vw, vh) => update(dets, vw, vh);
Santa.reset = () => { tracks.length = 0; };

/* ---------- disegno (unità = distanza tra gli occhi, occhi in (±0.5, 0)) ---------- */
const WHITE = '#fff', EDGE = '#cfd6e2', SHADE = '#b9c1d0';
const rnd = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };  // casuale stabile (niente sfarfallio)

// cerchi lungo una spezzata, con raggio e posizione leggermente irregolari
function along(pts, step, r, seed = 0) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.round(len / step));
    for (let j = 0; j < n; j++) {
      const u = j / n, s = seed + i * 17 + j * 3;
      out.push([x0 + (x1 - x0) * u + (rnd(s) - .5) * step * .5,
                y0 + (y1 - y0) * u + (rnd(s + 1) - .5) * step * .5,
                r * (0.78 + 0.5 * rnd(s + 2))]);
    }
  }
  const [lx, ly] = pts[pts.length - 1];
  out.push([lx, ly, r]);
  return out;
}

function blob(ctx, circles, { fill = WHITE, edge = EDGE, dy = 0, lw = 0.04 } = {}) {
  if (edge) {
    ctx.strokeStyle = edge; ctx.lineWidth = lw;
    for (const [x, y, r] of circles) { ctx.beginPath(); ctx.arc(x, y + dy, r, 0, Math.PI * 2); ctx.stroke(); }
  }
  ctx.fillStyle = fill;
  for (const [x, y, r] of circles) { ctx.beginPath(); ctx.arc(x, y + dy, r, 0, Math.PI * 2); ctx.fill(); }
}

const mirrorPts = pts => pts.map(([x, y]) => [-x, y]);

function drawCheeks(ctx, hw, ny) {
  for (const s of [-1, 1]) {
    const x = s * hw * 0.62, y = ny + 0.05;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 0.45);
    g.addColorStop(0, 'rgba(255,92,100,.38)'); g.addColorStop(1, 'rgba(255,92,100,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 0.45, 0, Math.PI * 2); ctx.fill();
  }
}

function drawBeard(ctx, my, ny, hw) {
  const bw = hw * 0.98;
  const half = [[1.0, 0.3], [1.03, my * 0.7], [0.93, my + 0.35], [0.72, my + 1.0], [0.42, my + 1.55], [0.15, my + 1.85], [0, my + 1.95]]
    .map(([x, y]) => [x * bw, y]);
  // contorno: da sinistra (alto), giù sotto il mento, a destra (alto)
  const left = mirrorPts(half).slice(0, -1);               // senza il punto centrale duplicato
  const loop = [...left, half[half.length - 1], ...half.slice(0, -1).reverse()];

  // 1) ombra/profondità dietro
  blob(ctx, along(loop, 0.2, 0.3, 1), { fill: SHADE, edge: null, dy: 0.07 });
  // 2) ciuffi sul bordo, poi corpo che riempie l'interno
  blob(ctx, along(loop, 0.19, 0.3, 40), { fill: WHITE, edge: EDGE });
  ctx.beginPath();
  loop.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.lineTo(bw * 0.6, my - 0.4); ctx.lineTo(-bw * 0.6, my - 0.4); ctx.closePath();
  const g = ctx.createLinearGradient(0, my - 0.4, 0, my + 2);
  g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#e7ebf3');
  ctx.fillStyle = g; ctx.fill();

  // 3) ciocche
  ctx.strokeStyle = 'rgba(122,134,158,.28)'; ctx.lineWidth = 0.028; ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const x0 = s * bw * (0.25 + i * 0.2), y0 = my + 0.15 + (i % 2) * 0.15;
      ctx.beginPath(); ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(x0 + s * 0.1, y0 + 0.55, x0 - s * 0.08 * (i + 1) * 0.5, my + 1.05 + i * 0.2 - Math.abs(i - 1) * 0.05);
      ctx.stroke();
    }
  }
  ctx.beginPath(); ctx.moveTo(0, my + 0.3); ctx.quadraticCurveTo(0.06, my + 0.9, 0, my + 1.6); ctx.stroke();

  // 4) basette fino sotto il cappello
  for (const s of [-1, 1]) {
    const side = along([[s * bw * 1.0, -0.45], [s * bw * 1.02, 0.1], [s * bw * 1.0, 0.45]], 0.16, 0.2, 200 + s * 7);
    blob(ctx, side);
  }
}

function drawMustache(ctx, my, ny, hw) {
  const top = Math.max(my - 0.34, ny + 0.2);              // non coprire il naso
  const mw = hw * 0.62;
  const lobe = s => along([[0.02 * s, top + 0.12], [s * mw * 0.38, top + 0.12], [s * mw * 0.78, top + 0.22], [s * mw * 1.02, top + 0.1], [s * mw * 1.12, top - 0.08]], 0.12, 0.17, 300 + s * 5);
  const circles = [...lobe(-1), ...lobe(1)];
  blob(ctx, circles, { fill: SHADE, edge: null, dy: 0.06 });
  blob(ctx, circles, { fill: WHITE, edge: EDGE });
}

function drawBrows(ctx) {
  for (const s of [-1, 1]) {
    const pts = [[s * 0.2, -0.3], [s * 0.45, -0.42], [s * 0.7, -0.44], [s * 0.88, -0.36]];
    blob(ctx, along(pts, 0.1, 0.1, 500 + s * 3), { edge: 'rgba(160,170,190,.7)', lw: 0.03 });
  }
}

function drawHat(ctx, hw) {
  const hh = hw * 1.14, by = -0.8, k = hh / 1.3;
  const curve = x => 0.09 * (1 - (x / hh) ** 2);

  // ombra del cappello sulla fronte
  const sg = ctx.createLinearGradient(0, by + 0.12, 0, by + 0.5);
  sg.addColorStop(0, 'rgba(70,25,25,.32)'); sg.addColorStop(1, 'rgba(70,25,25,0)');
  ctx.fillStyle = sg; ctx.fillRect(-hh * 0.92, by + 0.12, hh * 1.84, 0.4);

  // corpo rosso (coordinate di base scalate sulla larghezza del cappello)
  ctx.save();
  ctx.translate(0, by - 0.05); ctx.scale(k, k); ctx.translate(0, 0.8);
  const g = ctx.createLinearGradient(-1.3, -2.7, 1.5, -0.8);
  g.addColorStop(0, '#ef3a41'); g.addColorStop(0.55, '#d1202a'); g.addColorStop(1, '#8f0f17');
  ctx.beginPath();
  ctx.moveTo(-1.22, -0.7);
  ctx.bezierCurveTo(-1.2, -1.9, -0.4, -2.75, 0.55, -2.6);
  ctx.bezierCurveTo(1.15, -2.5, 1.6, -2.05, 1.55, -1.45);
  ctx.bezierCurveTo(1.3, -1.8, 1.1, -1.4, 1.22, -0.7);
  ctx.closePath();
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = '#6a080e'; ctx.lineWidth = 0.035; ctx.lineJoin = 'round'; ctx.stroke();
  // pieghe e luce
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(70,0,5,.3)'; ctx.lineWidth = 0.03;
  for (const [a, b, c, d, e, f] of [[-0.55, -1.0, -0.4, -1.5, -0.5, -2.2], [0.15, -0.95, 0.35, -1.55, 0.25, -2.35], [0.75, -0.95, 0.95, -1.35, 1.1, -1.6]]) {
    ctx.beginPath(); ctx.moveTo(a, b); ctx.quadraticCurveTo(c, d, e, f); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 0.05;
  ctx.beginPath(); ctx.moveTo(-0.95, -1.0); ctx.bezierCurveTo(-0.95, -1.8, -0.4, -2.35, 0.2, -2.45); ctx.stroke();
  // pompon
  const pom = [[1.55, -1.35, 0.3], [1.8, -1.28, 0.16], [1.33, -1.2, 0.16], [1.62, -1.64, 0.16], [1.4, -1.52, 0.15], [1.74, -1.5, 0.14], [1.48, -1.08, 0.14]];
  blob(ctx, pom, { dy: 0.03, fill: SHADE, edge: null });
  blob(ctx, pom);
  ctx.restore();

  // fascia di pelliccia che segue la curvatura della fronte
  const band = [];
  for (let x = -hh; x <= hh + 0.01; x += 0.15) band.push([x, by + curve(x), 0.26 + (Math.abs(x) > hh * 0.9 ? 0.05 : 0)]);
  blob(ctx, band, { fill: SHADE, edge: null, dy: 0.05 });
  blob(ctx, band);
  ctx.beginPath();
  for (let x = -hh; x <= hh; x += 0.1) ctx.lineTo(x, by - 0.1 + curve(x));
  for (let x = hh; x >= -hh; x -= 0.1) ctx.lineTo(x, by + 0.16 + curve(x));
  ctx.closePath(); ctx.fillStyle = WHITE; ctx.fill();
}

const ease = u => 1 - (1 - u) * (1 - u);

Santa.draw = ctx => {
  const now = performance.now();
  for (const t of tracks) {
    const age = now - t.seen;
    const fade = age < 120 ? 1 : Math.max(0, 1 - (age - 120) / 280);
    const pop = Math.min(1, (now - t.born) / 220);
    const alpha = fade * pop;
    if (alpha <= 0) continue;
    const hw = clamp(t.fw / 2, 1.0, 1.5);                  // mezza larghezza del viso (unità E)
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(t.x, t.y); ctx.rotate(t.a); ctx.scale(t.E * (0.75 + 0.25 * ease(pop)), t.E * (0.75 + 0.25 * ease(pop)));
    drawCheeks(ctx, hw, t.ny);
    drawBeard(ctx, t.my, t.ny, hw);
    drawMustache(ctx, t.my, t.ny, hw);
    drawBrows(ctx);
    drawHat(ctx, hw);
    ctx.restore();
  }
};

window.Santa = Santa;
})();
