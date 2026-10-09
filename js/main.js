import { compile, toTex, where } from './expr.js';
import { Theory, KEYS, SCALES } from './theory.js';
import { harmony, mtof } from './engine.js';
import { SONGS, INSTRUMENTS } from './presets.js';
import { renderCurve, drawStage } from './stage.js';
import { Timeline } from './timeline.js';
import { wavFile } from './wav.js';
import './tips.js';

const $ = (id) => document.getElementById(id);
const STORE = 'locus.song';
const VIS_SR = 48000;
const WORKLET = new URL('./worklet.js', import.meta.url);

const css = getComputedStyle(document.documentElement);
const look = {
  bg: css.getPropertyValue('--bg').trim(),
  well: css.getPropertyValue('--well').trim(),
  ink: css.getPropertyValue('--ink').trim(),
  hot: css.getPropertyValue('--hot').trim(),
  line: css.getPropertyValue('--line').trim(),
  panel: css.getPropertyValue('--panel').trim(),
  dim: css.getPropertyValue('--dim').trim(),
  mono: css.getPropertyValue('--mono').trim(),
  math: 'KaTeX_Math, "Times New Roman", serif',
  still: matchMedia('(prefers-reduced-motion: reduce)').matches,
};

let song = null;
let sel = 0;
let compiled = [];
const hm = harmony(new Theory());
const curves = new Map();

let ctx = null, node = null, analyser = null;
let playing = false;
let pos = { time: 0, step: 0, bpm: 120, playing: false };
let cue = 0; // where play starts from
let tl = null, tlDirty = true;

let lastId = 0;
const newId = () => 'v' + ++lastId;

function num(x, def, lo, hi) {
  x = parseFloat(x);
  if (!Number.isFinite(x)) return def;
  return Math.min(hi, Math.max(lo, x));
}

// ---- song data ----

function cleanVoice(v, keepId) {
  const base = INSTRUMENTS.sine;
  return {
    id: keepId || newId(),
    name: String(v.name ?? 'voice').slice(0, 24),
    sound: String(v.sound ?? base.sound),
    hit: String(v.hit ?? base.hit),
    note: String(v.note ?? base.note),
    len: num(v.len, 4, 0.25, 4096),
    mono: !!v.mono,
    gain: num(v.gain, 0.5, 0, 1.5),
    pan: num(v.pan, 0, -1, 1),
    rev: num(v.rev, 0, 0, 1),
    plot: ['auto', 'note', 'cycle'].includes(v.plot) ? v.plot : 'auto',
    mute: !!v.mute,
    solo: !!v.solo,
  };
}

function cleanSong(s) {
  s = s && typeof s === 'object' ? s : {};
  return {
    name: String(s.name || 'untitled').slice(0, 40),
    bpm: num(s.bpm, 120, 20, 400),
    key: KEYS.includes(s.key) ? s.key : 'C',
    scale: s.scale in SCALES ? s.scale : 'minor',
    prog: String(s.prog || 'Cm'),
    per: Math.round(num(s.per, 2, 1, 64)),
    bars: Math.round(num(s.bars, 8, 1, 256)),
    voices: (Array.isArray(s.voices) ? s.voices : []).slice(0, 32).map((v) => cleanVoice(v)),
  };
}

// what gets saved and shared (no ids)
const plain = () => ({ ...song, voices: song.voices.map(({ id, ...v }) => v) });

function compileVoice(i) {
  const v = song.voices[i];
  const c = { ok: true, err: {}, tex: [], ver: (compiled[i]?.ver || 0) + 1 };
  for (const kind of ['sound', 'hit', 'note']) {
    try {
      c[kind] = compile(v[kind], kind, hm);
    } catch (e) {
      c.ok = false;
      c.err[kind] = e.pos !== undefined ? where(v[kind], e) : e.message;
    }
  }
  if (c.sound) c.tex = toTex(c.sound);
  compiled[i] = c;
}

function applyTheory() {
  try {
    hm.theory = new Theory(song.key, song.scale, song.prog, song.per);
    $('harmErr').textContent = '';
  } catch (e) {
    $('harmErr').textContent = e.message;
  }
}

function loadSong(s) {
  song = cleanSong(s);
  sel = 0;
  cue = 0;
  compiled = [];
  curves.clear();
  applyTheory();
  song.voices.forEach((_, i) => compileVoice(i));
  fillHeader();
  buildNames();
  showEditor();
  changed(true, true);
}

