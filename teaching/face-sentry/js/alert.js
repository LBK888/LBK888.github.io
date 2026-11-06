import { MAX_IMAGE_BYTES, deviceId, eventId } from './config.js';

function toBlob(canvas, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
}

export async function createAlert(video, track, settings, at) {
  const longest = Math.max(video.videoWidth, video.videoHeight);
  let edge = Math.min(640, longest), blob;
  while (edge >= 320) {
    const ratio = edge / longest;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * ratio);
    canvas.height = Math.round(video.videoHeight * ratio);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const [x1, y1, x2, y2] = track.bbox.map(value => value * ratio);
    ctx.strokeStyle = '#FF7B72'; ctx.lineWidth = 3;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    ctx.font = 'bold 15px sans-serif';
    const label = `UNKNOWN ${track.id}  DET ${track.detectionScore.toFixed(2)}  SIM ${Math.max(0, track.similarity).toFixed(2)}`;
    const labelWidth = Math.min(canvas.width, ctx.measureText(label).width + 16);
    const labelY = y1 > 30 ? y1 - 28 : y1;
    ctx.fillStyle = '#FF7B72'; ctx.fillRect(x1, labelY, labelWidth, 26);
    ctx.fillStyle = '#111827'; ctx.fillText(label, x1 + 8, labelY + 18, labelWidth - 12);
    ctx.font = '12px sans-serif';
    const stamp = new Date(at).toLocaleString('zh-TW');
    const stampWidth = ctx.measureText(stamp).width + 16;
    ctx.fillStyle = 'rgba(12, 19, 29, .8)'; ctx.fillRect(0, canvas.height - 26, stampWidth, 26);
    ctx.fillStyle = '#fff'; ctx.fillText(stamp, 8, canvas.height - 8);
    for (const quality of [0.66, 0.56, 0.46, 0.36]) {
      blob = await toBlob(canvas, quality);
      if (blob && blob.size <= Math.min(MAX_IMAGE_BYTES, settings.screenshotMaxKb * 1024)) break;
    }
    if (blob?.size <= Math.min(MAX_IMAGE_BYTES, settings.screenshotMaxKb * 1024)) break;
    edge = edge === 640 ? 512 : edge - 64;
  }
  if (!blob || blob.size > Math.min(MAX_IMAGE_BYTES, settings.screenshotMaxKb * 1024)) throw new Error('截圖無法壓縮到設定上限以下');
  return {
    eventId: eventId(), trackId: track.id, type: 'unknown_person',
    deviceId: deviceId(), deviceName: settings.deviceName || '',
    firstSeen: track.unknownSince, alertAt: at,
    duration: (at - track.unknownSince) / 1000,
    detScore: track.detectionScore,
    maxKnownSimilarity: Math.max(0, track.similarity),
    status: 'PENDING', screenshotBlob: blob
  };
}
