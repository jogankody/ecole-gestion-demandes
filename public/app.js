// app.js — Front-end SPA (vanilla JS, aucune dépendance)
'use strict';

const app = document.getElementById('app');
let ETAT = { user: null, categories: [], vue: 'chargement' };

// --------- Helpers API ---------
async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* corps vide (ex: téléchargement) */ }
  if (!res.ok) throw new Error((data && data.erreur) || `Erreur ${res.status}`);
  return data;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso.replace(' ', 'T') + (iso.includes('Z') ? '' : ''));
  if (isNaN(d)) return iso;
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function esc(s) {
  const div = document.createElement('div');
  div.textContent = s == null ? '' : String(s);
  return div.innerHTML;
}

function badgePriorite(p) {
  const labels = { urgente: '🔴 Urgente', haute: '🟠 Haute', normale: '🔵 Normale', faible: '⚪ Faible' };
  return `<span class="badge badge-${p}">${labels[p] || p}</span>`;
}
function badgeStatut(s) {
  const labels = { en_attente: '🔵 En attente', en_cours: '🟡 En cours', en_pause: '🟣 En pause', termine: '🟢 Terminé', annule: '⚫ Annulé' };
  return `<span class="badge badge-${s}">${labels[s] || s}</span>`;
}

// --------- Routage simple ---------
window.addEventListener('hashchange', rendre);

async function demarrer() {
  try {
    ETAT.user = await api('/api/me');
    ETAT.categories = await api('/api/categories');
  } catch (e) {
    ETAT.user = null;
  }
  rendre();
}

function naviguer(hash) { window.location.hash = hash; }

async function rendre() {
  if (!ETAT.user) return rendreConnexion();
  const hash = window.location.hash.slice(1) || 'dashboard';
  const [vue, param] = hash.split('/');
  app.innerHTML = squelette();
  const contenu = document.getElementById('contenu');
  marquerLienActif(vue);
  try {
    if (vue === 'dashboard') await vueDashboard(contenu);
    else if (vue === 'nouvelle-demande') await vueNouvelleDemande(contenu);
    else if (vue === 'mes-demandes') await vueMesDemandes(contenu);
    else if (vue === 'ticket') await vueTicketDetail(contenu, param);
    else if (vue === 'file-attente') await vueFileAttente(contenu);
    else if (vue === 'notifications') await vueNotifications(contenu);
    else if (vue === 'utilisateurs') await vueUtilisateurs(contenu);
    else await vueDashboard(contenu);
  } catch (e) {
    contenu.innerHTML = `<div class="alerte alerte-erreur">Erreur : ${esc(e.message)}</div>`;
  }
  chargerCompteurNotifs();
}

function estAgentOuPlus() { return ETAT.user && ['agent', 'admin', 'superadmin'].includes(ETAT.user.role); }
function estAdmin() { return ETAT.user && ['admin', 'superadmin'].includes(ETAT.user.role); }

function marquerLienActif(vue) {
  document.querySelectorAll('.sidebar a').forEach(a => a.classList.toggle('actif', a.dataset.vue === vue));
}

function squelette() {
  const liensBase = [
    ['dashboard', '🏠', 'Tableau de bord'],
    ['nouvelle-demande', '➕', 'Nouvelle demande'],
    ['mes-demandes', '📋', estAgentOuPlus() ? 'Toutes les demandes' : 'Mes demandes'],
    ['notifications', '🔔', 'Notifications'],
  ];
  const liensAgent = estAgentOuPlus() ? [['file-attente', '📊', "File d'attente"]] : [];
  const liensAdmin = estAdmin() ? [['utilisateurs', '👤', 'Utilisateurs']] : [];
  const liens = [...liensBase.slice(0, 3), ...liensAgent, liensBase[3], ...liensAdmin];
  return `
    <div class="topbar">
      <div class="brand">🏫 Gestion des demandes — École</div>
      <div class="user-info">
        <span>${esc(ETAT.user.nom)}</span>
        <span class="badge-role">${esc(ETAT.user.role)}</span>
        <button class="btn btn-sm" onclick="deconnexion()">Déconnexion</button>
      </div>
    </div>
    <div class="layout">
      <div class="sidebar">
        ${liens.map(([v, icon, label]) => `<a href="#${v}" data-vue="${v}">${icon} ${label}</a>`).join('')}
      </div>
      <div class="main" id="contenu"></div>
    </div>`;
}