let pushTimer = 0;
function changed(now, keepLink) {
  tlDirty = true;
  // a shared link in the address bar is a snapshot. once you edit, drop it so a
  // refresh brings back your latest version (from local storage) instead of the old link
  if (!keepLink && location.hash) history.replaceState(null, '', location.pathname);
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    if (node) node.port.postMessage({ type: 'song', song });
    try {
      localStorage.setItem(STORE, JSON.stringify(plain()));
    } catch (e) {
      // private mode etc, not a big deal
    }
  }, now ? 0 : 120);
}

// ---- audio ----

function impulse(ac, secs) {
  const n = Math.round(secs * ac.sampleRate);
  const b = ac.createBuffer(2, n, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / ac.sampleRate;
      const x = Math.sin((i + ch * 7919) * 12.9898) * 43758.5453;
      lp += 0.35 * (2 * (x - Math.floor(x)) - 1 - lp);
      d[i] = t < 0.012 ? 0 : lp * Math.exp(-3.2 * t);
    }
  }
  return b;
}

function softClip() {
  const n = 4096, c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = Math.tanh(4 * (i / (n - 1) * 2 - 1));
  return c;
}

// worklet -> (dry + reverb) -> tanh
function buildGraph(ac, wn) {
  const sum = ac.createGain();
  wn.connect(sum, 0);
  const verb = ac.createConvolver();
  verb.buffer = impulse(ac, 2.2);
  const wet = ac.createGain();
  wet.gain.value = 0.5;
  wn.connect(verb, 1);
  verb.connect(wet).connect(sum);
  const drive = ac.createGain();
  drive.gain.value = 0.25;
  const clip = ac.createWaveShaper();
  clip.curve = softClip();
  clip.oversample = '2x';
  const out = ac.createGain();
  out.gain.value = 0.9;
  sum.connect(drive).connect(clip).connect(out);
  return out;
}

const NODE_OPTS = { numberOfInputs: 0, numberOfOutputs: 2, outputChannelCount: [2, 2] };

async function initAudio() {
  if (ctx) return;
  ctx = new AudioContext({ latencyHint: 'interactive' });
  await ctx.audioWorklet.addModule(WORKLET);
  node = new AudioWorkletNode(ctx, 'locus', { ...NODE_OPTS, processorOptions: { song } });
  node.port.onmessage = (e) => {
    if (e.data.type === 'pos') pos = e.data;
  };
  const out = buildGraph(ctx, node);
  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  out.connect(analyser);
  out.connect(ctx.destination);
}

async function togglePlay() {
  if (playing) {
    node.port.postMessage({ type: 'stop' });
    playing = false;
  } else {
    try {
      await initAudio();
    } catch (e) {
      toast(`audio didn't start: ${e.message}`);
      return;
    }
    await ctx.resume();
    node.port.postMessage({ type: 'song', song });
    node.port.postMessage({ type: 'play', from: cue });
    playing = true;
  }
  $('play').textContent = playing ? 'stop' : 'play';
  $('play').classList.toggle('on', playing);
}

function seek(n) {
  cue = n;
  if (playing) node.port.postMessage({ type: 'play', from: n });
}

// where the music is right now, in steps (what you hear, not what's been computed)
function nowStep() {
  if (!playing || !ctx || !pos.playing) return null;
  const lat = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
  const steps = song.bars * 16;
  const s = pos.step + (ctx.currentTime - lat - pos.time) * pos.bpm / 15;
  return ((s % steps) + steps) % steps;
}

