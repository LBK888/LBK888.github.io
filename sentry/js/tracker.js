import { cosine, iou } from './ai.js';

function distance(a, b) {
  const ax = (a[0] + a[2]) / 2, ay = (a[1] + a[3]) / 2;
  const bx = (b[0] + b[2]) / 2, by = (b[1] + b[3]) / 2;
  return Math.hypot(ax - bx, ay - by);
}

export class FaceTracker {
  constructor(settings, onAlert) {
    this.settings = settings;
    this.onAlert = onAlert;
    this.tracks = [];
    this.nextId = 1;
    this.recent = [];
  }

  update(detections, now = Date.now()) {
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
          id: `U${String(this.nextId++).padStart(3, '0')}`,
          bbox: detection.bbox,
          landmarks: detection.landmarks,
          detectionScore: detection.detectionScore,
          firstSeen: now, lastSeen: now, seenCount: 1,
          status: 'DETECTING', person: null, similarity: -1,
          unknownSince: null, alerted: false, embedding: null, lastRecognition: 0
        };
        this.tracks.push(best);
      }
    }
    this.tracks = this.tracks.filter(track => now - track.lastSeen <= this.settings.lostGraceMs);
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
    } else {
      if (track.unknownSince === null) track.unknownSince = now;
      track.status = track.alerted ? 'ALERTED' : 'UNKNOWN_PENDING';
    }
    this.tick(now);
  }

  tick(now = Date.now()) {
    this.recent = this.recent.filter(alert => now - alert.at < this.settings.cooldownMs);
    for (const track of this.tracks) {
      if (track.status !== 'UNKNOWN_PENDING' || track.alerted || track.unknownSince === null) continue;
      if (now - track.lastSeen > this.settings.lostGraceMs || now - track.unknownSince < this.settings.alertDelayMs) continue;
      track.alerted = true;
      track.status = 'ALERTED';
      const samePerson = track.embedding && this.recent.some(alert => cosine(track.embedding, alert.embedding) >= 0.72);
      if (!samePerson) {
        if (track.embedding) this.recent.push({ embedding: track.embedding, at: now });
        this.onAlert(track, now);
      }
    }
  }
}