async function chargerCompteurNotifs() {
  try {
    const notifs = await api('/api/notifications');
    const nonLues = notifs.filter(n => !n.lu).length;
    // Optionnel : pourrait afficher un badge sur le lien Notifications
  } catch (e) {}
}

async function deconnexion() {
  await api('/api/auth/logout', { method: 'POST' });
  ETAT.user = null;
  window.location.hash = '';
  rendre();
}

// --------- Connexion / Inscription ---------
function rendreConnexion() {
  app.innerHTML = `
    <div class="page-connexion">
      <div class="carte-connexion">
        <h1>🏫 Gestion des demandes</h1>
        <p class="sous-titre">Établissement scolaire — Espace connexion</p>
        <div id="msg-connexion"></div>
        <div id="form-zone"></div>
      </div>
    </div>`;
  afficherFormLogin();
}

function afficherFormLogin() {
  document.getElementById('form-zone').innerHTML = `
    <form id="form-login">
      <div class="form-groupe"><label>Identifiant</label><input name="identifiant" required autofocus></div>
      <div class="form-groupe"><label>Mot de passe</label><input type="password" name="mot_de_passe" required></div>
      <button class="btn btn-primaire" style="width:100%" type="submit">Se connecter</button>
    </form>
    <p class="muted" style="text-align:center;margin-top:14px;">Pas encore de compte ? <a href="#" onclick="afficherFormInscription();return false;">Créer un compte demandeur</a></p>
    <div class="comptes-demo">
      <strong>Comptes de démonstration :</strong><br>
      admin / admin123 · agent / agent123 · kouassi / demo1234
    </div>`;
  document.getElementById('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      ETAT.user = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(f)) });
      ETAT.categories = await api('/api/categories');
      window.location.hash = 'dashboard';
      rendre();
    } catch (err) {
      document.getElementById('msg-connexion').innerHTML = `<div class="alerte alerte-erreur">${esc(err.message)}</div>`;
    }
  });
}

function afficherFormInscription() {
  document.getElementById('form-zone').innerHTML = `
    <form id="form-inscription">
      <div class="form-groupe"><label>Nom complet</label><input name="nom" required></div>
      <div class="form-groupe"><label>Identifiant</label><input name="identifiant" required></div>
      <div class="form-groupe"><label>Mot de passe</label><input type="password" name="mot_de_passe" required minlength="4"></div>
      <div class="form-groupe"><label>Fonction</label><input name="fonction"></div>
      <div class="form-groupe"><label>Service</label><input name="service"></div>
      <div class="form-groupe"><label>E-mail</label><input type="email" name="email"></div>
      <button class="btn btn-primaire" style="width:100%" type="submit">Créer mon compte</button>
    </form>
    <p class="muted" style="text-align:center;margin-top:14px;"><a href="#" onclick="afficherFormLogin();return false;">← Retour à la connexion</a></p>`;
  document.getElementById('form-inscription').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      ETAT.user = await api('/api/auth/register', { method: 'POST', body: JSON.stringify(Object.fromEntries(f)) });
      ETAT.categories = await api('/api/categories');
      window.location.hash = 'dashboard';
      rendre();
    } catch (err) {
      document.getElementById('msg-connexion').innerHTML = `<div class="alerte alerte-erreur">${esc(err.message)}</div>`;
    }
  });
}

