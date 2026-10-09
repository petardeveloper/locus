// keys, scales and chord progressions

export const KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export const SCALES = {
  'minor': [0, 2, 3, 5, 7, 8, 10],
  'major': [0, 2, 4, 5, 7, 9, 11],
  'harmonic minor': [0, 2, 3, 5, 7, 8, 11],
  'phrygian': [0, 1, 3, 5, 7, 8, 10],
  'dorian': [0, 2, 3, 5, 7, 9, 10],
  'mixolydian': [0, 2, 4, 5, 7, 9, 10],
  'lydian': [0, 2, 4, 6, 7, 9, 11],
  'locrian': [0, 1, 3, 5, 6, 8, 10],
  'minor pentatonic': [0, 3, 5, 7, 10],
  'major pentatonic': [0, 2, 4, 7, 9],
  'blues': [0, 3, 5, 6, 7, 10],
};

const QUALITY = {
  '': [0, 4, 7], 'maj': [0, 4, 7], 'm': [0, 3, 7], 'min': [0, 3, 7], 'dim': [0, 3, 6], 'aug': [0, 4, 8],
  '+': [0, 4, 8], '5': [0, 7], 'sus2': [0, 2, 7], 'sus4': [0, 5, 7], '6': [0, 4, 7, 9], 'm6': [0, 3, 7, 9],
  '7': [0, 4, 7, 10], 'm7': [0, 3, 7, 10], 'maj7': [0, 4, 7, 11], 'dim7': [0, 3, 6, 9], 'm7b5': [0, 3, 6, 10],
  'add9': [0, 4, 7, 14], 'madd9': [0, 3, 7, 14],
};

const LETTER = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

function pitchClass(letter, acc) {
  let pc = LETTER[letter.toLowerCase()];
  if (acc === '#' || acc === '♯') pc++;
  if (acc === 'b' || acc === '♭') pc--;
  return (pc + 12) % 12;
}

export function parseChord(word) {
  const m = /^([A-Ga-g])(#|b|♯|♭)?(.*)$/.exec(word);
  if (!m || !(m[3] in QUALITY)) return null;
  return { name: word, pc: pitchClass(m[1], m[2]), ivs: QUALITY[m[3]] };
}

export function parseKey(key) {
  const m = /^([A-Ga-g])(#|b|♯|♭)?$/.exec(String(key).trim());
  if (!m) throw new Error(`can't read key "${key}"`);
  return pitchClass(m[1], m[2]);
}

export function parseProgression(text) {
  const words = String(text).trim().split(/[\s,|]+/).filter(Boolean);
  if (!words.length) throw new Error('needs at least one chord');
  return words.map((w) => {
    const c = parseChord(w);
    if (!c) throw new Error(`can't read chord "${w}"`);
    return c;
  });
}

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export const noteName = (m) => NAMES[((Math.round(m) % 12) + 12) % 12] + (Math.floor(Math.round(m) / 12) - 1);

export class Theory {
  constructor(key = 'C', scale = 'minor', prog = 'Cm', per = 2) {
    this.key = parseKey(key);
    this.scale = SCALES[scale] || SCALES.minor;
    this.chords = parseProgression(prog);
    this.per = Math.max(1, Math.round(+per) || 1);
  }

  index(bar) {
    return Math.floor(bar / this.per) % this.chords.length;
  }

  // bass register, C2..B2
  root(bar) {
    return 36 + this.chords[this.index(bar)].pc;
  }

  // chord tones stacked up from octave 3, wrapping into higher octaves
  ch(bar, j) {
    const c = this.chords[this.index(bar)];
    j = Math.floor(j);
    const len = c.ivs.length, o = Math.floor(j / len);
    return 48 + c.pc + c.ivs[j - o * len] + 12 * o;
  }

  // scale degree, 0 = tonic in octave 4
  deg(bar, d) {
    d = Math.floor(d);
    const len = this.scale.length, o = Math.floor(d / len);
    return 60 + this.key + this.scale[d - o * len] + 12 * o;
  }
}
