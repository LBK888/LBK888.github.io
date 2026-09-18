import { all, get, put, updateEventStatus } from './db.js';
import { RETRY_DELAYS_MS } from './config.js';

export class OutboxWorker {
  constructor(getSettings, onChange) {
    this.getSettings = getSettings;
    this.onChange = onChange;
    this.busy = false;
    this.backend = 'UNKNOWN';
  }

  start() {
    this.timer = setInterval(() => void this.flush(), 3000);
    window.addEventListener('online', this.onOnline = () => void this.flush());
    void this.flush();
  }

  stop() {
    clearInterval(this.timer);
    window.removeEventListener('online', this.onOnline);
  }

  async flush(force = false) {
    if (this.busy) return;
    this.busy = true;
    try {
      const jobs = (await all('outbox')).filter(job => job.status !== 'SENT' && (force || job.nextAttemptAt <= Date.now()));
      for (const job of jobs) {
        const event = await get('events', job.eventId);
        if (!event) continue;
        job.status = 'SENDING'; await put('outbox', job); this.onChange();
        try {
          const form = new FormData();
          for (const [key, value] of Object.entries({
            event_id: event.eventId, device_id: event.deviceId, device_name: event.deviceName,
            timestamp: new Date(event.alertAt).toISOString(), track_id: event.trackId,
            duration: event.duration, det_score: event.detScore,
            similarity: event.maxKnownSimilarity, session_key: sessionStorage.getItem('sentry-session-key') || ''
          })) form.append(key, String(value));
          form.append('image', event.screenshotBlob, `${event.eventId}.jpg`);
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15000);
          let response;
          try { response = await fetch(this.getSettings().webhookUrl, { method: 'POST', body: form, signal: controller.signal }); }
          finally { clearTimeout(timeout); }
          const body = await response.json();
          if (!response.ok || !body.ok || !body.stored || body.eventId !== event.eventId) throw new Error(body.error || `HTTP ${response.status}`);
          job.status = 'SENT'; job.sentAt = Date.now(); job.lastError = '';
          await updateEventStatus(event.eventId, 'SENT');
          this.backend = 'ONLINE';
        } catch (error) {
          job.attempts++;
          job.status = 'FAILED_RETRY';
          job.nextAttemptAt = Date.now() + RETRY_DELAYS_MS[Math.min(job.attempts, RETRY_DELAYS_MS.length - 1)];
          job.lastError = String(error.message || error).slice(0, 160);
          this.backend = 'OFFLINE';
        }
        await put('outbox', job);
        this.onChange();
      }
    } finally { this.busy = false; }
  }

  async pendingCount() {
    return (await all('outbox')).filter(job => job.status !== 'SENT').length;
  }
}
