import { cosine, iou } from './ai.js';

function distance(a, b) {
  const ax = (a[0] + a[2]) / 2, ay = (a[1] + a[3]) / 2;
  const bx = (b[0] + b[2]) / 2, by = (b[1] + b[3]) / 2;
  return Math.hypot(ax - bx, ay - by);
}

export class FaceTracker {
  constructor(settings, onAlert, onActivity = () => {}) {
    this.settings = settings;
    this.onAlert = onAlert;
    this.onActivity = onActivity;
    this.tracks = [];
    this.nextId = 1;
    this.recent = [];
  }

  restore(events, now = Date.now()) {
    for (const event of events) {
      const id = /^U(\d+)$/.exec(event.trackId || '');
      if (id) this.nextId = Math.max(this.nextId, Number(id[1]) + 1);
      const at = event.lastSeenAt ?? event.alertAt;
      if (event.unknownEmbedding?.length && now - at <= this.settings.cooldownMs) {
        this.recent.push({ id: event.trackId, embedding: event.unknownEmbedding, at, eventId: event.eventId, lastReportedAt: at });
      }
    }
  }

  allocateId() { return `U${String(this.nextId++).padStart(3, '0')}`; }

  findRecent(embedding, now) {
    if (!embedding) return null;
    return this.recent
      .filter(record => now - record.at <= this.settings.cooldownMs && cosine(embedding, record.embedding) >= 0.72)
      .sort((a, b) => cosine(embedding, b.embedding) - cosine(embedding, a.embedding))[0] || null;
  }

  reportActivity(track, at, force = false) {
    const record = track.record;
    if (!record?.eventId || at <= record.lastReportedAt || (!force && at - record.lastReportedAt < 2000)) return;
    record.lastReportedAt = at;
    this.onActivity(track, at, record.eventId);
  }

  update(detections, now = Date.now()) {
    for (const track of this.tracks) {
      if (now - track.lastSeen > this.settings.lostGraceMs) this.reportActivity(track, track.lastSeen, true);
    }
    this.tracks = this.tracks.filter(track => now - track.lastSeen <= this.settings.lostGraceMs);
    const unmatched = new Set(this.tracks);
    for (const detection of detections) {
      let best = null, score = -Infinity;
      for (const track of unmatched) {
        const overlap = iou(track.bbox, detection.bbox);
        const gap = distance(track.bbox, detection.bbox);
        const size = Math.max(track.bbox[2] - track.bbox[0], detection.bbox[2] - detection.bbox[0]);
        if (overlap < 0.15 && gap > size * 0.55) continue;
        const rank = overlap * 2 - gap / Math.max(size, 1);
        if (rank > score) { score = rank; best = track; }
      }
      if (best) {
        unmatched.delete(best);
        best.bbox = detection.bbox;
        best.landmarks = detection.landmarks;
        best.detectionScore = detection.detectionScore;
        best.lastSeen = now;
        best.seenCount++;
      } else {
        best = {
          id: this.allocateId(),
          bbox: detection.bbox,
          landmarks: detection.landmarks,
          detectionScore: detection.detectionScore,
          firstSeen: now, lastSeen: now, seenCount: 1,
          status: 'DETECTING', person: null, similarity: -1,
          unknownSince: null, alerted: false, embedding: null, lastRecognition: 0, record: null
        };
        this.tracks.push(best);
      }
    }
    for (const track of this.tracks) {
      if (track.record && track.lastSeen === now) {
        track.record.at = now;
        this.reportActivity(track, now);
      }
    }
    this.tick(now);
    return this.tracks;
  }

  recognize(track, result, now = Date.now()) {
    if (!this.tracks.includes(track)) return;
    track.embedding = result.embedding;
    track.person = result.person;
    track.similarity = result.similarity;
    track.lastRecognition = now;
    if (result.person) {
      track.status = 'KNOWN';
      track.unknownSince = null;
      track.alerted = false;
      track.record = null;
    } else {
      if (!track.record) {
        this.recent = this.recent.filter(record => now - record.at <= this.settings.cooldownMs);
        const record = this.findRecent(track.embedding, now);
        if (record) {
          track.record = record;
          track.id = record.id;
          track.alerted = true;
        }
      }
      if (track.unknownSince === null) track.unknownSince = now;
      track.status = track.alerted ? 'ALERTED' : 'UNKNOWN_PENDING';
      if (track.record) {
        track.record.at = now;
        this.reportActivity(track, now);
      }
    }
    this.tick(now);
  }

  tick(now = Date.now()) {
    this.recent = this.recent.filter(record => this.tracks.some(track => track.record === record) || now - record.at <= this.settings.cooldownMs);
    for (const track of this.tracks) {
      if (track.status !== 'UNKNOWN_PENDING' || track.alerted || track.unknownSince === null) continue;
      if (now - track.lastSeen > this.settings.lostGraceMs || now - track.unknownSince < this.settings.alertDelayMs) continue;
      const existing = this.findRecent(track.embedding, now);
      if (existing) {
        track.record = existing;
        track.id = existing.id;
        track.alerted = true;
        track.status = 'ALERTED';
        existing.at = now;
        this.reportActivity(track, now);
        continue;
      }
      track.alerted = true;
      track.status = 'ALERTED';
      const record = { id: track.id, embedding: [...track.embedding], at: now, eventId: null, lastReportedAt: now };
      track.record = record;
      this.recent.push(record);
      this.onAlert(track, now, record);
    }
  }

  flushActivity() {
    for (const track of this.tracks) this.reportActivity(track, track.lastSeen, true);
  }
}
