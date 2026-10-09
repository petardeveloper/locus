// the little language voices are written in.
// parse() -> statements, check() resolves names, gen() -> js, tex() -> latex for the display

export class ExprError extends Error {
  constructor(msg, pos) {
    super(msg);
    this.pos = pos;
  }
}

// variables each kind of function can see
export const VARS = {
  sound: ['t', 'f', 'v', 'i', 'd', 'm', 'sr'],
  hit: ['n', 's', 'bar', 'k'],
  note: ['n', 's', 'bar', 'k', 'root'],
};

const CONSTS = { pi: Math.PI, tau: 2 * Math.PI, e: Math.E };

// name: [min args, max args, where, state slots]
// where: '*' anywhere, 's' sound only, 'p' hit/note only
const FUNCS = {
  sin: [1, 1, '*'], cos: [1, 1, '*'], tan: [1, 1, '*'], tanh: [1, 1, '*'], atan: [1, 1, '*'],
  exp: [1, 1, '*'], log: [1, 1, '*'], sqrt: [1, 1, '*'], abs: [1, 1, '*'], sign: [1, 1, '*'],
  floor: [1, 1, '*'], ceil: [1, 1, '*'], round: [1, 1, '*'], fract: [1, 1, '*'],
  min: [2, 8, '*'], max: [2, 8, '*'], clamp: [3, 3, '*'], mix: [3, 3, '*'],
  pow: [2, 2, '*'], mod: [2, 2, '*'], noise: [1, 1, '*'], mtof: [1, 1, '*'],
  saw: [1, 1, 's'], sqr: [1, 2, 's'], tri: [1, 1, 's'], crush: [2, 2, 's'], ad: [3, 3, 's'],
  osc: [1, 1, 's', 1], lp: [2, 3, 's', 2], hp: [2, 3, 's', 2], bp: [2, 3, 's', 2], hold: [2, 2, 's', 2],
  euclid: [3, 3, 'p'], ch: [1, 1, 'p'], deg: [1, 1, 'p'],
};

export const FUNC_NAMES = Object.keys(FUNCS);

const fract = (x) => x - Math.floor(x);

// state variable filter (zavalishin's tpt form). mode 0 low, 1 band (normalised), 2 high
function svf(S, o, sr, x, fc, q, mode) {
  if (!(fc > 10)) fc = 10;
  if (fc > sr * 0.49) fc = sr * 0.49;
  if (!(q > 0.05)) q = 0.05;
  const g = Math.tan(Math.PI * fc / sr), k = 1 / q;
  const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
  const ic1 = S[o], ic2 = S[o + 1];
  const v3 = x - ic2;
  const v1 = a1 * ic1 + a2 * v3;
  const v2 = ic2 + a2 * ic1 + a3 * v3;
  S[o] = 2 * v1 - ic1;
  S[o + 1] = 2 * v2 - ic2;
  return mode === 0 ? v2 : mode === 1 ? k * v1 : x - k * v1 - v2;
}

export const F = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, tanh: Math.tanh, atan: Math.atan,
  exp: Math.exp, log: Math.log, sqrt: Math.sqrt, abs: Math.abs, sign: Math.sign,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, fract,
  min: Math.min, max: Math.max, pow: Math.pow,
  clamp: (x, a, b) => (x < a ? a : x > b ? b : x),
  mix: (a, b, x) => a + (b - a) * x,
  mod: (a, b) => a - b * Math.floor(a / b),
  noise: (i) => 2 * fract(Math.sin(i * 12.9898) * 43758.5453) - 1,
  mtof: (m) => 440 * Math.pow(2, (m - 69) / 12),
  saw: (x) => 2 * fract(x) - 1,
  sqr: (x, w = 0.5) => (fract(x) < w ? 1 : -1),
  tri: (x) => 1 - 4 * Math.abs(fract(x + 0.25) - 0.5),
  crush: (x, b) => {
    const q = Math.pow(2, b - 1);
    return Math.round(x * q) / q;
  },
  ad: (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d)),
  at: (list, i) => {
    const n = list.length;
    i = Math.floor(i) % n;
    return list[i < 0 ? i + n : i];
  },
  euclid: (k, len, s) => {
    len = Math.max(1, Math.floor(len));
    s = F.mod(Math.floor(s), len);
    return Math.floor(k * s / len) !== Math.floor(k * (s - 1) / len) ? 1 : 0;
  },
  // stateful ones get the note's state array + their slot
  osc: (S, o, sr, hz) => {
    const p = S[o];
    S[o] = p + hz / sr;
    return p;
  },
  lp: (S, o, sr, x, fc, q = 0.707) => svf(S, o, sr, x, fc, q, 0),
  bp: (S, o, sr, x, fc, q = 0.707) => svf(S, o, sr, x, fc, q, 1),
  hp: (S, o, sr, x, fc, q = 0.707) => svf(S, o, sr, x, fc, q, 2),
  hold: (S, o, sr, x, hz) => {
    if (S[o] <= 0) {
      S[o + 1] = x;
      S[o] += sr / Math.max(1, hz);
    }
    S[o] -= 1;
    return S[o + 1];
  },
};

