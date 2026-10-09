// the sequencer + voice renderer. no dom in here, it runs inside the audio worklet
// (and in node, which is handy for testing)

import { compile, F } from './expr.js';
import { Theory } from './theory.js';

const MAX_NOTES = 24;
export const mtof = F.mtof;

// ch() and deg() look up the current theory through this object
export function harmony(theory) {
  const h = {
    theory,
    ch: (bar, j) => h.theory.ch(bar, j),
    deg: (bar, d) => h.theory.deg(bar, d),
  };
  return h;
}

export function compileVoice(v, h) {
  const sound = compile(v.sound, 'sound', h);
  const hit = compile(v.hit, 'hit', h);
  const note = compile(v.note, 'note', h);
  return { sound: sound.fn, hit: hit.fn, note: note.fn, slots: sound.slots };
}

export class Engine {
  constructor(sr) {
    this.sr = sr;
    this.h = harmony(new Theory());
    this.voices = [];
    this.bpm = 120;
    this.steps = 128;
    this.playing = false;
    this.step = 0;
    this.left = 0; // samples until the next step fires
    this.tmp = new Float64Array(8192);
  }

  get stepLen() {
    return this.sr * 15 / this.bpm;
  }

  setSong(song) {
    const before = this.stepLen;
    this.bpm = Math.min(400, Math.max(20, +song.bpm || 120));
    this.steps = Math.max(1, Math.round(+song.bars || 8)) * 16;
    if (this.playing) {
      this.left *= this.stepLen / before;
      this.step %= this.steps;
    }
    try {
      this.h.theory = new Theory(song.key, song.scale, song.prog, song.per);
    } catch (e) {
      // bad chord text, keep the last good one
    }
    const solo = song.voices.some((v) => v.solo);
    const old = new Map(this.voices.map((v) => [v.id, v]));
    this.voices = song.voices.map((v) => {
      const prev = old.get(v.id);
      let fns = null;
      try {
        fns = compileVoice(v, this.h);
      } catch (e) {
        fns = null;
      }
      const on = !v.mute && (!solo || v.solo);
      const gain = on ? Math.max(0, +v.gain || 0) : 0;
      const pan = Math.max(-1, Math.min(1, +v.pan || 0));
      return {
        id: v.id,
        fns: fns || (prev && prev.fns),
        on,
        mono: !!v.mono,
        len: Math.max(0.05, +v.len || 1),
        gl: gain * Math.min(1, 1 - pan),
        gr: gain * Math.min(1, 1 + pan),
        rv: gain * Math.max(0, +v.rev || 0),
        cl: prev ? prev.cl : 0,
        cr: prev ? prev.cr : 0,
        cv: prev ? prev.cv : 0,
        notes: prev ? prev.notes : [],
      };
    });
  }

  start(from = 0) {
    this.playing = true;
    this.step = Math.max(0, Math.floor(from)) % this.steps;
    this.left = 0;
  }

  stop() {
    this.playing = false;
    for (const v of this.voices) for (const nt of v.notes) if (!nt.kill) nt.kill = nt.kl = 256;
  }

  position() {
    if (!this.playing) return 0;
    const p = this.step - this.left / this.stepLen;
    return ((p % this.steps) + this.steps) % this.steps;
  }

  fire(n) {
    const s = n % 16, bar = Math.floor(n / 16);
    const th = this.h.theory, k = th.index(bar), root = th.root(bar);
    const secs = this.stepLen / this.sr;
    for (const v of this.voices) {
      if (!v.fns || !v.on) continue;
      let hv;
      try {
        hv = +v.fns.hit(n, s, bar, k);
      } catch (e) {
        continue;
      }
      if (!(hv > 0)) continue;
      let out;
      try {
        out = v.fns.note(n, s, bar, k, root);
      } catch (e) {
        continue;
      }
      if (v.mono) for (const nt of v.notes) if (!nt.kill) nt.kill = nt.kl = 192;
      const d = v.len * secs;
      for (const m of Array.isArray(out) ? out : [out]) {
        if (!(m > 0 && m < 160)) continue;
        if (v.notes.length >= MAX_NOTES) v.notes.shift();
        v.notes.push({
          fn: v.fns.sound, S: new Float64Array(v.fns.slots), f: mtof(m), m, v: Math.min(1, hv), d,
          i: 0, end: Math.max(2, Math.round(d * this.sr)), kill: 0, kl: 1,
        });
      }
    }
  }

  render(L, R, VL, VR, from, count) {
    const sr = this.sr, buf = this.tmp;
    for (const v of this.voices) {
      // ramp gains across the block so mute/gain changes don't click
      const gl = v.cl, gr = v.cr, gv = v.cv;
      const dl = (v.gl - gl) / count, dr = (v.gr - gr) / count, dv = (v.rv - gv) / count;
      v.cl = v.gl;
      v.cr = v.gr;
      v.cv = v.rv;
      const notes = v.notes;
      if (!notes.length) continue;
      buf.fill(0, 0, count);
      for (let q = notes.length - 1; q >= 0; q--) {
        const nt = notes[q];
        const fn = nt.fn, f = nt.f, vel = nt.v, d = nt.d, m = nt.m, S = nt.S, end = nt.end;
        const fade = Math.min(256, end >> 2);
        let i = nt.i, done = false;
        for (let a = 0; a < count; a++) {
          let y = fn(i / sr, f, vel, i, d, m, sr, S);
          if (!(y > -8 && y < 8)) y = y > 0 ? 8 : y < 0 ? -8 : 0; // also catches NaN
          if (i < 16) y *= i / 16;
          if (nt.kill) {
            y *= nt.kill / nt.kl;
            if (--nt.kill === 0) done = true;
          } else if (i > end - fade) {
            y *= Math.max(0, end - i) / fade;
            if (i >= end) done = true;
          }
          buf[a] += y;
          i++;
          if (done) break;
        }
        nt.i = i;
        if (done) notes.splice(q, 1);
      }
      for (let a = 0; a < count; a++) {
        const y = buf[a], o = from + a;
        L[o] += y * (gl + dl * a);
        R[o] += y * (gr + dr * a);
        if (VL) {
          const w = y * (gv + dv * a);
          VL[o] += w;
          VR[o] += w;
        }
      }
    }
  }

  process(L, R, VL, VR, frames) {
    let j = 0;
    while (j < frames) {
      if (this.playing && this.left <= 0) {
        this.fire(this.step);
        this.step = (this.step + 1) % this.steps;
        this.left += this.stepLen;
      }
      let seg = Math.min(frames - j, this.tmp.length);
      if (this.playing) seg = Math.max(1, Math.min(seg, Math.ceil(this.left)));
      this.render(L, R, VL, VR, j, seg);
      j += seg;
      if (this.playing) this.left -= seg;
    }
  }
}
