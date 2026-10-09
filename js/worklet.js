import { Engine } from './engine.js';

class LocusProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.engine = new Engine(sampleRate);
    this.quiet = !!opts.quiet;
    this.count = 0;
    if (opts.song) this.engine.setSong(opts.song);
    if (opts.play) this.engine.start();
    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'song') this.engine.setSong(msg.song);
      else if (msg.type === 'play') this.engine.start(msg.from || 0);
      else if (msg.type === 'stop') this.engine.stop();
    };
  }

  process(inputs, outputs) {
    const [dry, send] = outputs;
    for (const ch of dry) ch.fill(0);
    for (const ch of send) ch.fill(0);
    const e = this.engine;
    e.process(dry[0], dry[1], send[0], send[1], dry[0].length);
    if (!this.quiet && (this.count += dry[0].length) >= 1024) {
      this.count = 0;
      const time = currentTime + dry[0].length / sampleRate;
      this.port.postMessage({ type: 'pos', time, step: e.position(), bpm: e.bpm, playing: e.playing });
    }
    return true;
  }
}

registerProcessor('locus', LocusProcessor);
