// server.js — Serveur principal (Node.js pur, aucune dépendance npm)
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db } = require('./db');
const {
  genererNumeroTicket, positionDe, calculerFileAttente,
  ajouterHistorique, ajouterNotification, auditLog,
  PRIORITE_LABEL, STATUT_LABEL, PRIORITE_POIDS,
} = require('./logic');
const { creerSession, detruireSession, utilisateurCourant, login, hashPassword } = require('./auth');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const MAX_FICHIER_OCTETS = 15 * 1024 * 1024; // 15 Mo, configurable
const EXTENSIONS_AUTORISEES = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.jpg', '.jpeg', '.png', '.webp', '.zip'];

// --------- Utilitaires HTTP ---------
function envoyerJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function lireCorpsJSON(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let taille = 0;
    req.on('data', (c) => {
      taille += c.length;
      if (taille > MAX_FICHIER_OCTETS + 1024 * 1024) {
        reject(new Error('Corps de requête trop volumineux'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function nomFichierSecurise(nomOriginal) {
  const ext = path.extname(nomOriginal).toLowerCase();
  const base = path.basename(nomOriginal, ext).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
  const unique = crypto.randomBytes(6).toString('hex');
  return { ext, filename: `${Date.now()}_${unique}_${base}${ext}` };
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
};

function servirStatique(req, res) {
  let filePath = req.url.split('?')[0];
  if (filePath === '/') filePath = '/index.html';
  const resolved = path.join(PUBLIC_DIR, filePath);
  if (!resolved.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Interdit'); }
  fs.readFile(resolved, (err, content) => {
    if (err) { res.writeHead(404); return res.end('Introuvable'); }
    const ext = path.extname(resolved);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

// --------- Sérialisation ticket ---------
function serialiserTicket(t, inclureDetails = false) {
  const pos = t.statut === 'en_attente' ? positionDe(t.id) : { position: null, devant: null, apres: null, total_en_attente: calculerFileAttente().total };
  const base = {
    id: t.id, numero: t.numero, objet: t.objet, categorie: t.categorie,
    priorite: t.priorite, priorite_label: PRIORITE_LABEL[t.priorite],
    statut: t.statut, statut_label: STATUT_LABEL[t.statut],
    date_souhaitee: t.date_souhaitee, date_limite: t.date_limite,
    created_at: t.created_at, updated_at: t.updated_at, termine_at: t.termine_at,
    demandeur_id: t.demandeur_id, agent_id: t.agent_id,
    position: pos.position, demandes_devant: pos.devant, demandes_apres: pos.apres,
  };
  if (!inclureDetails) return base;
  const demandeur = db.prepare('SELECT id, nom, service, fonction FROM users WHERE id = ?').get(t.demandeur_id);
  const agent = t.agent_id ? db.prepare('SELECT id, nom FROM users WHERE id = ?').get(t.agent_id) : null;
  const historique = db.prepare(`
    SELECT h.*, u.nom AS utilisateur_nom FROM ticket_history h
    LEFT JOIN users u ON u.id = h.utilisateur_id
    WHERE h.ticket_id = ? ORDER BY h.id ASC
  `).all(t.id);
  const commentaires = db.prepare(`
    SELECT c.*, u.nom AS auteur_nom FROM comments c
    JOIN users u ON u.id = c.auteur_id
    WHERE c.ticket_id = ? ORDER BY c.id ASC
  `).all(t.id);
  const pieces = db.prepare(`SELECT id, original_name, mime, size, created_at FROM attachments WHERE ticket_id = ? ORDER BY id ASC`).all(t.id);
  // Échéance
  let echeance_info = null;
  if (t.date_limite && t.statut !== 'termine' && t.statut !== 'annule') {
    const diffJours = Math.ceil((new Date(t.date_limite) - new Date()) / 86400000);
    if (diffJours < 0) echeance_info = { type: 'retard', label: `🔴 EN RETARD de ${Math.abs(diffJours)} jour(s)` };
    else if (diffJours === 0) echeance_info = { type: 'aujourdhui', label: "🟠 Échéance aujourd'hui" };
    else if (diffJours === 1) echeance_info = { type: 'demain', label: '🟠 Échéance demain' };
    else echeance_info = { type: 'a_venir', label: `🟢 Échéance dans ${diffJours} jours` };
  }
  return { ...base, description: t.description, commentaire: t.commentaire, demandeur, agent, historique, commentaires, pieces_jointes: pieces, echeance_info };
}

// --------- Handlers API ---------
async function handleAPI(req, res, urlPath, methode) {
  const user = utilisateurCourant(req);
  const estAgentOuPlus = user && ['agent', 'admin', 'superadmin'].includes(user.role);
  const estAdmin = user && ['admin', 'superadmin'].includes(user.role);

  // ---- AUTH ----
  if (urlPath === '/api/auth/login' && methode === 'POST') {
    const { identifiant, mot_de_passe } = await lireCorpsJSON(req);
    const u = login((identifiant || '').trim(), mot_de_passe || '');
    if (!u) return envoyerJSON(res, 401, { erreur: 'Identifiant ou mot de passe incorrect.' });
    const token = creerSession(u.id);
    res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=28800`);
    auditLog(u.id, 'connexion');
    return envoyerJSON(res, 200, { id: u.id, nom: u.nom, role: u.role, identifiant: u.identifiant });
  }

  if (urlPath === '/api/auth/register' && methode === 'POST') {
    const d = await lireCorpsJSON(req);
    if (!d.identifiant || !d.mot_de_passe || !d.nom) return envoyerJSON(res, 400, { erreur: 'Champs requis manquants.' });
    const existe = db.prepare('SELECT id FROM users WHERE identifiant = ?').get(d.identifiant);
    if (existe) return envoyerJSON(res, 409, { erreur: 'Cet identifiant existe déjà.' });
    const { hash, salt } = hashPassword(d.mot_de_passe);
    const info = db.prepare(`
      INSERT INTO users (nom, identifiant, password_hash, password_salt, role, fonction, service, telephone, email)
      VALUES (?, ?, ?, ?, 'demandeur', ?, ?, ?, ?)
    `).run(d.nom, d.identifiant, hash, salt, d.fonction || null, d.service || null, d.telephone || null, d.email || null);
    const token = creerSession(info.lastInsertRowid);
    res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=28800`);
    return envoyerJSON(res, 201, { id: info.lastInsertRowid, nom: d.nom, role: 'demandeur' });
  }

  if (urlPath === '/api/auth/logout' && methode === 'POST') {
    const { getCookie } = require('./auth');
    detruireSession(getCookie(req, 'session'));
    res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; Max-Age=0');
    return envoyerJSON(res, 200, { ok: true });
  }

  if (urlPath === '/api/me' && methode === 'GET') {
    if (!user) return envoyerJSON(res, 401, { erreur: 'Non authentifié.' });
    return envoyerJSON(res, 200, user);
  }

  // --- Tout ce qui suit nécessite d'être connecté ---
  if (!user) return envoyerJSON(res, 401, { erreur: 'Non authentifié.' });

  if (urlPath === '/api/categories' && methode === 'GET') {
    return envoyerJSON(res, 200, db.prepare('SELECT nom FROM categories ORDER BY nom').all().map(r => r.nom));
  }

  // ---- CRÉATION DE TICKET ----
  if (urlPath === '/api/tickets' && methode === 'POST') {
    const d = await lireCorpsJSON(req);
    if (!d.objet || !d.objet.trim()) return envoyerJSON(res, 400, { erreur: "L'objet de la demande est requis." });
    const priorite = ['urgente', 'haute', 'normale', 'faible'].includes(d.priorite) ? d.priorite : 'normale';
    const numero = genererNumeroTicket();
    const info = db.prepare(`
      INSERT INTO tickets (numero, demandeur_id, categorie, objet, description, priorite, date_souhaitee, date_limite, commentaire, statut)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'en_attente')
    `).run(numero, user.id, d.categorie || null, d.objet.trim(), d.description || null, priorite, d.date_souhaitee || null, d.date_limite || null, d.commentaire || null);
    const ticketId = info.lastInsertRowid;
    ajouterHistorique(ticketId, user.id, 'creation', `Ticket ${numero} créé par ${user.nom}`);
    ajouterNotification(user.id, ticketId, `Votre demande ${numero} a été enregistrée.`);
    auditLog(user.id, 'creation_ticket', numero);
    const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
    return envoyerJSON(res, 201, serialiserTicket(t, true));
  }

  // ---- LISTE DES TICKETS (avec recherche/filtres) ----
  if (urlPath === '/api/tickets' && methode === 'GET') {
    const u = new URL(req.url, 'http://x');
    let sql = 'SELECT * FROM tickets WHERE 1=1';
    const params = [];
    if (!estAgentOuPlus) { sql += ' AND demandeur_id = ?'; params.push(user.id); }
    const q = u.searchParams.get('q');
    if (q) { sql += ' AND (numero LIKE ? OR objet LIKE ? OR description LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    const statut = u.searchParams.get('statut');
    if (statut) { sql += ' AND statut = ?'; params.push(statut); }
    const priorite = u.searchParams.get('priorite');
    if (priorite) { sql += ' AND priorite = ?'; params.push(priorite); }
    const categorie = u.searchParams.get('categorie');
    if (categorie) { sql += ' AND categorie = ?'; params.push(categorie); }
    sql += ' ORDER BY created_at DESC';
    const rows = db.prepare(sql).all(...params);
    // Pour la file d'attente triée intelligemment (utilisée par la vue admin)
    const tri = u.searchParams.get('tri');
    let resultats = rows.map(t => serialiserTicket(t));
    if (tri === 'file') {
      resultats = resultats.sort((a, b) => {
        if (a.statut === 'en_attente' && b.statut === 'en_attente') return a.position - b.position;
        if (a.statut === 'en_attente') return -1;
        if (b.statut === 'en_attente') return 1;
        return new Date(b.created_at) - new Date(a.created_at);
      });
    }
    return envoyerJSON(res, 200, resultats);
  }

  // ---- DÉTAIL D'UN TICKET ----
  const matchDetail = urlPath.match(/^\/api\/tickets\/(\d+)$/);
  if (matchDetail && methode === 'GET') {
    const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(Number(matchDetail[1]));
    if (!t) return envoyerJSON(res, 404, { erreur: 'Demande introuvable.' });
    if (!estAgentOuPlus && t.demandeur_id !== user.id) return envoyerJSON(res, 403, { erreur: 'Accès refusé.' });
    return envoyerJSON(res, 200, serialiserTicket(t, true));
  }

  // ---- ACTIONS SUR UN TICKET (workflow) ----
  const matchAction = urlPath.match(/^\/api\/tickets\/(\d+)\/action$/);
  if (matchAction && methode === 'POST') {
    if (!estAgentOuPlus) return envoyerJSON(res, 403, { erreur: 'Réservé aux agents/administrateurs.' });
    const ticketId = Number(matchAction[1]);
    const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
    if (!t) return envoyerJSON(res, 404, { erreur: 'Demande introuvable.' });
    const { action, motif } = await lireCorpsJSON(req);
    const transitions = {
      prendre_en_charge: { de: ['en_attente'], vers: 'en_cours', label: 'Demande prise en charge' },
      mettre_en_attente: { de: ['en_cours'], vers: 'en_pause', label: 'Travail mis en pause' },
      reprendre: { de: ['en_pause'], vers: 'en_cours', label: 'Travail repris' },
      terminer: { de: ['en_cours', 'en_pause'], vers: 'termine', label: 'Demande terminée' },
      annuler: { de: ['en_attente', 'en_cours', 'en_pause'], vers: 'annule', label: 'Demande annulée' },
    };
    const tr = transitions[action];
    if (!tr) return envoyerJSON(res, 400, { erreur: 'Action inconnue.' });
    if (!tr.de.includes(t.statut)) return envoyerJSON(res, 409, { erreur: `Transition invalide depuis le statut "${t.statut}".` });
    const champsMaj = { statut: tr.vers, updated_at: new Date().toISOString(), agent_id: t.agent_id || user.id };
    if (tr.vers === 'termine') champsMaj.termine_at = new Date().toISOString();
    db.prepare('UPDATE tickets SET statut = ?, updated_at = ?, agent_id = ?, termine_at = COALESCE(?, termine_at) WHERE id = ?')
      .run(champsMaj.statut, champsMaj.updated_at, champsMaj.agent_id, champsMaj.termine_at || null, ticketId);
    ajouterHistorique(ticketId, user.id, action, motif ? `${tr.label} — Motif : ${motif}` : tr.label);
    ajouterNotification(t.demandeur_id, ticketId, `${tr.label} pour votre demande ${t.numero}.`);
    auditLog(user.id, 'action_ticket', `${t.numero}: ${action}`);
    const t2 = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
    return envoyerJSON(res, 200, serialiserTicket(t2, true));
  }

  // ---- CHANGER PRIORITÉ ----
  const matchPriorite = urlPath.match(/^\/api\/tickets\/(\d+)\/priorite$/);
  if (matchPriorite && methode === 'POST') {
    if (!estAgentOuPlus) return envoyerJSON(res, 403, { erreur: 'Réservé aux agents/administrateurs.' });
    const ticketId = Number(matchPriorite[1]);
    const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
    if (!t) return envoyerJSON(res, 404, { erreur: 'Demande introuvable.' });
    const { priorite, motif } = await lireCorpsJSON(req);
    if (!PRIORITE_POIDS[priorite]) return envoyerJSON(res, 400, { erreur: 'Priorité invalide.' });
    const ancienne = t.priorite;
    const ancPos = positionDe(ticketId).position;
    db.prepare('UPDATE tickets SET priorite = ?, updated_at = ? WHERE id = ?').run(priorite, new Date().toISOString(), ticketId);
    const nouvellePos = positionDe(ticketId).position;
    const detail = `Priorité modifiée : ${ancienne} → ${priorite}` +
      (ancPos && nouvellePos ? ` (position ${ancPos} → ${nouvellePos})` : '') +
      (motif ? ` — Motif : ${motif}` : '');
    ajouterHistorique(ticketId, user.id, 'changement_priorite', detail);
    ajouterNotification(t.demandeur_id, ticketId, `La priorité de votre demande ${t.numero} a été modifiée (${priorite}).`);
    const t2 = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
    return envoyerJSON(res, 200, serialiserTicket(t2, true));
  }

  // ---- COMMENTAIRES ----
  const matchComment = urlPath.match(/^\/api\/tickets\/(\d+)\/comment$/);
  if (matchComment && methode === 'POST') {
    const ticketId = Number(matchComment[1]);
    const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
    if (!t) return envoyerJSON(res, 404, { erreur: 'Demande introuvable.' });
    if (!estAgentOuPlus && t.demandeur_id !== user.id) return envoyerJSON(res, 403, { erreur: 'Accès refusé.' });
    const { contenu, interne } = await lireCorpsJSON(req);
    if (!contenu || !contenu.trim()) return envoyerJSON(res, 400, { erreur: 'Commentaire vide.' });
    const estInterne = estAgentOuPlus && !!interne ? 1 : 0;
    db.prepare('INSERT INTO comments (ticket_id, auteur_id, contenu, interne) VALUES (?, ?, ?, ?)').run(ticketId, user.id, contenu.trim(), estInterne);
    ajouterHistorique(ticketId, user.id, 'commentaire', estInterne ? 'Note interne ajoutée' : 'Commentaire ajouté');
    if (!estInterne && user.id !== t.demandeur_id) ajouterNotification(t.demandeur_id, ticketId, `Nouveau commentaire sur votre demande ${t.numero}.`);
    const t2 = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
    return envoyerJSON(res, 200, serialiserTicket(t2, true));
  }

  // ---- PIÈCES JOINTES (upload en base64 JSON — pas de multipart, zéro dépendance) ----
  const matchAttach = urlPath.match(/^\/api\/tickets\/(\d+)\/attachment$/);
  if (matchAttach && methode === 'POST') {
    const ticketId = Number(matchAttach[1]);
    const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
    if (!t) return envoyerJSON(res, 404, { erreur: 'Demande introuvable.' });
    if (!estAgentOuPlus && t.demandeur_id !== user.id) return envoyerJSON(res, 403, { erreur: 'Accès refusé.' });
    const { nom_fichier, mime, data_base64 } = await lireCorpsJSON(req);
    if (!nom_fichier || !data_base64) return envoyerJSON(res, 400, { erreur: 'Fichier manquant.' });
    const ext = path.extname(nom_fichier).toLowerCase();
    if (!EXTENSIONS_AUTORISEES.includes(ext)) return envoyerJSON(res, 400, { erreur: `Extension non autorisée : ${ext}` });
    const buffer = Buffer.from(data_base64, 'base64');
    if (buffer.length > MAX_FICHIER_OCTETS) return envoyerJSON(res, 400, { erreur: 'Fichier trop volumineux (max 15 Mo).' });
    const { filename } = nomFichierSecurise(nom_fichier);
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
    db.prepare(`
      INSERT INTO attachments (ticket_id, filename, original_name, mime, size, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(ticketId, filename, nom_fichier, mime || null, buffer.length, user.id);
    ajouterHistorique(ticketId, user.id, 'piece_jointe', `Pièce jointe ajoutée : ${nom_fichier}`);
    const t2 = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
    return envoyerJSON(res, 200, serialiserTicket(t2, true));
  }

  const matchDownload = urlPath.match(/^\/api\/tickets\/(\d+)\/attachments\/(\d+)$/);
  if (matchDownload && methode === 'GET') {
    const ticketId = Number(matchDownload[1]);
    const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
    if (!t) return envoyerJSON(res, 404, { erreur: 'Demande introuvable.' });
    if (!estAgentOuPlus && t.demandeur_id !== user.id) return envoyerJSON(res, 403, { erreur: 'Accès refusé.' });
    const piece = db.prepare('SELECT * FROM attachments WHERE id = ? AND ticket_id = ?').get(Number(matchDownload[2]), ticketId);
    if (!piece) return envoyerJSON(res, 404, { erreur: 'Fichier introuvable.' });
    const filePath = path.join(UPLOADS_DIR, piece.filename);
    if (!fs.existsSync(filePath)) return envoyerJSON(res, 404, { erreur: 'Fichier introuvable sur le disque.' });
    res.writeHead(200, {
      'Content-Type': piece.mime || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${piece.original_name.replace(/"/g, '')}"`,
    });
    return fs.createReadStream(filePath).pipe(res);
  }

  // ---- NOTIFICATIONS ----
  if (urlPath === '/api/notifications' && methode === 'GET') {
    const rows = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(user.id);
    return envoyerJSON(res, 200, rows);
  }
  const matchNotifRead = urlPath.match(/^\/api\/notifications\/(\d+)\/lu$/);
  if (matchNotifRead && methode === 'POST') {
    db.prepare('UPDATE notifications SET lu = 1 WHERE id = ? AND user_id = ?').run(Number(matchNotifRead[1]), user.id);
    return envoyerJSON(res, 200, { ok: true });
  }

  // ---- TABLEAU DE BORD ADMIN ----
  if (urlPath === '/api/admin/dashboard' && methode === 'GET') {
    if (!estAgentOuPlus) return envoyerJSON(res, 403, { erreur: 'Accès refusé.' });
    const compte = (sql, ...p) => db.prepare(sql).get(...p).n;
    const aujourdhui = new Date().toISOString().slice(0, 10);
    const stats = {
      total: compte('SELECT COUNT(*) n FROM tickets'),
      a_traiter: compte(`SELECT COUNT(*) n FROM tickets WHERE statut = 'en_attente'`),
      urgentes: compte(`SELECT COUNT(*) n FROM tickets WHERE statut = 'en_attente' AND priorite = 'urgente'`),
      en_cours: compte(`SELECT COUNT(*) n FROM tickets WHERE statut = 'en_cours'`),
      en_pause: compte(`SELECT COUNT(*) n FROM tickets WHERE statut = 'en_pause'`),
      terminees: compte(`SELECT COUNT(*) n FROM tickets WHERE statut = 'termine'`),
      terminees_aujourdhui: compte(`SELECT COUNT(*) n FROM tickets WHERE statut = 'termine' AND date(termine_at) = ?`, aujourdhui),
      en_retard: compte(`SELECT COUNT(*) n FROM tickets WHERE statut NOT IN ('termine','annule') AND date_limite IS NOT NULL AND date(date_limite) < date('now')`),
    };
    const parCategorie = db.prepare(`SELECT COALESCE(categorie, 'Non classé') AS categorie, COUNT(*) AS n FROM tickets GROUP BY categorie ORDER BY n DESC`).all();
    const parJour = db.prepare(`SELECT date(created_at) AS jour, COUNT(*) AS n FROM tickets GROUP BY jour ORDER BY jour DESC LIMIT 14`).all();
    return envoyerJSON(res, 200, { stats, par_categorie: parCategorie, par_jour: parJour });
  }

  // ---- GESTION DES UTILISATEURS (admin) ----
  if (urlPath === '/api/admin/users' && methode === 'GET') {
    if (!estAdmin) return envoyerJSON(res, 403, { erreur: 'Accès refusé.' });
    return envoyerJSON(res, 200, db.prepare('SELECT id, nom, identifiant, role, fonction, service, email, actif, created_at FROM users ORDER BY id').all());
  }
  const matchUserRole = urlPath.match(/^\/api\/admin\/users\/(\d+)\/role$/);
  if (matchUserRole && methode === 'POST') {
    if (!estAdmin) return envoyerJSON(res, 403, { erreur: 'Accès refusé.' });
    const { role } = await lireCorpsJSON(req);
    if (!['demandeur', 'agent', 'admin', 'superadmin'].includes(role)) return envoyerJSON(res, 400, { erreur: 'Rôle invalide.' });
    if (role === 'superadmin' && user.role !== 'superadmin') return envoyerJSON(res, 403, { erreur: 'Seul un super administrateur peut promouvoir un super administrateur.' });
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, Number(matchUserRole[1]));
    auditLog(user.id, 'changement_role_utilisateur', `user #${matchUserRole[1]} -> ${role}`);
    return envoyerJSON(res, 200, { ok: true });
  }
  const matchUserActif = urlPath.match(/^\/api\/admin\/users\/(\d+)\/actif$/);
  if (matchUserActif && methode === 'POST') {
    if (!estAdmin) return envoyerJSON(res, 403, { erreur: 'Accès refusé.' });
    const { actif } = await lireCorpsJSON(req);
    db.prepare('UPDATE users SET actif = ? WHERE id = ?').run(actif ? 1 : 0, Number(matchUserActif[1]));
    auditLog(user.id, 'activation_utilisateur', `user #${matchUserActif[1]} -> ${actif ? 'actif' : 'désactivé'}`);
    return envoyerJSON(res, 200, { ok: true });
  }

  return envoyerJSON(res, 404, { erreur: 'Route API inconnue.' });
}

const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];
  try {
    if (urlPath.startsWith('/api/')) {
      await handleAPI(req, res, urlPath, req.method);
    } else {
      servirStatique(req, res);
    }
  } catch (e) {
    console.error(e);
    envoyerJSON(res, 500, { erreur: 'Erreur serveur interne.', detail: String(e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`\n✅ Application de gestion des demandes de l'école démarrée`);
  console.log(`   http://localhost:${PORT}\n`);
});
