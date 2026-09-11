// logic.js — Règles métier centrales de l'application
'use strict';
const { db } = require('./db');

const PRIORITE_POIDS = { urgente: 1, haute: 2, normale: 3, faible: 4 };
const PRIORITE_LABEL = { urgente: '🔴 Urgente', haute: '🟠 Haute', normale: '🔵 Normale', faible: '⚪ Faible' };
const STATUT_LABEL = {
  en_attente: '🔵 En attente',
  en_cours: '🟡 En cours',
  en_pause: '🟣 En pause',
  termine: '🟢 Terminé',
  annule: '⚫ Annulé',
};

// Génère un numéro de ticket unique du type DEM-2026-00458 (séquence annuelle)
function genererNumeroTicket() {
  const annee = new Date().getFullYear();
  const prefix = `DEM-${annee}-`;
  const row = db.prepare(
    `SELECT numero FROM tickets WHERE numero LIKE ? ORDER BY id DESC LIMIT 1`
  ).get(`${prefix}%`);
  let seq = 1;
  if (row) {
    const last = parseInt(row.numero.split('-')[2], 10);
    seq = last + 1;
  }
  return `${prefix}${String(seq).padStart(5, '0')}`;
}

// Règle critique (section 33 du cahier des charges) :
// La position n'est JAMAIS stockée : elle est recalculée à chaque lecture
// à partir des tickets actuellement "en_attente", triés par priorité puis
// ancienneté (FIFO au sein d'une même priorité).
function calculerFileAttente() {
  const rows = db.prepare(`SELECT id, priorite, created_at FROM tickets WHERE statut = 'en_attente'`).all();
  rows.sort((a, b) => {
    const p = PRIORITE_POIDS[a.priorite] - PRIORITE_POIDS[b.priorite];
    if (p !== 0) return p;
    return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
  });
  const map = new Map();
  rows.forEach((r, i) => map.set(r.id, i + 1)); // position 1-based
  return { positions: map, total: rows.length };
}

function positionDe(ticketId) {
  const { positions, total } = calculerFileAttente();
  const position = positions.get(ticketId) || null;
  return {
    position,
    devant: position ? position - 1 : null,
    apres: position ? total - position : null,
    total_en_attente: total,
  };
}

function ajouterHistorique(ticketId, utilisateurId, action, details = null) {
  db.prepare(
    `INSERT INTO ticket_history (ticket_id, utilisateur_id, action, details) VALUES (?, ?, ?, ?)`
  ).run(ticketId, utilisateurId, action, details);
}

function ajouterNotification(userId, ticketId, message) {
  db.prepare(
    `INSERT INTO notifications (user_id, ticket_id, message) VALUES (?, ?, ?)`
  ).run(userId, ticketId, message);
}

function auditLog(userId, action, details = null) {
  db.prepare(`INSERT INTO audit_logs (user_id, action, details) VALUES (?, ?, ?)`).run(userId, action, details);
}

module.exports = {
  PRIORITE_POIDS, PRIORITE_LABEL, STATUT_LABEL,
  genererNumeroTicket, calculerFileAttente, positionDe,
  ajouterHistorique, ajouterNotification, auditLog,
};