// --------- Dashboard ---------
async function vueDashboard(el) {
  if (estAgentOuPlus()) {
    const data = await api('/api/admin/dashboard');
    const s = data.stats;
    el.innerHTML = `
      <h1>Tableau de bord</h1>
      <p class="souspage-titre">Vue d'ensemble de l'activité</p>
      <div class="grid-cards">
        <div class="carte-stat"><div class="valeur">📥 ${s.a_traiter}</div><div class="label">À traiter</div></div>
        <div class="carte-stat"><div class="valeur">🔴 ${s.urgentes}</div><div class="label">Urgentes</div></div>
        <div class="carte-stat"><div class="valeur">🟡 ${s.en_cours}</div><div class="label">En cours</div></div>
        <div class="carte-stat"><div class="valeur">🟣 ${s.en_pause}</div><div class="label">En pause</div></div>
        <div class="carte-stat"><div class="valeur">✅ ${s.terminees_aujourdhui}</div><div class="label">Terminées aujourd'hui</div></div>
        <div class="carte-stat"><div class="valeur">🔴 ${s.en_retard}</div><div class="label">En retard</div></div>
      </div>
      <div class="carte">
        <h3 style="margin-top:0">Demandes par catégorie</h3>
        <div class="table-wrap"><table>
          <tr><th>Catégorie</th><th>Nombre</th></tr>
          ${data.par_categorie.map(c => `<tr><td>${esc(c.categorie)}</td><td>${c.n}</td></tr>`).join('')}
        </table></div>
      </div>
      <a class="btn btn-primaire" href="#file-attente">📊 Aller à la file d'attente</a>`;
  } else {
    const tickets = await api('/api/tickets');
    const enAttente = tickets.filter(t => t.statut === 'en_attente').length;
    const enCours = tickets.filter(t => t.statut === 'en_cours').length;
    const termines = tickets.filter(t => t.statut === 'termine').length;
    el.innerHTML = `
      <h1>Bonjour, ${esc(ETAT.user.nom)} 👋</h1>
      <p class="souspage-titre">Voici un résumé de vos demandes</p>
      <div class="grid-cards">
        <div class="carte-stat"><div class="valeur">${tickets.length}</div><div class="label">Total de vos demandes</div></div>
        <div class="carte-stat"><div class="valeur">${enAttente}</div><div class="label">En attente</div></div>
        <div class="carte-stat"><div class="valeur">${enCours}</div><div class="label">En cours</div></div>
        <div class="carte-stat"><div class="valeur">${termines}</div><div class="label">Terminées</div></div>
      </div>
      <a class="btn btn-primaire" href="#nouvelle-demande">➕ Nouvelle demande</a>
      <div class="carte" style="margin-top:20px">
        <h3 style="margin-top:0">Demandes récentes</h3>
        ${tableauTickets(tickets.slice(0, 5))}
      </div>`;
  }
}

// --------- Nouvelle demande ---------
let FICHIERS_EN_ATTENTE = [];

async function vueNouvelleDemande(el) {
  FICHIERS_EN_ATTENTE = [];
  el.innerHTML = `
    <h1>📝 Nouvelle demande de travail</h1>
    <p class="souspage-titre">Décrivez votre besoin, elle sera aussitôt placée dans la file de traitement</p>
    <div id="msg-form"></div>
    <form id="form-demande" class="carte">
      <div class="form-row">
        <div class="form-groupe"><label>Catégorie</label>
          <select name="categorie">${ETAT.categories.map(c => `<option>${esc(c)}</option>`).join('')}</select>
        </div>
        <div class="form-groupe"><label>Priorité</label>
          <select name="priorite">
            <option value="normale">🔵 Normale</option>
            <option value="faible">⚪ Faible</option>
            <option value="haute">🟠 Haute</option>
            <option value="urgente">🔴 Urgente</option>
          </select>
        </div>
      </div>
      <div class="form-groupe"><label>Objet *</label><input name="objet" required placeholder="Ex : Imprimer les listes des élèves"></div>
      <div class="form-groupe"><label>Description détaillée</label><textarea name="description" rows="4" placeholder="Détails utiles pour traiter votre demande"></textarea></div>
      <div class="form-row">
        <div class="form-groupe"><label>Date souhaitée</label><input type="date" name="date_souhaitee"></div>
        <div class="form-groupe"><label>Date limite</label><input type="date" name="date_limite"></div>
      </div>
      <div class="form-groupe"><label>Commentaires complémentaires</label><textarea name="commentaire" rows="2"></textarea></div>
      <div class="form-groupe">
        <label>Pièces jointes</label>
        <div class="zone-depot" onclick="document.getElementById('input-fichiers').click()">
          📎 Glissez-déposez vos fichiers ici ou cliquez pour en ajouter<br>
          <span class="muted">PDF, Word, Excel, CSV, images, ZIP — 15 Mo max par fichier</span>
        </div>
        <input type="file" id="input-fichiers" multiple hidden accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.webp,.zip">
        <div class="liste-fichiers" id="liste-fichiers"></div>
      </div>
      <button class="btn btn-primaire" type="submit">Envoyer la demande</button>
    </form>`;

  document.getElementById('input-fichiers').addEventListener('change', (e) => {
    for (const f of e.target.files) FICHIERS_EN_ATTENTE.push(f);
    rafraichirListeFichiers();
  });

  document.getElementById('form-demande').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const payload = Object.fromEntries(f);
    try {
      const ticket = await api('/api/tickets', { method: 'POST', body: JSON.stringify(payload) });
      for (const fichier of FICHIERS_EN_ATTENTE) {
        const b64 = await fichierEnBase64(fichier);
        await api(`/api/tickets/${ticket.id}/attachment`, {
          method: 'POST',
          body: JSON.stringify({ nom_fichier: fichier.name, mime: fichier.type, data_base64: b64 }),
        });
      }
      naviguer(`ticket/${ticket.id}`);
    } catch (err) {
      document.getElementById('msg-form').innerHTML = `<div class="alerte alerte-erreur">${esc(err.message)}</div>`;
    }
  });
}

