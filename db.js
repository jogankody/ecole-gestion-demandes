// db.js — Couche base de données (SQLite natif Node.js, zéro dépendance npm)
'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

// DATA_DIR permet de déplacer le stockage vers un disque persistant en ligne
// (ex: hébergement cloud). En local, sans cette variable, tout reste dans ./data.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'ecole.db');
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL,
    identifiant TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('demandeur','agent','admin','superadmin')),
    fonction TEXT,
    service TEXT,
    telephone TEXT,
    email TEXT,
    actif INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT UNIQUE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero TEXT UNIQUE NOT NULL,
    demandeur_id INTEGER NOT NULL REFERENCES users(id),
    categorie TEXT,
    objet TEXT NOT NULL,
    description TEXT,
    priorite TEXT NOT NULL DEFAULT 'normale' CHECK(priorite IN ('urgente','haute','normale','faible')),
    statut TEXT NOT NULL DEFAULT 'en_attente' CHECK(statut IN ('en_attente','en_cours','en_pause','termine','annule')),
    date_souhaitee TEXT,
    date_limite TEXT,
    commentaire TEXT,
    agent_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    termine_at TEXT
  );

  CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id),
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime TEXT,
    size INTEGER,
    uploaded_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id),
    auteur_id INTEGER NOT NULL REFERENCES users(id),
    contenu TEXT NOT NULL,
    interne INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ticket_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id),
    utilisateur_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    ticket_id INTEGER REFERENCES tickets(id),
    message TEXT NOT NULL,
    lu INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_tickets_statut ON tickets(statut);
  CREATE INDEX IF NOT EXISTS idx_tickets_demandeur ON tickets(demandeur_id);
`);

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, salt, hash) {
  const test = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(test), Buffer.from(hash));
}

// --- Seed initial (une seule fois) ---
const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (userCount === 0) {
  const insertUser = db.prepare(`
    INSERT INTO users (nom, identifiant, password_hash, password_salt, role, fonction, service, email, actif)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);
  const seed = [
    ['Super Administrateur', 'superadmin', 'superadmin123', 'superadmin', 'Directeur des systèmes', 'Direction', 'superadmin@ecole.local'],
    ['Admin École', 'admin', 'admin123', 'admin', 'Administrateur système', 'Direction', 'admin@ecole.local'],
    ['Jean Agent', 'agent', 'agent123', 'agent', 'Agent informatique / secrétariat', 'Service informatique', 'agent@ecole.local'],
    ['Mme Kouassi', 'kouassi', 'demo1234', 'demandeur', 'Enseignante', 'Pédagogie', 'kouassi@ecole.local'],
  ];
  for (const [nom, identifiant, pwd, role, fonction, service, email] of seed) {
    const { hash, salt } = hashPassword(pwd);
    insertUser.run(nom, identifiant, hash, salt, role, fonction, service, email);
  }

  const insertCat = db.prepare('INSERT INTO categories (nom) VALUES (?)');
  ['Administrative', 'Secrétariat', 'Informatique', 'Saisie de données', 'Élèves', 'Documents', 'Impression', 'Numérisation', 'Maintenance', 'Autre']
    .forEach(nom => insertCat.run(nom));

  console.log('Base de données initialisée avec des comptes de démonstration :');
  console.log(' superadmin / superadmin123');
  console.log(' admin / admin123');
  console.log(' agent / agent123');
  console.log(' kouassi / demo1234 (demandeur)');
}

module.exports = { db, hashPassword, verifyPassword };
