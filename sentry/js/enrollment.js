export const MIN_SAMPLES = 5;
export const MAX_SAMPLES = 20;

const PREFIXES = ['大', '小', '老', '強', '帥', '美', '中', '威', '', '巨', 'little ', 'the ', '好', '賊', '歪'];
const SUFFIXES = ['成', '林', '師', '乖', '王', '寶', '伯', '姐', '妹', '爹', 'spot', '毛', '鼻', '葉', 'XX', 'YY', 'baby', '機', '正', '中', '五'];

export function suggestedName(existingNames, random = Math.random) {
  const used = new Set(existingNames);
  const prefix = PREFIXES[Math.floor(random() * PREFIXES.length)];
  const firstSuffix = Math.floor(random() * SUFFIXES.length);
  const firstName = (prefix + SUFFIXES[firstSuffix]).trim();
  if (!used.has(firstName)) return firstName;
  const available = SUFFIXES.map(word => (prefix + word).trim()).filter(name => !used.has(name));
  if (available.length) return available[Math.floor(random() * available.length)];
  // All suffixes for this prefix are taken; keep the suggestion unique.
  let number = 2;
  while (used.has(`${firstName}${number}`)) number++;
  return `${firstName}${number}`;
}

export function collectSample(registration, embedding, now) {
  if (registration.complete || registration.samples.length >= MAX_SAMPLES || now - registration.lastSample <= 140) return false;
  registration.samples.push(embedding);
  registration.lastSample = now;
  if (registration.samples.length === MAX_SAMPLES) registration.complete = true;
  return true;
}

export function finishIfFaceLost(registration, tracks) {
  if (!registration || registration.complete || tracks.some(track => registration.track ? track === registration.track : track.id === registration.trackId)) return false;
  if (registration.samples.length >= MIN_SAMPLES) registration.complete = true;
  return true;
}