function rafraichirListeFichiers() {
  const zone = document.getElementById('liste-fichiers');
  zone.innerHTML = FICHIERS_EN_ATTENTE.map((f, i) => `
    <div class="fichier-item">
      <span>📄 ${esc(f.name)} (${(f.size / 1024).toFixed(0)} Ko)</span>
      <button type="button" class="btn btn-sm" onclick="retirerFichier(${i})">✕</button>
    </div>`).join('');
}
function retirerFichier(i) { FICHIERS_EN_ATTENTE.splice(i, 1); rafraichirListeFichiers(); }
function fichierEnBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// --------- Liste des demandes ---------
function tableauTickets(tickets, colonnePosition = true) {
  if (tickets.length === 0) return '<p class="muted">Aucune demande.</p>';
  return `<div class="table-wrap"><table>
    <tr><th>N°</th><th>Objet</th><th>Date</th><th>Priorité</th>${colonnePosition ? '<th>Position</th>' : ''}<th>Statut</th></tr>
    ${tickets.map(t => `
      <tr style="cursor:pointer" onclick="naviguer('ticket/${t.id}')">
        <td>${esc(t.numero)}</td>
        <td>${esc(t.objet)}</td>
        <td>${fmtDate(t.created_at)}</td>
        <td>${badgePriorite(t.priorite)}</td>
        ${colonnePosition ? `<td>${t.statut === 'en_attente' ? t.position : '—'}</td>` : ''}
        <td>${badgeStatut(t.statut)}</td>
      </tr>`).join('')}
  </table></div>`;
}

async function vueMesDemandes(el) {
  el.innerHTML = `
    <h1>${estAgentOuPlus() ? 'Toutes les demandes' : 'Mes demandes'}</h1>
    <div class="barre-outils">
      <input id="recherche" placeholder="🔍 Rechercher (numéro, objet...)">
      <select id="filtre-statut">
        <option value="">Tous statuts</option>
        <option value="en_attente">En attente</option>
        <option value="en_cours">En cours</option>
        <option value="en_pause">En pause</option>
        <option value="termine">Terminé</option>
        <option value="annule">Annulé</option>
      </select>
      <select id="filtre-priorite">
        <option value="">Toutes priorités</option>
        <option value="urgente">Urgente</option>
        <option value="haute">Haute</option>
        <option value="normale">Normale</option>
        <option value="faible">Faible</option>
      </select>
      <button class="btn" onclick="rechercherTickets()">Filtrer</button>
    </div>
    <div id="resultats-tickets" class="carte"></div>`;
  await rechercherTickets();
}

