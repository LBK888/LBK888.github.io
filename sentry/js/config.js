export const DEFAULTS = Object.freeze({
  recognitionThreshold: 0.42,
  detectionThreshold: 0.6,
  alertDelayMs: 5000,
  lostGraceMs: 800,
  cooldownMs: 60000,
  performanceMode: 'AUTO',
  detectorFps: 'AUTO',
  screenshotMaxKb: 100,
  webhookUrl: 'https://mistakenly-proper-zebra.ngrok-free.app/webhook/sentry',
  deviceName: ''
});

export const MAX_IMAGE_BYTES = 100 * 1024;
export const RETRY_DELAYS_MS = [0, 5000, 15000, 60000, 300000];

export function deviceId() {
  let id = localStorage.getItem('sentry-device-id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('sentry-device-id', id);
  }
  return id;
}

export function eventId() {
  return `E${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID()}`;
}
