/** Optional, gesture-unlocked sound. All game information also has a visual cue. */
export function createSound() {
  let context: AudioContext | null = null;
  let muted = true;
  return {
    setMuted(value: boolean) {
      muted = value;
      if (muted) { void context?.suspend().catch(() => {}); return; }
      try {
        context ??= new AudioContext();
        void context.resume().catch(() => {});
      } catch { /* Some browsers do not provide Web Audio; the game remains usable. */ }
    },
    cue() {
      if (muted || !context || context.state !== 'running') return;
      const now = context.currentTime;
      for (const [index, frequency] of [261.63, 329.63, 392].entries()) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        const start = now + index * 0.09;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.035, start + 0.035);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.65);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(start); oscillator.stop(start + 0.7);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      }
    },
  };
}
