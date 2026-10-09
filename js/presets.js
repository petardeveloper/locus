// instruments and songs. len is in steps (16th notes)

export const INSTRUMENTS = {
  kick: {
    sound: `// pitch falls from ~1.3 kHz down to the note
fk = f + 1100*exp(-t/0.005) + 170*exp(-t/0.04)
tanh(2.5*sin(tau*osc(fk))*exp(-t/0.3)) + 0.3*noise(i)*exp(-t/0.0012)`,
    hit: 's % 4 == 0',
    note: '33',
    len: 3, mono: true, gain: 0.45, rev: 0,
  },
  snare: {
    sound: `p = 200*t + 1.65*(1 - exp(-t/0.015))
// 1.593 is where a drum skin's second mode sits
body = (sin(tau*p) + 0.5*sin(tau*1.593*p))*exp(-t/0.07)
tanh(1.8*(body + 1.2*bp(noise(i), 3000, 0.7)*exp(-t/0.12)))*v`,
    hit: 's % 8 == 4',
    note: '50',
    len: 4, mono: true, gain: 0.5, rev: 0.15,
  },
  clap: {
    sound: `burst = exp(-t/0.004) + (t > 0.01)*exp(-(t - 0.01)/0.004) + (t > 0.02)*exp(-(t - 0.02)/0.03)
4*bp(noise(i), 1200, 1.2)*burst*v`,
    hit: 's % 8 == 4',
    note: '60',
    len: 4, mono: true, gain: 0.7, rev: 0.2,
  },
  hat: {
    sound: 'hp(noise(i), 7000)*exp(-t/0.018)*v',
    hit: '0.4 + 0.6*(s % 4 == 2)',
    note: '60',
    len: 1, mono: true, gain: 0.9, pan: 0.2, rev: 0,
  },
  ride: {
    sound: `metal = sqr(677*t) + sqr(1004*t) + sqr(1220*t) + sqr(1725*t) + sqr(1782*t) + sqr(2640*t)
lp(hp(0.5*noise(i) + 0.15*metal, 5000), 10000)*exp(-t/0.18)*v`,
    hit: 's % 2 == 0 ? (s % 4 == 0 ? 1 : 0.6) : 0',
    note: '60',
    len: 4, mono: true, gain: 0.35, pan: -0.25, rev: 0.1,
  },
  chug: {
    sound: `// power chord: root, fifth, octave
x = saw(f*t) + saw(1.4983*f*t) + saw(2*f*t)
g = tanh(9*lp(x, 1400) + 0.15) - tanh(0.15)
lp(hp(g, 90), 4500)*exp(-t/(0.06 + 0.4*v^4))`,
    hit: 'euclid(7, 16, s)*(s == 7 || s == 14 ? 1 : 0.6)',
    note: 'root',
    len: 3, mono: true, gain: 0.27, rev: 0.05,
  },
  sub: {
    sound: 'tanh(1.6*sin(tau*f*t))*ad(t, 0.003, 0.4)',
    hit: 'euclid(7, 16, s)',
    note: 'root',
    len: 3, mono: true, gain: 0.27, rev: 0,
  },
  acid: {
    sound: `cut = 250 + 2500*exp(-t/0.07)
tanh(1.5*lp(saw(f*t), cut, 7))*ad(t, 0.002, 0.25)`,
    hit: '[1,0,1,1,0,1,0,1,1,0,1,0,1,1,0,1][s]',
    note: 'root + [0,12,0,0,7,0,12,0,0,12,0,5,0,12,0,7][s]',
    len: 2, mono: true, gain: 0.38, rev: 0.05,
  },
  lead: {
    sound: `w = saw(f*t + 0.1*sin(tau*6*t)) + saw(1.006*f*t)
lp(tanh(2.5*w), 3200)*ad(t, 0.005, 0.6)`,
    hit: '(s % 8) % 3 == 0',
    note: 'ch([3,2,1,3,2,4,5,4,3,2,1,2][bar % 2*6 + floor(s/8)*3 + floor(s % 8/3)])',
    len: 2.5, mono: true, gain: 0.27, pan: -0.1, rev: 0.25,
  },
  choir: {
    sound: `x = saw(f*t + 0.1*sin(tau*5*t)) + saw(1.004*f*t)
// three formants make an "ah"
vowel = bp(x, 730, 6) + 0.5*bp(x, 1090, 6) + 0.2*bp(x, 2440, 6)
vowel*min(t/0.4, 1)*min((d - t)/0.5, 1)`,
    hit: 's == 0 && bar % 2 == 0',
    note: '[ch(0), ch(1), ch(2)]',
    len: 32, mono: false, gain: 0.36, rev: 0.4,
  },
  organ: {
    sound: `o = 0.8*sin(pi*f*t) + sin(tau*f*t) + 0.45*sin(3*pi*f*t) + 0.7*sin(2*tau*f*t) + 0.35*sin(3*tau*f*t) + 0.4*sin(4*tau*f*t)
tanh(0.3*o)*(1 + 0.15*sin(tau*5.8*t))*min(t/0.03, 1)*min((d - t)/0.15, 1)`,
    hit: 's == 0 && bar % 2 == 0',
    note: '[ch(0), ch(1), ch(2), root + 12]',
    len: 32, mono: false, gain: 0.15, rev: 0.3,
  },
  bell: {
    sound: 'sin(tau*f*t + 2.2*exp(-t/0.35)*sin(tau*3.5*f*t))*exp(-t/0.8)',
    hit: 's % 3 == 0 && bar % 2 == 1',
    note: 'ch(s % 4 + 3)',
    len: 12, mono: false, gain: 0.25, pan: 0.3, rev: 0.4,
  },
  anvil: {
    sound: `a = sin(tau*f*t)*exp(-t/0.5) + 0.7*sin(tau*2.756*f*t)*exp(-t/0.35)
b = 0.45*sin(tau*5.404*f*t)*exp(-t/0.2) + 0.3*sin(tau*8.933*f*t)*exp(-t/0.12)
tanh(1.5*(a + b))`,
    hit: 's == 8',
    note: 'root + 12',
    len: 12, mono: false, gain: 0.3, rev: 0.3,
  },
  reese: {
    sound: `x = saw(0.9897*f*t) + saw(1.0105*f*t)
cut = 200 + 700*sin(1.6*pi*t)^2
(tanh(2.5*lp(x, cut, 1.6)) + 0.6*sin(tau*f*t))*min(t/0.02, 1)`,
    hit: 's == 0 && bar % 2 == 0',
    note: 'root',
    len: 32, mono: true, gain: 0.3, rev: 0,
  },
  bytebeat: {
    sound: `// the classic one, at 8 kHz
b = floor(t*8000)
((b*(b>>5 | b>>8)) & 255)/128 - 1`,
    hit: 'n == 0',
    note: '60',
    len: 64, mono: true, gain: 0.35, rev: 0,
  },
  sine: {
    sound: 'sin(tau*f*t)*exp(-t/0.4)',
    hit: 's % 4 == 0',
    note: 'deg(floor(s/4))',
    len: 4, mono: false, gain: 0.5, rev: 0.2,
  },
};

