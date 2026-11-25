import { api, post } from './api.ts';

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function registerServiceWorker(): Promise<void> {
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    await navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }
}

function keyBytes(base64url: string): Uint8Array {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Ask for permission (must come from a tap) and register this device with the given endpoint. */
export async function enablePush(subscribePath: '/api/ticket/push' | '/api/push/subscribe'): Promise<void> {
  if (!pushSupported()) throw new Error(isIOS() && !isStandalone() ? 'On iPhone, add this page to your Home Screen first.' : 'This browser can\u2019t show notifications.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications are blocked. Allow them in your browser settings.');
  const { publicKey } = await api<{ publicKey: string | null }>('/api/push/key');
  if (!publicKey) throw new Error('Notifications aren\u2019t set up on the server yet.');
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
  await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource });
  await post(subscribePath, sub.toJSON());
}

/**
 * Alerts for students who kept the page open but didn't turn on
 * notifications: a short chime, a vibration, and a flashing tab title.
 */
let audio: AudioContext | null = null;
export function unlockSound(): void {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    /* no audio support */
  }
}

export function alertStudent(title: string): void {
  try {
    if (audio) {
      const t = audio.currentTime;
      for (const [i, f] of [880, 1320].entries()) {
        const o = audio.createOscillator();
        const g = audio.createGain();
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + i * 0.18);
        g.gain.exponentialRampToValueAtTime(0.25, t + i * 0.18 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.16);
        o.connect(g).connect(audio.destination);
        o.start(t + i * 0.18);
        o.stop(t + i * 0.18 + 0.17);
      }
    }
  } catch {
    /* ignore */
  }
  navigator.vibrate?.([200, 100, 200]);
  const original = document.title;
  let n = 0;
  const flash = window.setInterval(() => {
    document.title = n++ % 2 ? original : title;
    if (n > 12 || document.visibilityState === 'visible') {
      window.clearInterval(flash);
      document.title = original;
    }
  }, 1000);
}
