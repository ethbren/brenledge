import { getIdToken } from './auth.js';

export const MAX_WATCHLIST_TICKERS = 20;

async function call(path, options = {}) {
  const apiUrl = window.__brenledgeApiUrl;
  if (!apiUrl) throw new Error('API not configured yet — config.json has not loaded.');

  const res = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${getIdToken()}`,
      ...(options.headers || {}),
    },
  });

  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After') || '300';
    throw new Error(`Rate limited — try again in about ${Math.ceil(retryAfter / 60)} minute(s).`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status}).`);
  }
  return res.json();
}

export function fetchWatchlist() {
  return call('/watchlist');
}

export function saveWatchlist(tickers) {
  if (tickers.length > MAX_WATCHLIST_TICKERS) {
    throw new Error(`Watchlist is capped at ${MAX_WATCHLIST_TICKERS} tickers.`);
  }
  return call('/watchlist', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tickers),
  });
}