// ---- lexer ----

const OPS = ['<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '+', '-', '*', '/', '%', '^',
  '(', ')', '[', ']', ',', '?', ':', '<', '>', '!', '&', '|', '=', ';'];
// a line ending in one of these carries on to the next line
const CARRY = new Set(['+', '-', '*', '/', '%', '^', '(', '[', ',', '?', ':', '<', '>', '<=', '>=',
  '==', '!=', '&&', '||', '&', '|', '<<', '>>', '=', '!']);
const NUM = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const ID = /[A-Za-z_][A-Za-z0-9_]*/y;

function lex(src) {
  const toks = [];
  let i = 0, depth = 0;
  const last = () => toks[toks.length - 1];
  const end = (pos) => {
    const l = last();
    if (l && l.t !== 'end' && !(l.t === 'op' && CARRY.has(l.v))) toks.push({ t: 'end', v: 'end of line', pos });
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '\n') {
      if (depth === 0) end(i);
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    NUM.lastIndex = i;
    let m = NUM.exec(src);
    if (m) {
      toks.push({ t: 'num', v: m[0], value: parseFloat(m[0]), pos: i });
      i += m[0].length;
      continue;
    }
    ID.lastIndex = i;
    m = ID.exec(src);
    if (m) {
      toks.push({ t: 'id', v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ExprError(`unexpected "${c}"`, i);
    if (op === ';') {
      end(i);
      i++;
      continue;
    }
    if (op === '(' || op === '[') depth++;
    if (op === ')' || op === ']') depth = Math.max(0, depth - 1);
    toks.push({ t: 'op', v: op, pos: i });
    i += op.length;
  }
  return toks;
}

// ---- parser (pratt) ----

const BP = {
  '?': 1, '||': 2, '&&': 3, '|': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7,
  '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10, '^': 12, '[': 13,
};

export function parse(src) {
  const toks = lex(src);
  let p = 0;
  const peek = () => toks[p];
  const fail = (msg, tok) => {
    throw new ExprError(msg, tok ? tok.pos : src.length);
  };
  const expect = (v) => {
    const t = toks[p];
    if (!t || t.v !== v) fail(t ? `expected "${v}" but found "${t.v}"` : `missing "${v}"`, t);
    p++;
  };

  function expr(rbp) {
    const t = toks[p++];
    if (!t || t.t === 'end') fail('expression ends too early', t);
    let left = nud(t);
    for (;;) {
      const o = peek();
      if (!o) break;
      if (o.t === 'num' || o.t === 'id') fail(`missing operator before "${o.v}"`, o);
      if (o.t !== 'op') break;
      if (o.v === '(') fail('missing operator before "("', o);
      if (o.v === '=') fail('use == to compare', o);
      const bp = BP[o.v];
      if (bp === undefined || bp <= rbp) break;
      p++;
      left = led(o, left);
    }
    return left;
  }

  function items(close) {
    const out = [];
    if (peek() && peek().v !== close) {
      out.push(expr(0));
      while (peek() && peek().v === ',') {
        p++;
        out.push(expr(0));
      }
    }
    expect(close);
    return out;
  }

  function nud(t) {
    if (t.t === 'num') return { type: 'num', value: t.value };
    if (t.t === 'id') {
      if (peek() && peek().v === '(') {
        p++;
        return { type: 'call', name: t.v, args: items(')'), pos: t.pos };
      }
      return { type: 'name', name: t.v, pos: t.pos };
    }
    if (t.v === '(') {
      const e = expr(0);
      expect(')');
      return e;
    }
    if (t.v === '[') {
      const list = items(']');
      if (!list.length) fail('empty list', t);
      return { type: 'list', items: list, pos: t.pos };
    }
    if (t.v === '-' || t.v === '+' || t.v === '!') return { type: 'un', op: t.v, e: expr(11) };
    fail(`unexpected "${t.v}"`, t);
  }

  function led(o, left) {
    if (o.v === '?') {
      const a = expr(0);
      expect(':');
      return { type: 'cond', c: left, a, b: expr(0) };
    }
    if (o.v === '[') {
      const i = expr(0);
      expect(']');
      return { type: 'index', list: left, i, pos: o.pos };
    }
    return { type: 'bin', op: o.v, a: left, b: expr(o.v === '^' ? BP['^'] - 1 : BP[o.v]) };
  }

  const stmts = [];
  while (p < toks.length) {
    const t = peek();
    if (t.t === 'end') {
      p++;
      continue;
    }
    if (t.t === 'id' && toks[p + 1] && toks[p + 1].v === '=') {
      p += 2;
      stmts.push({ type: 'let', name: t.v, pos: t.pos, e: expr(0) });
    } else {
      stmts.push({ type: 'out', pos: t.pos, e: expr(0) });
    }
    const s = peek();
    if (s && s.t !== 'end') fail(`unexpected "${s.v}"`, s);
  }
  return stmts;
}

// ---- name checks ----

const HINTS = { freq: 'f', time: 't', vel: 'v', PI: 'pi', step: 's', note: 'm', random: 'noise' };

function unknown(name, kind) {
  if (HINTS[name]) return `unknown name "${name}", did you mean ${HINTS[name]}?`;
  for (const [k, vars] of Object.entries(VARS)) {
    if (k !== kind && vars.includes(name)) return `${name} only exists in ${k === 'sound' ? 'the sound' : k + '(n)'}`;
  }
  return `unknown name "${name}"`;
}

function check(stmts, kind) {
  if (!stmts.length) throw new ExprError('empty', 0);
  const vars = new Set(VARS[kind]);
  const locals = new Set();
  let slots = 0;
  const lastOut = stmts[stmts.length - 1];
  if (lastOut.type !== 'out') throw new ExprError('the last line has to be the result', lastOut.pos);
  for (const s of stmts) {
    if (s.type === 'out' && s !== lastOut) throw new ExprError('only the last line can be a plain expression', s.pos);
  }

  function walk(node, top) {
    switch (node.type) {
      case 'num':
        return;
      case 'name': {
        const nm = node.name;
        if (locals.has(nm)) node.kind = 'local';
        else if (vars.has(nm)) node.kind = 'var';
        else if (nm in CONSTS) node.kind = 'const';
        else if (FUNCS[nm]) throw new ExprError(`${nm} is a function, use ${nm}(...)`, node.pos);
        else throw new ExprError(unknown(nm, kind), node.pos);
        return;
      }
      case 'call': {
        const spec = FUNCS[node.name];
        if (!spec) throw new ExprError(`unknown function "${node.name}"`, node.pos);
        const [lo, hi, where, st] = spec;
        if (where === 's' && kind !== 'sound') throw new ExprError(`${node.name}() only works in the sound`, node.pos);
        if (where === 'p' && kind === 'sound') throw new ExprError(`${node.name}() only works in hit and note`, node.pos);
        if (node.args.length < lo || node.args.length > hi) {
          const want = lo === hi ? lo : `${lo} to ${hi}`;
          throw new ExprError(`${node.name}() takes ${want} argument${hi > 1 ? 's' : ''}`, node.pos);
        }
        if (st) {
          node.slot = slots;
          slots += st;
        }
        node.args.forEach((a) => walk(a, false));
        return;
      }
      case 'list':
        if (!top) throw new ExprError('a list needs an index here, like [1, 2, 3][s]', node.pos);
        node.items.forEach((a) => walk(a, false));
        return;
      case 'index':
        if (node.list.type !== 'list') throw new ExprError('only [lists] can be indexed', node.pos);
        node.list.items.forEach((a) => walk(a, false));
        walk(node.i, false);
        return;
      case 'un':
        walk(node.e, false);
        return;
      case 'bin':
        walk(node.a, false);
        walk(node.b, false);
        return;
      case 'cond':
        walk(node.c, false);
        walk(node.a, top);
        walk(node.b, top);
        return;
    }
  }

  for (const s of stmts) {
    if (s.type === 'let') {
      if (vars.has(s.name) || s.name in CONSTS || FUNCS[s.name]) {
        throw new ExprError(`"${s.name}" is already taken, pick another name`, s.pos);
      }
      walk(s.e, false);
      locals.add(s.name);
    } else {
      walk(s.e, kind === 'note');
    }
  }
  return slots;
}

// ---- js codegen ----

const CMP = { '<': '<', '>': '>', '<=': '<=', '>=': '>=', '==': '===', '!=': '!==' };

function gen(node, K) {
  switch (node.type) {
    case 'num':
      return String(node.value);
    case 'name':
      if (node.kind === 'local') return 'L_' + node.name;
      if (node.kind === 'var') return node.name;
      return String(CONSTS[node.name]);
    case 'un': {
      const a = gen(node.e, K);
      return node.op === '!' ? `(${a}?0:1)` : `(${node.op}(${a}))`;
    }
    case 'bin': {
      const a = gen(node.a, K), b = gen(node.b, K), op = node.op;
      if (op === '%') return `F.mod(${a},${b})`;
      if (op === '^') return `Math.pow(${a},${b})`;
      if (CMP[op]) return `((${a})${CMP[op]}(${b})?1:0)`;
      if (op === '&&' || op === '||') return `((${a})${op}(${b})?1:0)`;
      return `((${a})${op}(${b}))`;
    }
    case 'cond':
      return `((${gen(node.c, K)})?(${gen(node.a, K)}):(${gen(node.b, K)}))`;
    case 'call': {
      const args = node.args.map((a) => gen(a, K)).join(',');
      if (FUNCS[node.name][3]) return `F.${node.name}(S,${node.slot},sr,${args})`;
      if (node.name === 'ch' || node.name === 'deg') return `X.${node.name}(bar,${args})`;
      return `F.${node.name}(${args})`;
    }
    case 'list':
      if (node.items.every((x) => x.type === 'num')) {
        K.push(node.items.map((x) => x.value));
        return `K[${K.length - 1}]`;
      }
      return `[${node.items.map((x) => gen(x, K)).join(',')}]`;
    case 'index':
      return `F.at(${gen(node.list, K)},${gen(node.i, K)})`;
  }
}

// X carries ch() and deg(), which need the current chords
export function compile(src, kind, X) {
  const stmts = parse(src);
  const slots = check(stmts, kind);
  const K = [];
  const seen = new Set();
  let body = '';
  for (const s of stmts) {
    if (s.type === 'let') {
      body += `${seen.has(s.name) ? '' : 'let '}L_${s.name}=${gen(s.e, K)};`;
      seen.add(s.name);
    } else {
      body += `return ${gen(s.e, K)};`;
    }
  }
  const params = VARS[kind].concat(kind === 'sound' ? ['S'] : []).join(',');
  const fn = new Function('F', 'K', 'X', `"use strict";return function(${params}){${body}};`)(F, K, X);
  return { fn, slots, stmts, kind };
}

// ---- latex ----

const GREEK = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'kappa', 'lambda',
  'mu', 'nu', 'xi', 'rho', 'sigma', 'phi', 'chi', 'psi', 'omega'];

function nameTex(nm) {
  if (nm === 'pi' || nm === 'tau') return '\\' + nm;
  if (nm === 'sr' || nm === 'bar' || nm === 'root') return `\\mathrm{${nm}}`;
  const u = nm.indexOf('_');
  if (u > 0) {
    const sub = nm.slice(u + 1).replace(/_/g, '');
    return `${nameTex(nm.slice(0, u))}_{${sub.length > 1 ? `\\mathrm{${sub}}` : sub}}`;
  }
  if (GREEK.includes(nm)) return '\\' + nm;
  if (nm.length === 1) return nm;
  if (/^[A-Za-z]([0-9]+|[a-z])$/.test(nm)) return `${nm[0]}_{${nm.slice(1)}}`;
  return `\\mathrm{${nm}}`;
}

function fmt(x) {
  if (Number.isInteger(x)) return String(x);
  const s = String(+x.toPrecision(6));
  if (!s.includes('e')) return s;
  const [m, e] = s.split('e');
  return `${m} \\times 10^{${+e}}`;
}

const REL = {
  '<': '<', '>': '>', '<=': '\\le', '>=': '\\ge', '==': '=', '!=': '\\ne', '&&': '\\land', '||': '\\lor',
  '&': '\\mathbin{\\&}', '|': '\\mathbin{|}', '<<': '\\ll', '>>': '\\gg',
};
const PREC = {
  '||': 2, '&&': 3, '|': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7,
  '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10, '^': 12,
};

function prec(n, inl) {
  if (n.type === 'bin') return n.op === '/' && !inl ? 14 : PREC[n.op];
  if (n.type === 'un') return 11;
  if (n.type === 'cond') return 1;
  return 14;
}

function wrap(n, need, inl) {
  const s = tex(n, inl);
  return prec(n, inl) < need ? `\\left(${s}\\right)` : s;
}

function leftmost(n) {
  while (n.type === 'bin' && (n.op === '*' || n.op === '^')) n = n.a;
  return n;
}

function callTex(n, inl) {
  const a = n.args;
  const A = a.map((x) => tex(x, inl));
  switch (n.name) {
    case 'exp': return `e^{${tex(a[0], true)}}`;
    case 'sqrt': return `\\sqrt{${A[0]}}`;
    case 'abs': return `\\left|${A[0]}\\right|`;
    case 'floor': return `\\left\\lfloor ${A[0]} \\right\\rfloor`;
    case 'ceil': return `\\left\\lceil ${A[0]} \\right\\rceil`;
    case 'pow': return `{${wrap(a[0], 13, inl)}}^{${tex(a[1], true)}}`;
    case 'mod': return `${wrap(a[0], 10, inl)} \\bmod ${wrap(a[1], 11, inl)}`;
    case 'osc': return `\\int_0^{t}\\! ${wrap(a[0], 10, inl)}\\,dt`;
    case 'ch': return `c_{k,\\,${tex(a[0], true)}}`;
    case 'atan': return `\\arctan\\left(${A[0]}\\right)`;
    case 'sin': case 'cos': case 'tan': case 'tanh': case 'log':
      return `\\${n.name}\\left(${A[0]}\\right)`;
    default:
      return `\\operatorname{${n.name}}\\left(${A.join(',\\ ')}\\right)`;
  }
}

function tex(n, inl = false) {
  switch (n.type) {
    case 'num':
      return fmt(n.value);
    case 'name':
      return nameTex(n.name);
    case 'un':
      if (n.op === '!') return `\\lnot ${wrap(n.e, 11, inl)}`;
      return n.op === '-' ? `-${wrap(n.e, 11, inl)}` : wrap(n.e, 11, inl);
    case 'cond': {
      const rows = [];
      let c = n;
      while (c.type === 'cond') {
        rows.push(`${tex(c.a)} & ${tex(c.c)}`);
        c = c.b;
      }
      rows.push(`${tex(c)} & \\text{otherwise}`);
      return `\\begin{cases} ${rows.join(' \\\\ ')} \\end{cases}`;
    }
    case 'list': {
      let items = n.items.map((x) => tex(x, inl));
      if (items.length > 10) items = [...items.slice(0, 8), '\\dots', items[items.length - 1]];
      return `\\left[${items.join(',\\,')}\\right]`;
    }
    case 'index':
      return `${tex(n.list, inl)}_{${tex(n.i, true)}}`;
    case 'call':
      return callTex(n, inl);
    case 'bin': {
      const { op, a, b } = n;
      if (op === '/') return inl ? `${wrap(a, 10, inl)}/${wrap(b, 11, inl)}` : `\\frac{${tex(a)}}{${tex(b)}}`;
      if (op === '^') return `{${wrap(a, 13, inl)}}^{${tex(b, true)}}`;
      if (op === '*') {
        const lb = leftmost(b);
        const dot = lb.type === 'num' || b.type === 'un';
        return `${wrap(a, 10, inl)}${dot ? ' \\cdot ' : '\\,'}${wrap(b, 10, inl)}`;
      }
      if (op === '%') return `${wrap(a, 10, inl)} \\bmod ${wrap(b, 11, inl)}`;
      if (op === '+' || op === '-') return `${wrap(a, 9, inl)} ${op} ${wrap(b, 10, inl)}`;
      return `${wrap(a, PREC[op], inl)} ${REL[op]} ${wrap(b, PREC[op] + 1, inl)}`;
    }
  }
}

const LHS = { sound: 'y(t)', hit: '\\mathrm{hit}(n)', note: '\\mathrm{note}(n)' };

export function toTex(compiled) {
  return compiled.stmts.map((s) =>
    s.type === 'let' ? `${nameTex(s.name)} = ${tex(s.e)}` : `${LHS[compiled.kind]} = ${tex(s.e)}`);
}

// "line 2: ..." from a character offset
export function where(src, err) {
  const pos = Math.max(0, Math.min(src.length, err.pos ?? 0));
  const line = src.slice(0, pos).split('\n').length;
  return src.includes('\n') ? `line ${line}: ${err.message}` : err.message;
}
