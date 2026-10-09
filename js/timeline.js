// the arrangement view: every hit of every voice across the whole loop.
// the canvas only covers the visible part and gets redrawn as you scroll

export const RULER = 30, ROW = 36, GAP = 4;

export class Timeline {
  constructor(scroller, inner, canvas, { onSelect, onSeek }) {
    this.sc = scroller;
    this.inner = inner;
    this.cv = canvas;
    this.rows = [];
    this.labels = [];
    this.steps = 16;
    this.stepW = 12;
    this.height = RULER;
    this.zoom = 1;
    this.touched = 0;
    // stop auto-follow for a bit when someone scrolls by hand
    const mark = () => (this.touched = performance.now());
    scroller.addEventListener('wheel', mark, { passive: true });
    scroller.addEventListener('pointerdown', mark);
    new ResizeObserver(() => this.layout()).observe(scroller);
    canvas.addEventListener('click', (e) => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      if (y < RULER) {
        const n = Math.floor((x + this.sc.scrollLeft) / this.stepW);
        onSeek(Math.max(0, Math.min(this.steps - 1, n)));
        return;
      }
      const i = Math.floor((y - RULER - GAP) / (ROW + GAP));
      if (i >= 0 && i < this.rows.length) onSelect(i);
    });
  }

  // rows: [{ hits: [{ n, ms, v, next }], lo, hi, len, mono, on }], labels: chord name per bar or ''
  setData(rows, steps, labels) {
    this.rows = rows;
    this.steps = steps;
    this.labels = labels;
    this.layout();
  }

  // zoom 1 fits the whole loop in view (as long as steps stay at least 3px wide)
  setZoom(z) {
    const old = this.stepW, vw = this.sc.clientWidth;
    const mid = (this.sc.scrollLeft + vw / 2) / old;
    this.zoom = Math.max(1, Math.min(16, z));
    this.layout();
    this.sc.scrollLeft = mid * this.stepW - vw / 2;
    this.touched = performance.now();
  }

  layout() {
    const vw = this.sc.clientWidth || 600;
    this.stepW = Math.min(48, Math.max(3, vw / this.steps) * (this.zoom || 1));
    this.inner.style.width = Math.ceil(this.steps * this.stepW) + 'px';
    this.height = RULER + GAP + this.rows.length * (ROW + GAP);
    this.inner.style.height = this.height + 'px';
  }

  draw(stepF, cue, sel, look) {
    const cv = this.cv, dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = this.sc.clientWidth, H = this.height;
    if (!W) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      cv.style.width = W + 'px';
      cv.style.height = H + 'px';
    }
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);

    // follow the playhead, page by page
    if (stepF !== null && performance.now() - this.touched > 2500) {
      const px = stepF * this.stepW - this.sc.scrollLeft;
      if (px < W * 0.05 || px > W * 0.9) this.sc.scrollLeft = Math.max(0, stepF * this.stepW - W * 0.1);
    }
    const sl = this.sc.scrollLeft, sw = this.stepW;
    const X = (n) => n * sw - sl;
    const n0 = Math.max(0, Math.floor(sl / sw)), n1 = Math.min(this.steps, Math.ceil((sl + W) / sw) + 1);
    const rowY = (i) => RULER + GAP + i * (ROW + GAP);

    this.rows.forEach((r, i) => {
      c.fillStyle = i === sel ? look.well : look.panel;
      c.fillRect(0, rowY(i), W, ROW);
    });

    // grid + ruler
    c.font = `11px ${look.mono}`;
    c.textBaseline = 'middle';
    for (let n = n0 - (n0 % 4); n < n1; n += 4) {
      const x = Math.round(X(n)) + 0.5, isBar = n % 16 === 0;
      c.fillStyle = look.line;
      c.globalAlpha = isBar ? 1 : 0.45;
      c.fillRect(x, isBar ? 0 : RULER - 6, 1, H);
      c.globalAlpha = 1;
      if (isBar) {
        const bar = n / 16;
        c.fillStyle = look.ink;
        c.fillText(String(bar + 1), x + 4, 9);
        if (this.labels[bar]) {
          c.fillStyle = look.dim;
          c.fillText(this.labels[bar], x + 4, 22);
        }
      }
    }

    // hits
    this.rows.forEach((r, i) => {
      const y0 = rowY(i);
      const flat = !(r.hi > r.lo);
      c.save();
      c.beginPath();
      c.rect(0, y0, W, ROW);
      c.clip();
      for (const h of r.hits) {
        const dur = Math.max(0.5, r.mono ? Math.min(r.len, h.next - h.n) : r.len);
        if (h.n > n1 || h.n + dur < n0) continue;
        const x = X(h.n) + 1, w = Math.max(2, dur * sw - 2);
        const live = stepF !== null && stepF >= h.n && stepF < h.n + dur;
        const a = (r.on ? 1 : 0.3) * (live ? 1 : 0.35 + 0.45 * h.v);
        c.fillStyle = look.ink;
        if (flat) {
          const hh = Math.max(3, (ROW - 8) * h.v);
          c.globalAlpha = a * 0.35;
          c.fillRect(x, y0 + ROW - 4 - hh, w, hh);
          c.globalAlpha = a;
          c.fillRect(x, y0 + ROW - 4 - hh, w, 2);
        } else {
          c.globalAlpha = a;
          for (const m of h.ms) {
            const y = y0 + 4 + (1 - (m - r.lo) / (r.hi - r.lo)) * (ROW - 12);
            c.fillRect(x, y, w, 4);
          }
        }
      }
      c.restore();
    });

    c.globalAlpha = 1;
    const head = stepF !== null ? stepF : cue > 0 ? cue : null;
    if (head !== null) {
      c.fillStyle = look.hot;
      c.globalAlpha = stepF !== null ? 1 : 0.5;
      c.fillRect(Math.round(X(head)), 0, 1.5, H);
      c.globalAlpha = 1;
    }
  }
}
