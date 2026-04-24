# Procédures de déploiement

Trois cibles, dans l'ordre de complexité.

---

## A. GitHub Pages (recommandé pour cette semaine)

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

---

## C. IONOS — survey.lahune.org

**Coût : déjà inclus dans ton VPS. Temps : 15-20 minutes. Plus technique.**

C'est la cible finale quand tu veux intégrer l'outil à l'écosystème LA HUNE
(à côté de `erp.lahune.org` et `cloud.lahune.org`). Avantage majeur : tu
peux ajouter une **vraie protection par mot de passe au niveau Nginx**,
bien plus sérieuse que dans l'app.

### Étape 1 — Enregistrement DNS

1. Connecte-toi à ton espace IONOS
2. Domaines → lahune.org → DNS
3. Ajoute un enregistrement **A** :
   - Nom : `survey`
   - Valeur : l'IP de ton VPS (même que `erp.lahune.org`)
   - TTL : 3600
4. Attends la propagation (5-30 min). Vérifie avec :
   ```bash
   dig survey.lahune.org +short
   ```

### Étape 2 — Upload des fichiers sur le VPS

Depuis ton Mac, dans le dossier qui contient `draft-survey-pwa` :

```bash
# Créer le dossier cible sur le VPS
ssh ton-user@erp.lahune.org "sudo mkdir -p /var/www/survey.lahune.org && sudo chown -R ton-user:ton-user /var/www/survey.lahune.org"

# Uploader les fichiers
rsync -avz --delete draft-survey-pwa/ ton-user@erp.lahune.org:/var/www/survey.lahune.org/
```

### Étape 3 — Créer le fichier de mot de passe Nginx

Sur le VPS :

```bash
# Installer l'utilitaire htpasswd si besoin
sudo apt install apache2-utils -y

# Créer le fichier avec un utilisateur "samy"
sudo htpasswd -c /etc/nginx/.htpasswd-survey samy
# → le shell demande le mot de passe deux fois
```

### Étape 4 — Configurer Nginx

```bash
sudo nano /etc/nginx/sites-available/survey.lahune.org
```

Colle le contenu suivant :

```nginx
server {
    listen 80;
    server_name survey.lahune.org;
    # Redirection vers HTTPS (Certbot va ajouter le reste)
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name survey.lahune.org;

    # Certificat SSL — géré par Certbot, ajouté automatiquement
    # ssl_certificate /etc/letsencrypt/live/survey.lahune.org/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/survey.lahune.org/privkey.pem;

    root /var/www/survey.lahune.org;
    index index.html;

    # Authentification HTTP basique
    auth_basic "LA HUNE — Draft Survey";
    auth_basic_user_file /etc/nginx/.htpasswd-survey;

    # Type MIME pour le manifest PWA
    location ~ \.webmanifest$ {
        add_header Content-Type application/manifest+json;
    }

    # Service worker : ne jamais mettre en cache au niveau Nginx
    location = /sw.js {
        add_header Cache-Control "no-cache";
        expires 0;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Active le site et vérifie :

```bash
sudo ln -s /etc/nginx/sites-available/survey.lahune.org /etc/nginx/sites-enabled/
sudo nginx -t          # doit dire "syntax is ok" puis "test is successful"
sudo systemctl reload nginx
```

### Étape 5 — Certificat SSL Let's Encrypt

```bash
sudo certbot --nginx -d survey.lahune.org
```

Certbot édite automatiquement le fichier Nginx pour décommenter les lignes
SSL. Recharge Nginx une dernière fois :

```bash
sudo systemctl reload nginx
```

### Étape 6 — Test

Ouvre https://survey.lahune.org dans un navigateur :
- Tu dois d'abord être invité à saisir le login Nginx (`samy` + mot de passe)
- Puis l'écran de verrouillage de l'app (mot de passe de l'app)

Deux barrières, dont la première (Nginx) est une vraie sécurité.

### Mises à jour ultérieures

Depuis ton Mac :

```bash
rsync -avz --delete draft-survey-pwa/ ton-user@erp.lahune.org:/var/www/survey.lahune.org/
```

N'oublie pas de changer `CACHE_NAME` dans `sw.js` à chaque update pour
forcer le rechargement côté téléphones.

---

## Quelle cible choisir ?

**Pour cette semaine (stage) : GitHub Pages**. C'est le plus simple, gratuit,
fonctionne offline, prêt en 5 minutes.

**Plus tard, version définitive : IONOS sur `survey.lahune.org`**. Intégration
à l'écosystème LA HUNE, vraie protection Nginx, contrôle total.

Netlify est une alternative intermédiaire si GitHub Pages te pose souci.
