// Милый колокольчик Spectia. Звук не хранится в файле — он «синтезируется» на лету
// через Web Audio, поэтому ничего не весит и звучит одинаково на всех компьютерах.

let ctx = null;

/**
 * Играет колокольчик.
 * kind: 'ready' — игра запустилась (две ноты вверх), 'done' — что-то скачалось (три ноты).
 */
export function chime(kind = 'ready', volume = 0.6) {
  if (volume <= 0) return;
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const notes = kind === 'done' ? [1046.5, 1318.5, 1568] : [1318.5, 1760];
    const start = ctx.currentTime + 0.02;
    const master = ctx.createGain();
    master.gain.value = Math.min(1, volume) * 0.35;
    master.connect(ctx.destination);
    notes.forEach((freq, n) => {
      const t = start + n * 0.11;
      // Основной тон + тихий обертон — так звучит как маленький колокольчик
      for (const [mult, level] of [[1, 1], [2.76, 0.18], [5.4, 0.06]]) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq * mult;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(level, t + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + (mult === 1 ? 1.1 : 0.4));
        osc.connect(gain).connect(master);
        osc.start(t);
        osc.stop(t + 1.2);
      }
    });
  } catch { /* звук — приятная мелочь, без него тоже всё работает */ }
}