async function rechercherTickets() {
  const q = document.getElementById('recherche').value.trim();
  const statut = document.getElementById('filtre-statut').value;
  const priorite = document.getElementById('filtre-priorite').value;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (statut) params.set('statut', statut);
  if (priorite) params.set('priorite', priorite);
  const tickets = await api(`/api/tickets?${params}`);
  document.getElementById('resultats-tickets').innerHTML = tableauTickets(tickets);
}

// --------- File d'attente (vue agent/admin) ---------
async function vueFileAttente(el) {
  const tickets = await api('/api/tickets?tri=file');
  el.innerHTML = `
    <h1>📋 File d'attente</h1>
    <p class="souspage-titre">Ordre de traitement intelligent (priorité, puis ancienneté)</p>
    <div class="table-wrap carte"><table>
      <tr><th>Pos.</th><th>Ticket</th><th>Demandeur</th><th>Objet</th><th>Priorité</th><th>Âge</th><th>Statut</th><th>Actions</th></tr>
      ${tickets.map(t => `
        <tr>
          <td>${t.position || '—'}</td>
          <td><a href="#ticket/${t.id}">${esc(t.numero)}</a></td>
          <td>${esc(t.demandeur ? t.demandeur.nom : '')}</td>
          <td>${esc(t.objet)}</td>
          <td>${badgePriorite(t.priorite)}</td>
          <td class="muted">${age(t.created_at)}</td>
          <td>${badgeStatut(t.statut)}</td>
          <td>${actionsRapides(t)}</td>
        </tr>`).join('')}
    </table></div>`;
}

