// canvas drawing for the big plot

const TAU = Math.PI * 2;

// run a voice's sound function offline so it can be drawn
export function renderCurve(fn, slots, f, m, v, d, sr, maxSecs) {
  const n = Math.max(2, Math.round(Math.min(d, maxSecs) * sr));
  const data = new Float32Array(n);
  const S = new Float64Array(slots);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    let y = fn(i / sr, f, v, i, d, m, sr, S);
    if (!(y > -8 && y < 8)) y = y > 0 ? 8 : y < 0 ? -8 : 0;
    data[i] = y;
    const a = Math.abs(y);
    if (a > peak) peak = a;
  }
  // how much quieter the last quarter is than the first, < 1 means it decays
  const q = n >> 2;
  let e0 = 0, e1 = 0;
  for (let i = 0; i < q; i++) {
    e0 += data[i] * data[i];
    e1 += data[n - 1 - i] * data[n - 1 - i];
  }
  return { data, peak, sr, decay: e0 > 0 ? Math.sqrt(e1 / e0) : 1 };
}

function backdrop(c, W, H, box, look, pulse, time) {
  const g = c.createRadialGradient(W * 0.5, H * 0.42, 0, W * 0.5, H * 0.42, Math.max(W, H) * 0.75);
  g.addColorStop(0, look.well);
  g.addColorStop(1, look.bg);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  // seven faint orbits behind the plot
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const R = Math.min(box.x1 - box.x0, box.y1 - box.y0) * 0.55;
  c.save();
  c.strokeStyle = look.ink;
  c.lineWidth = 1;
  for (let i = 0; i < 7; i++) {
    c.globalAlpha = 0.045 + 0.07 * pulse * (1 - i / 9);
    const rot = i * Math.PI / 7 + (look.still ? 0 : time * 0.05 * (i % 2 ? 1 : -1));
    c.beginPath();
    c.ellipse(cx, cy, R * (0.3 + i * 0.11), R * (0.12 + i * 0.05), rot, 0, TAU);
    c.stroke();
  }
  c.restore();
}

function axes(c, box, U, look, xl, yl) {
  const ya = (box.y0 + box.y1) / 2, xa = box.x0;
  c.save();
  c.strokeStyle = look.ink;
  c.fillStyle = look.ink;
  c.globalAlpha = 0.75;
  c.lineWidth = Math.max(1, U * 0.16);
  c.beginPath();
  c.moveTo(box.x0 - U * 1.5, ya);
  c.lineTo(box.x1 + U * 2.4, ya);
  c.moveTo(xa, box.y1 + U * 1.5);
  c.lineTo(xa, box.y0 - U * 2.4);
  c.stroke();
  c.beginPath();
  c.moveTo(box.x1 + U * 4, ya);
  c.lineTo(box.x1 + U * 1.8, ya - U * 1.1);
  c.lineTo(box.x1 + U * 1.8, ya + U * 1.1);
  c.fill();
  c.beginPath();
  c.moveTo(xa, box.y0 - U * 4);
  c.lineTo(xa - U * 1.1, box.y0 - U * 1.8);
  c.lineTo(xa + U * 1.1, box.y0 - U * 1.8);
  c.fill();
  c.globalAlpha = 0.95;
  c.font = `italic ${U * 4.2}px ${look.math}`;
  c.fillText(xl, box.x1 + U * 1.2, ya - U * 2.2);
  c.fillText(yl, xa + U * 1.8, box.y0 - U * 1.6);
  c.restore();
}

// samples a..b as a path. dense stretches get min/max columns, sparse ones a polyline
function wavePath(data, a, b, X, Y, sr, px) {
  const p = new Path2D();
  const n = b - a;
  if (n / px > 3) {
    const cols = Math.max(1, Math.floor(px));
    for (let k = 0; k < cols; k++) {
      const i0 = a + Math.floor(n * k / cols), i1 = Math.max(i0 + 1, a + Math.floor(n * (k + 1) / cols));
      let lo = Infinity, hi = -Infinity;
      for (let i = i0; i < i1; i++) {
        const y = data[i];
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
      const x = X((i0 + i1) / 2 / sr);
      p.moveTo(x, Y(hi));
      p.lineTo(x, Y(lo) + 0.5);
    }
  } else {
    for (let i = a; i < b; i++) {
      const x = X(i / sr), y = Y(data[i]);
      i === a ? p.moveTo(x, y) : p.lineTo(x, y);
    }
  }
  return p;
}

function glow(c, p, w, alpha, blur, look) {
  c.save();
  c.strokeStyle = look.ink;
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.globalAlpha = alpha;
  c.lineWidth = w;
  if (blur) {
    c.shadowColor = look.ink;
    c.shadowBlur = blur;
  }
  c.stroke(p);
  c.restore();
}

function dot(c, x, y, r, look) {
  c.save();
  c.shadowColor = look.hot;
  c.shadowBlur = r * 3;
  c.fillStyle = look.ink;
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fill();
  c.restore();
}

// st: { data, peak, sr, tau, f, mode, pulse } or null
export function drawStage(c, W, H, box, st, look, time) {
  const U = Math.min(W, H) / 100;
  backdrop(c, W, H, box, look, st ? st.pulse : 0, time);
  axes(c, box, U, look, 't', 'y');
  if (!st) return;
  const span = Math.max(st.peak * 1.15, 0.05);
  const mid = (box.y0 + box.y1) / 2, half = (box.y1 - box.y0) / 2;
  const Y = (y) => mid - y / span * half;
  const px = box.x1 - box.x0;
  const dur = st.data.length / st.sr;
  const k = 1 + 0.012 * st.pulse;
  c.save();
  if (!look.still) {
    c.translate((box.x0 + box.x1) / 2, mid);
    c.scale(k, k);
    c.translate(-(box.x0 + box.x1) / 2, -mid);
  }
  if (st.mode === 'note') {
    const X = (t) => box.x0 + t / dur * px;
    const p = wavePath(st.data, 0, st.data.length, X, Y, st.sr, px);
    glow(c, p, U * 0.24, 0.22, 0, look);
    const upto = Math.min(st.tau, dur);
    c.save();
    c.beginPath();
    c.rect(0, 0, X(upto), c.canvas.height);
    c.clip();
    glow(c, p, U * 0.3, 1, U * 1.6, look);
    c.restore();
    if (st.tau < dur) {
      const i = Math.min(st.data.length - 1, Math.floor(st.tau * st.sr));
      dot(c, X(st.tau), Y(st.data[i]), U * 0.8, look);
    }
  } else {
    // a few periods of the waveform, read at the current spot in the note
    const win = Math.min(Math.max(3 / st.f, 0.002), 0.25, dur);
    let start = Number.isFinite(st.tau) ? st.tau : dur * 0.25;
    start = Math.max(0, Math.min(start, dur - win));
    const a = Math.floor(start * st.sr), b = Math.min(st.data.length, a + Math.ceil(win * st.sr));
    const X = (t) => box.x0 + (t - start) / win * px;
    const p = wavePath(st.data, a, b, X, Y, st.sr, px);
    const live = Number.isFinite(st.tau) && st.tau < dur;
    glow(c, p, U * 0.36, live || !Number.isFinite(st.tau) ? 1 : 0.35, U * 1.6, look);
    if (live) dot(c, box.x0, Y(st.data[a]), U * 0.8, look);
  }
  c.restore();
}
