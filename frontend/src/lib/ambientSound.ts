import { audioContext } from "@/lib/audioEngine";

/**
 * A zero-file, offline focus soundscape built with the Web Audio API: a warm slow-breathing pad (a detuned A-minor-7
 * chord through a low-pass) over very soft brown noise (a distant rain-like hush). It loops forever by nature, fades in
 * and out, and is fully torn down on stop.
 */
const LEVEL = 0.32; // overall loudness (0..1); the file-based track plays at 0.45

export interface Ambient {
  stop: () => void;
  setMuted: (muted: boolean) => void;
}

export function startAmbient(muted: boolean): Ambient | null {
  const c = audioContext();
  if (!c) return null;
  try {
    if (c.state !== "running") void c.resume().catch(() => {});
    const out = c.createGain();
    out.gain.value = 0;
    out.connect(c.destination);
    const nodes: AudioNode[] = [out];
    const sources: Array<OscillatorNode | AudioBufferSourceNode> = [];
    const t0 = c.currentTime;
    out.gain.setValueAtTime(0, t0);
    out.gain.linearRampToValueAtTime(muted ? 0 : LEVEL, t0 + 2.5);

    // Pad: A2 E3 G3 C4, each as two slightly detuned oscillators, softened by a low-pass.
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    lp.Q.value = 0.4;
    const pad = c.createGain();
    pad.gain.value = 0.16;
    lp.connect(pad).connect(out);
    nodes.push(lp, pad);
    for (const f of [110, 164.81, 196, 261.63]) {
      for (const detune of [-6, 6]) {
        const o = c.createOscillator();
        o.type = f < 150 ? "triangle" : "sine";
        o.frequency.value = f;
        o.detune.value = detune;
        o.connect(lp);
        o.start(t0);
        sources.push(o);
      }
    }
    // Slow "breathing": an LFO opens and closes the filter every ~14 s.
    const lfo = c.createOscillator();
    const lfoGain = c.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 320;
    lfo.connect(lfoGain).connect(lp.frequency);
    lfo.start(t0);
    sources.push(lfo);
    nodes.push(lfoGain);

    // Brown noise (4 s buffer, looped), very quiet.
    const len = c.sampleRate * 4;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 3.5;
    }
    const noise = c.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const nlp = c.createBiquadFilter();
    nlp.type = "lowpass";
    nlp.frequency.value = 500;
    const ng = c.createGain();
    ng.gain.value = 0.22;
    noise.connect(nlp).connect(ng).connect(out);
    noise.start(t0);
    sources.push(noise);
    nodes.push(nlp, ng);

    let stopped = false;
    return {
      setMuted(m) {
        if (stopped) return;
        const t = c.currentTime;
        out.gain.cancelScheduledValues(t);
        out.gain.setValueAtTime(out.gain.value, t);
        out.gain.linearRampToValueAtTime(m ? 0 : LEVEL, t + 0.3);
      },
      stop() {
        if (stopped) return;
        stopped = true;
        const t = c.currentTime;
        try {
          out.gain.cancelScheduledValues(t);
          out.gain.setValueAtTime(out.gain.value, t);
          out.gain.linearRampToValueAtTime(0, t + 0.5);
        } catch {}
        setTimeout(() => {
          for (const s of sources) { try { s.stop(); } catch {} }
          for (const n of nodes) { try { n.disconnect(); } catch {} }
        }, 600);
      },
    };
  } catch {
    return null;
  }
}
