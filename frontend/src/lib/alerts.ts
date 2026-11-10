let ctx: AudioContext | null = null;

export function beep(freq = 880, duration = 0.15, times = 3): void {
  try {
    ctx ??= new AudioContext();
    for (let i = 0; i < times; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const t0 = ctx.currentTime + i * (duration + 0.08);
      gain.gain.setValueAtTime(0.25, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
      osc.start(t0);
      osc.stop(t0 + duration);
    }
  } catch {
    /* audio unavailable */
  }
}

export function notify(title: string, body: string): void {
  try {
    if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body });
  } catch {
    /* notifications unavailable */
  }
}

export async function enableAlerts(): Promise<NotificationPermission | 'unsupported'> {
  beep(660, 0.1, 1); // also unlocks audio after a user gesture
  if (!('Notification' in window)) return 'unsupported';
  return Notification.requestPermission();
}
