// auth.js — Sessions en mémoire + helpers d'authentification
'use strict';
const crypto = require('node:crypto');
const { db, hashPassword, verifyPassword } = require('./db');

const SESSIONS = new Map(); // token -> { userId, expires }
const SESSION_DUREE_MS = 8 * 60 * 60 * 1000; // 8h, configurable

function creerSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  SESSIONS.set(token, { userId, expires: Date.now() + SESSION_DUREE_MS });
  return token;
}

function detruireSession(token) {
  SESSIONS.delete(token);
}

function getCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  const parts = header.split(';').map(p => p.trim());
  for (const p of parts) {
    const [k, ...v] = p.split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

function utilisateurCourant(req) {
  const token = getCookie(req, 'session');
  if (!token) return null;
  const s = SESSIONS.get(token);
  if (!s || s.expires < Date.now()) {
    SESSIONS.delete(token);
    return null;
  }
  const user = db.prepare('SELECT id, nom, identifiant, role, fonction, service, email, actif FROM users WHERE id = ?').get(s.userId);
  if (!user || !user.actif) return null;
  return user;
}

function login(identifiant, motDePasse) {
  const user = db.prepare('SELECT * FROM users WHERE identifiant = ?').get(identifiant);
  if (!user || !user.actif) return null;
  if (!verifyPassword(motDePasse, user.password_salt, user.password_hash)) return null;
  return user;
}

module.exports = { creerSession, detruireSession, getCookie, utilisateurCourant, login, hashPassword };
