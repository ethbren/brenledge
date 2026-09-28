import {
  initAuth,
  signUp,
  confirmSignUp,
  resendConfirmationCode,
  signIn,
  signOut,
  onAuthStateChange,
} from './auth.js';
import { fetchWatchlist, saveWatchlist, MAX_WATCHLIST_TICKERS } from './watchlist.js';

const $ = (id) => document.getElementById(id);

function showScreen(name) {
  ['signup', 'confirm', 'signin'].forEach((n) => {
    $(`${n}-form`).classList.toggle('hidden', n !== name);
  });
}

function setStatus(el, message, isError) {
  el.textContent = message;
  el.className = `status-line ${isError ? 'err' : 'ok'}`;
}

let pendingEmail = '';

// ---------- Auth wiring ----------

$('signup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('signup-email').value.trim();
  const password = $('signup-password').value;
  const status = $('signup-status');
  try {
    await signUp(email, password);
    pendingEmail = email;
    $('confirm-email').value = email;
    setStatus(status, '', false);
    showScreen('confirm');
  } catch (err) {
    setStatus(status, err.message || 'Sign up failed.', true);
  }
});

$('confirm-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('confirm-email').value.trim();
  const code = $('confirm-code').value.trim();
  const status = $('confirm-status');
  try {
    await confirmSignUp(email, code);
    $('signin-email').value = email;
    setStatus($('signin-status'), 'Email confirmed — sign in below.', false);
    showScreen('signin');
  } catch (err) {
    setStatus(status, err.message || 'Confirmation failed.', true);
  }
});

$('resend-code').addEventListener('click', async () => {
  const email = $('confirm-email').value.trim() || pendingEmail;
  try {
    await resendConfirmationCode(email);
    setStatus($('confirm-status'), 'Code resent — check your email.', false);
  } catch (err) {
    setStatus($('confirm-status'), err.message || 'Could not resend code.', true);
  }
});

$('signin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('signin-email').value.trim();
  const password = $('signin-password').value;
  const status = $('signin-status');
  pendingEmail = email;
  try {
    await signIn(email, password);
    // onAuthStateChange fires on success and swaps to the app shell.
  } catch (err) {
    setStatus(status, err.message || 'Sign in failed.', true);
  }
});




$('signout-btn').addEventListener('click', () => {
  signOut();
});

$('show-signin-link').addEventListener('click', (e) => {
  e.preventDefault();
  showScreen('signin');
});
$('show-signup-link').addEventListener('click', (e) => {
  e.preventDefault();
  showScreen('signup');
});

// ---------- Watchlist wiring ----------

let watchlist = [];

function renderWatchlist() {
  $('watchlist-count').textContent = `${watchlist.length}/${MAX_WATCHLIST_TICKERS}`;
  const container = $('watchlist-chips');
  if (watchlist.length === 0) {
    container.innerHTML = '<span class="empty-state" style="padding:8px 0;">No tickers yet — add one below.</span>';
    return;
  }
  container.innerHTML = watchlist
    .map(
      (t) => `<span class="watch-chip">${t}<button type="button" class="chip-remove" data-ticker="${t}" aria-label="Remove ${t}">&times;</button></span>`
    )
    .join('');
  container.querySelectorAll('.chip-remove').forEach((btn) => {
    btn.addEventListener('click', () => removeTicker(btn.dataset.ticker));
  });
}

async function loadWatchlist() {
  const status = $('watchlist-status');
  try {
    watchlist = await fetchWatchlist();
    renderWatchlist();
    status.textContent = '';
  } catch (err) {
    setStatus(status, err.message || 'Could not load watchlist.', true);
  }
}

async function persistWatchlist(next) {
  const status = $('watchlist-status');
  try {
    watchlist = await saveWatchlist(next);
    renderWatchlist();
    setStatus(status, 'Saved.', false);
    setTimeout(() => { status.textContent = ''; }, 2000);
  } catch (err) {
    setStatus(status, err.message || 'Could not save watchlist.', true);
  }
}

function removeTicker(ticker) {
  persistWatchlist(watchlist.filter((t) => t !== ticker));
}

$('watchlist-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('watchlist-input');
  const ticker = input.value.trim().toUpperCase();
  const status = $('watchlist-status');
  if (!ticker) return;
  if (watchlist.includes(ticker)) {
    setStatus(status, `${ticker} is already on your watchlist.`, true);
    return;
  }
  if (watchlist.length >= MAX_WATCHLIST_TICKERS) {
    setStatus(status, `Watchlist is capped at ${MAX_WATCHLIST_TICKERS} tickers.`, true);
    return;
  }
  input.value = '';
  persistWatchlist([...watchlist, ticker]);
});

// ---------- Boot ----------

onAuthStateChange((signedIn) => {
  $('auth-screen').classList.toggle('hidden', signedIn);
  $('app-shell').classList.toggle('hidden', !signedIn);
  if (signedIn) {
    $('signed-in-as').textContent = pendingEmail || '';
    loadWatchlist();
  }
});

initAuth().catch((err) => {
  console.error(err);
  setStatus($('signin-status'), err.message || 'Could not initialize sign-in.', true);
  showScreen('signin');
});
