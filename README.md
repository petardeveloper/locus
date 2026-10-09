# locus

Make music by writing math, and watch the functions draw while they play.

Every voice is three small functions:

- `y(t)` is the sound, evaluated once per sample for each note
- `hit(n)` runs on every 16th-note step and decides whether the voice plays
- `note(n)` decides which note (or chord) it plays

The selected voice is plotted live with its formula typeset underneath, so what you see is what you're hearing. Below that is the whole song: every hit of every voice across the loop, with the chords on top. Click a bar number to jump there. There's also a fullscreen "stage" mode in 16:9 or 9:16 for recording.

Hover over pretty much anything in the app for a short explanation.

## Running it

No build step, no dependencies to install. Serve the folder with anything static:

```
python -m http.server
```

and open http://localhost:8000. Opening `index.html` straight from disk won't work because audio worklets have to come from http(s).

It also runs fine on GitHub Pages.

## Writing sounds

A kick drum:

```
fk = f + 1100*exp(-t/0.005) + 170*exp(-t/0.04)
tanh(2.5*sin(tau*osc(fk))*exp(-t/0.3))
```

with `hit(n) = s % 4 == 0` and `note(n) = 33`.

- `name = ...` on its own line makes a variable, the last line is the output
- `osc(hz)` integrates a frequency into a phase, so pitch sweeps work: `sin(tau*osc(hz))`
- `lp`, `hp`, `bp` are resonant filters: `lp(saw(f*t), 800, 4)`
- `[a, b, c][i]` picks from a list and wraps, handy for patterns: `hit(n) = [1,0,0,1,0,0,1,0][s]`
- `euclid(k, len, s)` spreads k hits over len steps
- `root`, `ch(j)` and `deg(d)` follow the key, scale and chord progression at the top of the page

The "reference" panel in the app lists everything else.

## Sharing

"share" packs the whole song into the URL (deflated, then base64), nothing gets uploaded. Songs from links are safe to open: the expressions go through a small parser that only knows math, and only the code it generates itself gets compiled.

"wav" renders one pass of the loop to a file. It renders the loop twice and keeps the second pass, so reverb tails from the end wrap around and the file loops cleanly.

## Code

- `js/expr.js` - tokenizer, Pratt parser, codegen to JS, and AST to LaTeX for the display
- `js/engine.js` - sequencer and note rendering, shared by the AudioWorklet and the wav export
- `js/worklet.js` - the AudioWorklet wrapper
- `js/stage.js` - canvas drawing
- `js/presets.js` - instruments and demo songs

Formulas are rendered with [KaTeX](https://katex.org).

## License

MIT, made by Inat Studio.