function age(iso) {
  const diffMs = Date.now() - new Date(iso.replace(' ', 'T'));
  const h = Math.floor(diffMs / 3600000);
  if (h < 1) return `${Math.floor(diffMs / 60000)} min`;
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} j`;
}

function actionsRapides(t) {
  const boutons = [];
  if (t.statut === 'en_attente') boutons.push(`<button class="btn btn-sm btn-primaire" onclick="actionTicketRapide(${t.id},'prendre_en_charge')">Prendre en charge</button>`);
  if (t.statut === 'en_cours') boutons.push(`<button class="btn btn-sm" onclick="actionTicketRapide(${t.id},'terminer')">Terminer</button>`);
  return boutons.join(' ');
}

async function actionTicketRapide(id, action) {
  try { await api(`/api/tickets/${id}/action`, { method: 'POST', body: JSON.stringify({ action }) }); rendre(); }
  catch (e) { alert(e.message); }
}

// --------- Détail d'un ticket ---------
async function vueTicketDetail(el, id) {
  const t = await api(`/api/tickets/${id}`);
  const positionHTML = t.statut === 'en_attente' ? `
    <div class="carte-position">
      <div class="titre">📍 Votre position</div>
      <div class="chiffre">${t.position}</div>
      <div class="sous">${t.demandes_devant} demande(s) devant vous · ${t.demandes_apres} après vous</div>
    </div>` : '';

  const etapes = ['en_attente', 'en_cours', 'termine'];
  const etapeCourante = t.statut === 'en_pause' ? 'en_cours' : t.statut === 'annule' ? null : t.statut;
  const workflowHTML = etapeCourante ? `
    <div class="carte muted" style="text-align:center">
      ${etapes.map(e => `<span style="font-weight:${e === etapeCourante ? '700' : '400'}">${e === 'en_attente' ? '🟢 Enregistrée' : e === 'en_cours' ? (t.statut === 'en_pause' ? '🟣 En pause' : '🟡 En cours') : '⚪ Terminée'}</span>`).join(' &nbsp;→&nbsp; ')}
    </div>` : `<div class="alerte alerte-info">⚫ Cette demande a été annulée.</div>`;

  el.innerHTML = `
    <div class="flex-entre">
      <div>
        <h1>${esc(t.numero)}</h1>
        <p class="souspage-titre">${esc(t.objet)}</p>
      </div>
      ${badgeStatut(t.statut)}
    </div>
    ${positionHTML}
    ${workflowHTML}
    ${t.echeance_info ? `<div class="alerte alerte-info">${t.echeance_info.label}</div>` : ''}

    <div class="carte">
      <h3 style="margin-top:0">Détails</h3>
      <p><strong>Demandeur :</strong> ${esc(t.demandeur.nom)} (${esc(t.demandeur.service || '—')})</p>
      <p><strong>Catégorie :</strong> ${esc(t.categorie || '—')} &nbsp;|&nbsp; <strong>Priorité :</strong> ${badgePriorite(t.priorite)}</p>
      <p><strong>Créée le :</strong> ${fmtDate(t.created_at)}</p>
      ${t.agent ? `<p><strong>Agent en charge :</strong> ${esc(t.agent.nom)}</p>` : ''}
      <p><strong>Description :</strong><br>${esc(t.description || '—')}</p>
      ${t.commentaire ? `<p><strong>Commentaire initial :</strong> ${esc(t.commentaire)}</p>` : ''}
    </div>

    ${estAgentOuPlus() ? `
    <div class="carte">
      <h3 style="margin-top:0">Actions</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${t.statut === 'en_attente' ? `<button class="btn btn-primaire" onclick="actionTicket(${t.id},'prendre_en_charge')">Prendre en charge</button>` : ''}
        ${t.statut === 'en_cours' ? `<button class="btn" onclick="actionTicket(${t.id},'mettre_en_attente')">Mettre en pause</button>` : ''}
        ${t.statut === 'en_pause' ? `<button class="btn" onclick="actionTicket(${t.id},'reprendre')">Reprendre</button>` : ''}
        ${['en_cours', 'en_pause'].includes(t.statut) ? `<button class="btn btn-primaire" onclick="actionTicket(${t.id},'terminer')">Terminer</button>` : ''}
        ${!['termine', 'annule'].includes(t.statut) ? `<button class="btn btn-danger" onclick="actionTicket(${t.id},'annuler')">Annuler</button>` : ''}
      </div>
      <div style="margin-top:14px">
        <label class="muted">Modifier la priorité</label><br>
        <select id="select-priorite" style="margin-top:6px;padding:8px;border-radius:8px;border:1px solid var(--bordure)">
          ${['urgente', 'haute', 'normale', 'faible'].map(p => `<option value="${p}" ${p === t.priorite ? 'selected' : ''}>${p}</option>`).join('')}
        </select>
        <button class="btn btn-sm" onclick="changerPriorite(${t.id})">Appliquer</button>
      </div>
    </div>` : ''}

    <div class="carte">
      <h3 style="margin-top:0">Pièces jointes</h3>
      ${t.pieces_jointes.length === 0 ? '<p class="muted">Aucune pièce jointe.</p>' :
        t.pieces_jointes.map(p => `<div class="fichier-item"><span>📄 ${esc(p.original_name)} (${(p.size / 1024).toFixed(0)} Ko)</span><a class="btn btn-sm" href="/api/tickets/${t.id}/attachments/${p.id}">Télécharger</a></div>`).join('')}
      <div style="margin-top:10px">
        <input type="file" id="input-ajout-fichier" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.webp,.zip">
        <button class="btn btn-sm" onclick="ajouterFichierTicket(${t.id})">Ajouter</button>
      </div>
    </div>

    <div class="carte">
      <h3 style="margin-top:0">Commentaires</h3>
      ${t.commentaires.map(c => `
        <div style="padding:8px 0;border-bottom:1px solid var(--bordure)">
          <strong>${esc(c.auteur_nom)}</strong> ${c.interne ? '<span class="badge badge-en_pause">Note interne</span>' : ''}
          <span class="muted"> — ${fmtDate(c.created_at)}</span>
          <p style="margin:4px 0 0">${esc(c.contenu)}</p>
        </div>`).join('') || '<p class="muted">Aucun commentaire.</p>'}
      <form id="form-commentaire" style="margin-top:12px">
        <textarea name="contenu" rows="2" placeholder="Ajouter un commentaire..." required style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--bordure)"></textarea>
        ${estAgentOuPlus() ? `<label class="muted"><input type="checkbox" name="interne"> Note interne (non visible par le demandeur)</label><br>` : ''}
        <button class="btn btn-sm" style="margin-top:8px" type="submit">Envoyer</button>
      </form>
    </div>

    <div class="carte">
      <h3 style="margin-top:0">Historique</h3>
      <ul class="timeline">
        ${t.historique.map(h => `<li><span class="heure">${fmtDate(h.created_at)}</span><span>${esc(h.details || h.action)} ${h.utilisateur_nom ? `— <em>${esc(h.utilisateur_nom)}</em>` : ''}</span></li>`).join('')}
      </ul>
    </div>`;

  document.getElementById('form-commentaire').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await api(`/api/tickets/${id}/comment`, { method: 'POST', body: JSON.stringify({ contenu: f.get('contenu'), interne: f.get('interne') === 'on' }) });
    vueTicketDetail(el, id);
  });
}

async function actionTicket(id, action) {
  let motif = null;
  if (action === 'annuler') motif = prompt('Motif de l\'annulation (optionnel) :') || null;
  try {
    await api(`/api/tickets/${id}/action`, { method: 'POST', body: JSON.stringify({ action, motif }) });
    naviguer(`ticket/${id}`);
    rendre();
  } catch (e) { alert(e.message); }
}
async function changerPriorite(id) {
  const priorite = document.getElementById('select-priorite').value;
  const motif = prompt('Motif du changement de priorité (recommandé) :') || null;
  try { await api(`/api/tickets/${id}/priorite`, { method: 'POST', body: JSON.stringify({ priorite, motif }) }); rendre(); }
  catch (e) { alert(e.message); }
}
async function ajouterFichierTicket(id) {
  const input = document.getElementById('input-ajout-fichier');
  if (!input.files[0]) return;
  const fichier = input.files[0];
  const b64 = await fichierEnBase64(fichier);
  try {
    await api(`/api/tickets/${id}/attachment`, { method: 'POST', body: JSON.stringify({ nom_fichier: fichier.name, mime: fichier.type, data_base64: b64 }) });
    rendre();
  } catch (e) { alert(e.message); }
}

// --------- Notifications ---------
async function vueNotifications(el) {
  const notifs = await api('/api/notifications');
  el.innerHTML = `
    <h1>🔔 Notifications</h1>
    <div class="carte">
      ${notifs.length === 0 ? '<p class="muted">Aucune notification.</p>' : notifs.map(n => `
        <div class="notif-item ${n.lu ? '' : 'non-lue'}" onclick="marquerNotifLue(${n.id}, ${n.ticket_id})" style="cursor:pointer">
          ${esc(n.message)}<br><span class="muted">${fmtDate(n.created_at)}</span>
        </div>`).join('')}
    </div>`;
}
async function marquerNotifLue(id, ticketId) {
  await api(`/api/notifications/${id}/lu`, { method: 'POST' });
  if (ticketId) naviguer(`ticket/${ticketId}`); else rendre();
}

// --------- Gestion des utilisateurs (admin) ---------
async function vueUtilisateurs(el) {
  const users = await api('/api/admin/users');
  el.innerHTML = `
    <h1>👤 Utilisateurs</h1>
    <div class="table-wrap carte"><table>
      <tr><th>Nom</th><th>Identifiant</th><th>Rôle</th><th>Service</th><th>Actif</th><th>Actions</th></tr>
      ${users.map(u => `
        <tr>
          <td>${esc(u.nom)}</td><td>${esc(u.identifiant)}</td>
          <td>
            <select onchange="changerRole(${u.id}, this.value)">
              ${['demandeur', 'agent', 'admin', 'superadmin'].map(r => `<option value="${r}" ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}
            </select>
          </td>
          <td>${esc(u.service || '—')}</td>
          <td>${u.actif ? '✅' : '⛔'}</td>
          <td><button class="btn btn-sm" onclick="basculerActif(${u.id}, ${u.actif ? 0 : 1})">${u.actif ? 'Désactiver' : 'Activer'}</button></td>
        </tr>`).join('')}
    </table></div>`;
}
async function changerRole(id, role) { try { await api(`/api/admin/users/${id}/role`, { method: 'POST', body: JSON.stringify({ role }) }); } catch (e) { alert(e.message); } }
async function basculerActif(id, actif) { await api(`/api/admin/users/${id}/actif`, { method: 'POST', body: JSON.stringify({ actif }) }); rendre(); }

demarrer();