async function exportWav() {
  const btn = $('export');
  btn.disabled = true;
  btn.textContent = 'rendering';
  try {
    const sr = 44100;
    const loop = Math.round(song.bars * 16 * 15 / song.bpm * sr);
    const oc = new OfflineAudioContext(2, loop * 2, sr);
    await oc.audioWorklet.addModule(WORKLET);
    const wn = new AudioWorkletNode(oc, 'locus', { ...NODE_OPTS, processorOptions: { song, play: true, quiet: true } });
    buildGraph(oc, wn).connect(oc.destination);
    const buf = await oc.startRendering();
    // second pass through the loop, so tails from the end wrap into the start
    const file = wavFile([buf.getChannelData(0).slice(loop), buf.getChannelData(1).slice(loop)], sr);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = `${song.name || 'locus'}.wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  } catch (e) {
    toast(`export failed: ${e.message}`);
  }
  btn.disabled = false;
  btn.textContent = 'wav';
}

// ---- sharing ----

function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function share() {
  const json = JSON.stringify(plain());
  let hash;
  try {
    const z = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    hash = 'z' + b64url(new Uint8Array(await new Response(z).arrayBuffer()));
  } catch (e) {
    hash = 'j' + b64url(new TextEncoder().encode(json));
  }
  history.replaceState(null, '', '#' + hash);
  try {
    await navigator.clipboard.writeText(location.href);
    toast('link copied');
  } catch (e) {
    toast('the link is in the address bar');
  }
}

async function fromHash(hash) {
  const bytes = unb64url(hash.slice(1));
  if (hash[0] === 'z') {
    const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return JSON.parse(await new Response(s).text());
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2200);
}

// ---- header ----

function fillHeader() {
  $('bpm').value = song.bpm;
  $('key').value = song.key;
  $('scale').value = song.scale;
  $('prog').value = song.prog;
  $('per').value = song.per;
  $('bars').value = song.bars;
}

function setupHeader() {
  $('key').append(...KEYS.map((k) => new Option(k, k)));
  $('scale').append(...Object.keys(SCALES).map((k) => new Option(k, k)));
  $('songs').append(...Object.keys(SONGS).map((k) => new Option(k, k)));
  $('inst').append(...Object.keys(INSTRUMENTS).map((k) => new Option(k, k)));

  $('play').addEventListener('click', togglePlay);
  $('bpm').addEventListener('input', () => {
    song.bpm = num($('bpm').value, song.bpm, 20, 400);
    changed();
  });
  for (const id of ['key', 'scale', 'prog', 'per', 'bars']) {
    $(id).addEventListener('input', () => {
      const el = $(id);
      if (id === 'per') song.per = Math.round(num(el.value, song.per, 1, 64));
      else if (id === 'bars') song.bars = Math.round(num(el.value, song.bars, 1, 256));
      else song[id] = el.value;
      applyTheory();
      changed();
    });
  }
  $('songs').addEventListener('change', () => {
    const name = $('songs').value;
    $('songs').value = '';
    if (name && confirm(`Load "${name}"? The current song will be replaced.`)) {
      loadSong(SONGS[name]);
      history.replaceState(null, '', location.pathname);
    }
  });
  $('share').addEventListener('click', share);
  $('export').addEventListener('click', exportWav);
  $('showBtn').addEventListener('click', openShow);
}

// ---- song timeline ----

function button(cls, text, tip) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = text;
  b.dataset.tip = tip;
  return b;
}

// the name / mute / solo column next to the timeline
function buildNames() {
  const box = $('names');
  box.querySelectorAll('.name-row').forEach((r) => r.remove());
  song.voices.forEach((v, i) => {
    const row = document.createElement('div');
    row.className = 'name-row' + (i === sel ? ' sel' : '');
    row.dataset.i = i;
    row.append(
      button('lname', v.name, 'edit this voice'),
      button('tog mute' + (v.mute ? ' on' : ''), 'm', 'mute'),
      button('tog solo' + (v.solo ? ' on' : ''), 's', 'solo. when anything is soloed, only soloed voices play'),
    );
    box.append(row);
  });
  tlDirty = true;
}

// every hit of every voice over the loop, for drawing
function timelineRows() {
  const steps = song.bars * 16;
  const solo = song.voices.some((v) => v.solo);
  return song.voices.map((v, i) => {
    const c = compiled[i], hits = [];
    let lo = Infinity, hi = -Infinity;
    if (c && c.ok) {
      for (let n = 0; n < steps; n++) {
        const h = trig(c, n);
        if (!h) continue;
        hits.push({ n, ms: h.ms, v: h.v });
        for (const m of h.ms) {
          lo = Math.min(lo, m);
          hi = Math.max(hi, m);
        }
      }
    }
    hits.forEach((h, j) => (h.next = j + 1 < hits.length ? hits[j + 1].n : hits[0].n + steps));
    return { hits, lo, hi, len: v.len, mono: v.mono, on: !v.mute && (!solo || v.solo) };
  });
}

// chord name on the bars where a new chord starts
function chordLabels() {
  const th = hm.theory, out = [];
  for (let bar = 0; bar < song.bars; bar++) {
    out.push(bar % th.per === 0 ? th.chords[th.index(bar)].name : '');
  }
  return out;
}

function setupLanes() {
  tl = new Timeline($('tlScroll'), $('tlInner'), $('tlCanvas'), {
    onSelect: select,
    onSeek: seek,
  });
  $('zoomIn').addEventListener('click', () => tl.setZoom(tl.zoom * 2));
  $('zoomOut').addEventListener('click', () => tl.setZoom(tl.zoom / 2));
  $('names').addEventListener('click', (e) => {
    const row = e.target.closest('.name-row');
    if (!row) return;
    const i = +row.dataset.i, v = song.voices[i];
    if (e.target.classList.contains('mute')) {
      v.mute = !v.mute;
      e.target.classList.toggle('on', v.mute);
      changed(true);
      return;
    }
    if (e.target.classList.contains('solo')) {
      v.solo = !v.solo;
      e.target.classList.toggle('on', v.solo);
      changed(true);
      return;
    }
    select(i);
  });
  $('add').addEventListener('click', () => {
    song.voices.push(cleanVoice({ name: 'sine', ...INSTRUMENTS.sine }));
    compileVoice(song.voices.length - 1);
    sel = song.voices.length - 1;
    buildNames();
    showEditor();
    changed();
  });
}

function select(i) {
  sel = i;
  document.querySelectorAll('.name-row').forEach((r) => r.classList.toggle('sel', +r.dataset.i === sel));
  showEditor();
}

// ---- editor ----

const FIELDS = ['sound', 'hit', 'note'];

function showEditor() {
  const v = song.voices[sel];
  $('edit').classList.toggle('empty', !v);
  if (!v) return;
  $('vname').value = v.name;
  for (const k of FIELDS) $(k).value = v[k];
  $('len').value = v.len;
  $('gain').value = v.gain;
  $('pan').value = v.pan;
  $('rev').value = v.rev;
  $('mono').checked = v.mono;
  $('plot').value = v.plot;
  showErrors();
}

function showErrors() {
  const c = compiled[sel];
  for (const k of FIELDS) {
    const msg = (c && c.err[k]) || '';
    $(k + 'Err').textContent = msg;
    $(k).classList.toggle('bad', !!msg);
  }
}

function setupEditor() {
  for (const k of FIELDS) {
    $(k).addEventListener('input', () => {
      const v = song.voices[sel];
      if (!v) return;
      v[k] = $(k).value;
      compileVoice(sel);
      showErrors();
      changed();
    });
  }
  $('vname').addEventListener('input', () => {
    const v = song.voices[sel];
    if (!v) return;
    v.name = $('vname').value.slice(0, 24);
    const btn = document.querySelector(`.name-row[data-i="${sel}"] .lname`);
    if (btn) btn.textContent = v.name;
    changed();
  });
  const knobs = { len: [0.25, 4096], gain: [0, 1.5], pan: [-1, 1], rev: [0, 1] };
  for (const [k, [lo, hi]] of Object.entries(knobs)) {
    $(k).addEventListener('input', () => {
      const v = song.voices[sel];
      if (!v) return;
      v[k] = num($(k).value, v[k], lo, hi);
      changed();
    });
  }
  $('mono').addEventListener('change', () => {
    song.voices[sel].mono = $('mono').checked;
    changed();
  });
  $('plot').addEventListener('change', () => {
    song.voices[sel].plot = $('plot').value;
    changed();
  });
  $('inst').addEventListener('change', () => {
    const name = $('inst').value;
    $('inst').value = '';
    const v = song.voices[sel];
    if (!name || !v) return;
    song.voices[sel] = cleanVoice({ ...v, name, pan: 0, ...INSTRUMENTS[name] }, v.id);
    compileVoice(sel);
    buildNames();
    showEditor();
    changed();
  });
  $('del').addEventListener('click', () => {
    if (!song.voices.length) return;
    song.voices.splice(sel, 1);
    compiled.splice(sel, 1);
    sel = Math.max(0, Math.min(sel, song.voices.length - 1));
    buildNames();
    showEditor();
    changed();
  });
}

// ---- what to draw ----

function trig(c, n) {
  const th = hm.theory, s = n % 16, bar = Math.floor(n / 16), k = th.index(bar);
  let h, out;
  try {
    h = +c.hit.fn(n, s, bar, k);
    if (!(h > 0)) return null;
    out = c.note.fn(n, s, bar, k, th.root(bar));
  } catch (e) {
    return null;
  }
  const ms = (Array.isArray(out) ? out : [out]).filter((x) => x > 0 && x < 160);
  return ms.length ? { m: ms[0], ms, v: Math.min(1, h) } : null;
}

function stageState(i, stepF) {
  const v = song.voices[i], c = compiled[i];
  if (!v || !c || !c.ok) return null;
  const steps = song.bars * 16, secs = 15 / song.bpm;
  let hit = null, tau = Infinity;
  if (stepF !== null) {
    const cur = Math.floor(stepF), back = Math.min(steps - 1, Math.ceil(v.len) + 1);
    for (let b = 0; b <= back && !hit; b++) {
      hit = trig(c, (((cur - b) % steps) + steps) % steps);
      if (hit) tau = (stepF - cur + b) * secs;
    }
  }
  for (let n = 0; n < steps && !hit; n++) hit = trig(c, n);
  if (!hit) hit = { m: 60, v: 1 };
  const d = v.len * secs;
  const key = `${v.id}:${c.ver}:${hit.m}:${hit.v}:${d.toFixed(4)}`;
  let cv = curves.get(key);
  if (!cv) {
    cv = renderCurve(c.sound.fn, c.sound.slots, mtof(hit.m), hit.m, hit.v, d, VIS_SR, 4);
    curves.set(key, cv);
    if (curves.size > 48) curves.delete(curves.keys().next().value);
  }
  // short or percussive sounds read best whole, sustained ones as a few cycles
  const f = mtof(hit.m), whole = Math.min(d, 4) * f <= 30 || cv.decay < 0.3;
  const mode = v.plot === 'auto' ? (whole ? 'note' : 'cycle') : v.plot;
  return { ...cv, tau, f, mode, pulse: Number.isFinite(tau) ? Math.exp(-tau / 0.12) : 0 };
}

function texInto(el, lines, key) {
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.textContent = '';
  for (const l of lines) {
    const d = document.createElement('div');
    d.className = 'line';
    if (window.katex) window.katex.render(l, d, { displayMode: true, throwOnError: false });
    else d.textContent = l;
    el.append(d);
  }
  fitTex(el);
}

function fitTex(el) {
  const max = el.clientWidth;
  for (const d of el.children) {
    d.style.fontSize = '';
    if (max && d.scrollWidth > max) d.style.fontSize = Math.max(0.35, max / d.scrollWidth) + 'em';
  }
}

function sizeCanvas(cv) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { c, w, h };
}

function plotBox(w, h) {
  return w >= h
    ? { x0: w * 0.1, x1: w * 0.9, y0: h * 0.11, y1: h * 0.64 }
    : { x0: w * 0.1, x1: w * 0.88, y0: h * 0.2, y1: h * 0.56 };
}

function placeTex(el, w, h) {
  el.style.top = (w >= h ? h * 0.71 : h * 0.62) + 'px';
  el.style.fontSize = (w >= h ? w * 0.021 : w * 0.042) + 'px';
}

function paint(cv, texEl, i, stepF, time) {
  const { c, w, h } = sizeCanvas(cv);
  if (!w || !h) return;
  const box = plotBox(w, h);
  drawStage(c, w, h, box, stageState(i, stepF), look, time);
  placeTex(texEl, w, h);
  const comp = compiled[i];
  const lines = comp ? (comp.tex.length ? comp.tex : ['']) : [''];
  texInto(texEl, lines, `${song.voices[i]?.id}:${comp?.ver}:${Math.round(w)}x${Math.round(h)}`);
}

function paintTimeline(stepF) {
  if (tlDirty) {
    tl.setData(timelineRows(), song.bars * 16, chordLabels());
    tlDirty = false;
  }
  tl.draw(stepF, cue, sel, look);
}

const wave = new Float32Array(2048);
function paintScope() {
  const { c, w, h } = sizeCanvas($('scope'));
  c.clearRect(0, 0, w, h);
  c.strokeStyle = look.ink;
  c.globalAlpha = 0.8;
  c.lineWidth = 1;
  c.beginPath();
  if (analyser && playing) {
    analyser.getFloatTimeDomainData(wave);
    let z = 0;
    for (let i = 1; i < 1024; i++) {
      if (wave[i - 1] < 0 && wave[i] >= 0) {
        z = i;
        break;
      }
    }
    for (let i = 0; i < 1024; i++) {
      const x = i / 1023 * w, y = h / 2 - wave[z + i] * h * 0.45;
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    }
  } else {
    c.moveTo(0, h / 2);
    c.lineTo(w, h / 2);
  }
  c.stroke();
  c.globalAlpha = 1;
}

// ---- stage mode (fullscreen, for recording) ----

const show = { open: false, ratio: 'wide', auto: true, idle: 0 };

function openShow() {
  show.open = true;
  $('show').hidden = false;
  $('showTex').dataset.key = '';
  layoutShow();
  poke();
  const el = document.documentElement;
  if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
}

function closeShow() {
  show.open = false;
  $('show').hidden = true;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

function layoutShow() {
  const W = innerWidth, H = innerHeight;
  let w = W, h = H;
  if (show.ratio !== 'fill') {
    const a = show.ratio === 'wide' ? 16 / 9 : 9 / 16;
    w = Math.min(W, H * a);
    h = w / a;
  }
  const f = $('showFrame');
  f.style.width = w + 'px';
  f.style.height = h + 'px';
  document.querySelectorAll('[data-ratio]').forEach((b) => b.classList.toggle('on', b.dataset.ratio === show.ratio));
}

function poke() {
  $('show').classList.remove('idle');
  clearTimeout(show.idle);
  show.idle = setTimeout(() => $('show').classList.add('idle'), 2200);
}

function shownVoice(stepF) {
  if (!show.auto || stepF === null) return sel;
  const solo = song.voices.some((v) => v.solo);
  const list = song.voices.map((v, i) => i).filter((i) => {
    const v = song.voices[i];
    return compiled[i]?.ok && !v.mute && (!solo || v.solo);
  });
  if (!list.length) return sel;
  return list[Math.floor(stepF / 32) % list.length];
}

function setupShow() {
  document.querySelectorAll('[data-ratio]').forEach((b) => b.addEventListener('click', () => {
    show.ratio = b.dataset.ratio;
    layoutShow();
  }));
  $('follow').addEventListener('click', () => {
    show.auto = !show.auto;
    $('follow').textContent = show.auto ? 'auto' : 'selected';
  });
  $('showClose').addEventListener('click', closeShow);
  $('show').addEventListener('mousemove', poke);
  $('show').addEventListener('click', poke);
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && show.open) closeShow();
  });
  addEventListener('resize', () => show.open && layoutShow());
}

// ---- loop ----

function frame(ms) {
  const stepF = nowStep();
  const time = ms / 1000;
  const at = stepF === null ? cue : stepF;
  const bar = Math.floor(at / 16) + 1, st = Math.floor(at % 16) + 1;
  $('pos').textContent = `${String(bar).padStart(2, '0')}.${String(st).padStart(2, '0')}`;
  if (show.open) {
    paint($('showCanvas'), $('showTex'), shownVoice(stepF), stepF, time);
  } else {
    paint($('stageCanvas'), $('stageTex'), sel, stepF, time);
    paintTimeline(stepF);
    paintScope();
  }
  requestAnimationFrame(frame);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && show.open) closeShow();
  const typing = e.target.closest && e.target.closest('input, textarea, select, button');
  if (e.code === 'Space' && !typing) {
    e.preventDefault();
    togglePlay();
  }
});

// katex arrives with a deferred script; redraw formulas once it (and its fonts) are in
addEventListener('load', () => {
  $('stageTex').dataset.key = '';
  $('showTex').dataset.key = '';
  document.fonts?.load('italic 20px KaTeX_Math').catch(() => {});
});

async function start() {
  setupHeader();
  setupLanes();
  setupEditor();
  setupShow();
  let initial = null;
  if (location.hash.length > 2) {
    try {
      initial = await fromHash(location.hash.slice(1));
    } catch (e) {
      toast("couldn't read the song in that link");
    }
  }
  if (!initial) {
    try {
      initial = JSON.parse(localStorage.getItem(STORE));
    } catch (e) {
      initial = null;
    }
  }
  loadSong(initial || SONGS.seventh);
  requestAnimationFrame(frame);
}

start();
