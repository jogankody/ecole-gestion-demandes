# Gestion des demandes et travaux d'une école

Application de gestion des demandes/tickets avec file d'attente intelligente, construite à
partir du cahier des charges fourni. **Zéro dépendance npm** : Node.js pur (backend HTTP,
base de données SQLite native `node:sqlite`) + HTML/CSS/JS vanilla (frontend, aucun framework,
aucun build).

## Installation et démarrage

Prérequis : **Node.js 22 ou supérieur** (module `node:sqlite` requis).

```bash
node server.js
```

Puis ouvrir : http://localhost:3000

La base de données SQLite est créée automatiquement au premier démarrage dans `data/ecole.db`,
avec 4 comptes de démonstration :

| Identifiant | Mot de passe    | Rôle        |
|-------------|-----------------|-------------|
| superadmin  | superadmin123   | superadmin  |
| admin       | admin123        | admin       |
| agent       | agent123        | agent       |
| kouassi     | demo1234        | demandeur   |

Un formulaire d'inscription permet aussi de créer de nouveaux comptes "demandeur".

Pour repartir d'une base vierge : supprimer `data/ecole.db` puis relancer le serveur.

## Ce qui est implémenté (cœur du cahier des charges)

- **File d'attente dynamique** (section 3-5, 33) : la position n'est jamais stockée, elle est
  recalculée à chaque lecture à partir des tickets `en_attente`, triés par priorité puis
  ancienneté. Une demande urgente passe bien devant les autres, et le changement est tracé
  dans l'historique avec motif.
- Numérotation unique des tickets `DEM-AAAA-NNNNN` (séquence annuelle).
- Formulaire de création de demande avec pièces jointes (glisser-déposer, plusieurs fichiers,
  contrôle d'extension et de taille).
- Espace personnel du demandeur : tableau de bord, mes demandes, suivi détaillé d'un ticket
  (carte de position, workflow visuel, échéances).
- Tableau de bord agent/admin, file de travail triée, actions de workflow (prendre en charge,
  mettre en pause, reprendre, terminer, annuler, changer la priorité).
- Historique immuable par ticket (qui, quoi, quand, pourquoi).
- Commentaires (publics et notes internes réservées aux agents/admins).
- Notifications en base, consultables dans l'application.
- Recherche et filtres (numéro, objet, statut, priorité).
- Rôles : demandeur / agent / admin / superadmin, avec permissions différenciées.
- Gestion des utilisateurs (changement de rôle, activation/désactivation) pour les admins.
- Sécurité de base : mots de passe hachés (scrypt, jamais en clair), sessions HttpOnly,
  contrôle d'accès par rôle sur chaque route API, validation des extensions de fichiers,
  noms de fichiers assainis (anti path-traversal), requêtes SQL paramétrées.
- Journal d'audit des actions sensibles (connexion, création/modification de ticket,
  changements de rôle).
- Interface entièrement en français, responsive (mobile/tablette/ordinateur).

## Ce qui est volontairement simplifié ou non implémenté

Le cahier des charges original (39 sections) décrit un système à l'échelle d'une vraie
entreprise SaaS. Pour livrer une base **réellement fonctionnelle** plutôt qu'une coquille vide,
les points suivants ont été laissés de côté ou simplifiés — ce sont les prochaines étapes
naturelles :

- **Temps réel (WebSocket/SSE)** : la position se met à jour au rechargement de la page, pas
  automatiquement en direct. Ajout possible avec le module `node:http` + un simple flux SSE.
- **Notifications e-mail / SMS / WhatsApp** : seule la notification en base (in-app) existe.
  L'architecture (`ajouterNotification` dans `logic.js`) est prête à être branchée sur un
  fournisseur externe.
- **Export PDF / Excel des statistiques et rapports** : non implémenté (nécessiterait soit une
  dépendance npm, soit une génération manuelle de CSV/HTML imprimable).
- **Versionnage des pièces jointes** : un nouvel envoi crée un nouveau fichier distinct, mais
  sans regroupement explicite "version 1 / version 2".
- **Sauvegarde/restauration pilotée depuis l'interface** : la base étant un simple fichier
  SQLite (`data/ecole.db`), une sauvegarde consiste à copier ce fichier ; pas d'interface dédiée.
- **Sessions en mémoire** : les connexions sont perdues si le serveur redémarre (pas de table
  de sessions persistée). Facile à faire évoluer en ajoutant une table `sessions`.
- **Estimation du temps d'attente** : non calculée (le cahier des charges autorise explicitement
  à afficher "Estimation indisponible" tant que les données historiques sont insuffisantes).

## Structure du projet

```
ecole-app/
├── server.js       Serveur HTTP + toutes les routes API REST
├── db.js           Schéma SQLite + création des comptes de démonstration
├── logic.js        Règles métier (numérotation, calcul de la file, historique)
├── auth.js         Sessions et authentification
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js      Application front-end (SPA vanilla JS)
├── data/           Fichier de base de données (créé automatiquement)
└── uploads/        Fichiers joints aux tickets (créé automatiquement)
```