const use = (name, extra = {}) => ({ name, ...INSTRUMENTS[name], ...extra });

export const SONGS = {
  seventh: {
    name: 'seventh',
    bpm: 192, key: 'D', scale: 'harmonic minor', prog: 'Dm Bb Eb A', per: 2, bars: 8,
    voices: [
      use('kick', { hit: '[1,0,1,0,0,0,0,0,0,0,1,1,0,0,0,0][s]' }),
      use('snare', { hit: '[0,0,0,0,1,0,0,0.4,0,0.4,0,0,1,0,0,0.4][s]' }),
      use('ride'),
      use('chug'),
      use('sub'),
      use('lead', { hit: '((s % 8) % 3 == 0)*(bar % 8 >= 4)' }),
      use('choir'),
      use('organ', { hit: 's == 0 && bar % 2 == 0 && bar >= 4', gain: 0.12 }),
    ],
  },
  acid: {
    name: 'acid',
    bpm: 138, key: 'A', scale: 'minor', prog: 'Am F C G', per: 1, bars: 4,
    voices: [
      use('kick'),
      use('hat'),
      use('clap'),
      use('acid'),
      use('bell'),
    ],
  },
  bytebeat: {
    name: 'bytebeat',
    bpm: 120, key: 'C', scale: 'minor', prog: 'Cm', per: 1, bars: 4,
    voices: [
      use('bytebeat'),
      use('kick', { gain: 0.42 }),
      use('hat', { gain: 0.6 }),
    ],
  },
  blank: {
    name: 'untitled',
    bpm: 120, key: 'C', scale: 'minor', prog: 'Cm Ab Eb Bb', per: 1, bars: 4,
    voices: [use('sine')],
  },
};
