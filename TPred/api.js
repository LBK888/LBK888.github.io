import { DEFAULT_API_BASE } from './config.js';

const STORAGE_KEY = 'sequence-duel-api-base';

export function normalizeApiBase(value) {
  const input = String(value ?? '').trim();
  if (!input) return '';
  const url = new URL(input);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('Use an HTTPS backend URL (HTTP is allowed for localhost).');
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Enter only the backend origin, without a path or credentials.');
  }
  return url.origin;
}

function initialBase() {
  let saved = '';
  try { saved = localStorage.getItem(STORAGE_KEY) || ''; } catch { /* Storage is optional. */ }
  try { return normalizeApiBase(saved || DEFAULT_API_BASE); } catch { return ''; }
}

let base = initialBase();

export function getApiBase() {
  if (base) return base;
  return ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) ? location.origin : '';
}

export function setApiBase(value) {
  base = normalizeApiBase(value);
  try {
    if (base) localStorage.setItem(STORAGE_KEY, base);
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* Private browsing may disallow storage. */ }
  return getApiBase();
}

export async function apiFetch(path, options = {}) {
  const origin = getApiBase();
  if (!origin) throw new Error('Enter the backend HTTPS URL in Settings.');
  if (!path.startsWith('/api/')) throw new Error('Invalid API path.');
  const headers = new Headers(options.headers || {});
  if (/\.ngrok(?:-free)?\.app$|\.ngrok\.io$/.test(new URL(origin).hostname)) {
    headers.set('ngrok-skip-browser-warning', '1');
  }
  return fetch(`${origin}${path}`, {
    ...options, headers, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
    signal: options.signal ?? AbortSignal.timeout(2500),
  });
}

export async function checkApiHealth() {
  const response = await apiFetch('/api/health');
  if (!response.ok || !(await response.json()).ok) throw new Error(`Backend returned HTTP ${response.status}.`);
  return true;
}
