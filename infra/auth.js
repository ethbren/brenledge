// ============================================================
// Brenledge — Cognito authentication
//
// Uses amazon-cognito-identity-js (loaded from esm.sh — no npm/bundler
// step needed for the frontend) to do SRP sign-in against the Cognito
// User Pool this site's config.json points at.
//
// MFA is currently OFF at the User Pool (see brenledge-stack.ts), so
// signIn() below just resolves on success. If MFA comes back later, the
// mfaSetup/totpRequired challenge handling (and the associated
// associateSoftwareToken/verifySoftwareToken/submitMfaCode flow) needs to
// be reintroduced here alongside the matching UI in index.html/main.js.
// ============================================================

import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
} from 'https://esm.sh/amazon-cognito-identity-js@6.3.12';

let userPool = null;
let currentUser = null;
let idToken = null;
let tokenExpiryMs = 0;

const listeners = [];

async function loadConfig() {
  const res = await fetch('/config.json', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Could not load /config.json — has the site been deployed with `cdk deploy`?');
  }
  return res.json();
}

export async function initAuth() {
  const config = await loadConfig();
  userPool = new CognitoUserPool({
    UserPoolId: config.userPoolId,
    ClientId: config.userPoolClientId,
  });
  window.__brenledgeApiUrl = config.apiUrl;

  const existing = userPool.getCurrentUser();
  if (existing) {
    try {
      await new Promise((resolve, reject) => {
        existing.getSession((err, session) => {
          if (err || !session.isValid()) return reject(err || new Error('Invalid session'));
          currentUser = existing;
          idToken = session.getIdToken().getJwtToken();
          tokenExpiryMs = session.getIdToken().getExpiration() * 1000;
          resolve();
        });
      });
      notify(true);
      return;
    } catch {
      // fall through to signed-out state
    }
  }
  notify(false);
}

export function getIdToken() {
  if (!idToken || Date.now() > tokenExpiryMs - 30000) {
    throw new Error('Not signed in, or your session expired — please sign in again.');
  }
  return idToken;
}

export function isSignedIn() {
  return !!idToken && Date.now() < tokenExpiryMs;
}

export function signUp(email, password) {
  return new Promise((resolve, reject) => {
    userPool.signUp(email, password, [], null, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });
}

export function confirmSignUp(email, code) {
  const user = new CognitoUser({ Username: email, Pool: userPool });
  return new Promise((resolve, reject) => {
    user.confirmRegistration(code, true, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });
}

export function resendConfirmationCode(email) {
  const user = new CognitoUser({ Username: email, Pool: userPool });
  return new Promise((resolve, reject) => {
    user.resendConfirmationCode((err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });
}

export function signIn(email, password) {
  const authDetails = new AuthenticationDetails({ Username: email, Password: password });
  const user = new CognitoUser({ Username: email, Pool: userPool });

  return new Promise((resolve, reject) => {
    user.authenticateUser(authDetails, {
      onSuccess: (session) => {
        currentUser = user;
        idToken = session.getIdToken().getJwtToken();
        tokenExpiryMs = session.getIdToken().getExpiration() * 1000;
        notify(true);
        resolve();
      },
      onFailure: (err) => reject(err),
    });
  });
}

export function signOut() {
  if (currentUser) currentUser.signOut();
  currentUser = null;
  idToken = null;
  tokenExpiryMs = 0;
  notify(false);
}

export function onAuthStateChange(fn) {
  listeners.push(fn);
}

function notify(isSignedIn) {
  listeners.forEach((fn) => fn(isSignedIn));
}
