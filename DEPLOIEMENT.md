# Procédures de déploiement

---

## A. GitHub Pages

**Coût : gratuit. Temps : 5 minutes.**

### Étapes

1. **Créer un nouveau dépôt** sur github.com :
   - Va sur https://github.com/new
   - Nom suggéré : `draft-survey` (ou ce que tu veux)
   - Visibilité : **Private** (tu seras le seul à y accéder) ou **Public**
   - Ne coche rien d'autre (pas de README, pas de .gitignore)
   - Crée le dépôt

2. **Uploader les fichiers** :
   - Sur la page du dépôt vide, clique « uploading an existing file »
   - Glisse-dépose TOUT le contenu du dossier `draft-survey-pwa`
     (pas le dossier lui-même, son contenu : `index.html`, `app.jsx`,
     `manifest.webmanifest`, `sw.js`, `icons/`, etc.)
   - Message de commit : « Initial commit »
   - Valide avec « Commit changes »

3. **Activer GitHub Pages** :
   - Dans ton dépôt, va dans **Settings** (onglet en haut)
   - Dans le menu gauche : **Pages**
   - Source : **Deploy from a branch**
   - Branch : **main** / **/ (root)**
   - Clique « Save »
   - Attends 1-2 minutes ; l'URL apparaît en haut de la même page :
     `https://<ton-user>.github.io/draft-survey/`

4. **Tester sur le téléphone** :
   - Ouvre l'URL dans Safari (iPhone) ou Chrome (Android)
   - Une fois chargée, via le menu « Partager » / « Ajouter à l'écran
     d'accueil »
   - L'icône LA HUNE apparaît sur ton écran d'accueil
   - L'app fonctionne ensuite **offline**

### Mise à jour

Quand tu veux publier une nouvelle version :
- Dépose les nouveaux fichiers sur le dépôt (remplace les anciens)
- Dans `sw.js`, change la valeur de `CACHE_NAME` (ex: mettre la date du jour)
  — c'est ce qui force les téléphones à recharger la nouvelle version
- GitHub Pages se met à jour automatiquement en 1 minute

### Limites

- **Pas de mot de passe au niveau de l'URL** en gratuit. Si tu mets le
  dépôt en Private, l'URL GitHub Pages reste publique par défaut (GitHub
  Pages privé = plan payant).
- Le mot de passe de l'app (dans la PWA elle-même) reste ta première
  protection.

---

## B. Netlify

**Coût : gratuit. Temps : 3 minutes. Pas besoin de ligne de commande.**

### Étapes

1. Va sur https://app.netlify.com et crée un compte (connexion possible
   via ton GitHub).

2. Sur le tableau de bord, cherche « **Want to deploy a new site without
   connecting to Git? Drag and drop your site output folder here** ».

3. Glisse-dépose le dossier `draft-survey-pwa` entier dans la zone.

4. En quelques secondes, tu as une URL du type :
   `https://random-name-123456.netlify.app`

5. Dans **Site configuration → Change site name**, tu peux la remplacer
   par quelque chose de plus propre, ex: `lahune-draft.netlify.app`.

### Mise à jour

- Sur le tableau de bord du site, onglet **Deploys**
- Glisse-dépose le nouveau dossier : un nouveau déploiement remplace
  l'ancien instantanément.

### Limites

- Mot de passe au niveau URL (« password protection ») : réservé aux plans
  payants (**Pro** à ~19 $/mois). Seule la protection dans l'app est
  disponible en gratuit.
- Pour plus tard, si Netlify te plaît, tu peux connecter ton dépôt GitHub
  et chaque commit déclenchera un déploiement automatique.
