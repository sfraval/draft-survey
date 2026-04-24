# LA HUNE — Draft Survey (PWA)

Outil de pesée par tirants d'eau, synthèse des templates DUEMTM, utilisable
en local ou en ligne, installable sur téléphone.

---

## Contenu du dossier

```
draft-survey-pwa/
├── index.html              Point d'entrée
├── app.jsx                 Code de l'application (React + JSX)
├── manifest.webmanifest    Manifeste PWA (nom, icônes, thème)
├── sw.js                   Service Worker (offline, cache)
├── serveur-local.sh        Lanceur local (macOS / Linux)
├── icons/                  Icônes de l'app (SVG + PNG)
├── README.md               Ce fichier
└── DEPLOIEMENT.md          Procédures pour GitHub Pages, Netlify, IONOS
```

---

## 1. Utilisation en local (Mac)

### Lancement

1. Ouvre un Terminal
2. Va dans le dossier `draft-survey-pwa` :
   ```bash
   cd ~/chemin/vers/draft-survey-pwa
   ```
3. Lance le serveur :
   ```bash
   ./serveur-local.sh
   ```
4. Ouvre `http://localhost:8443` dans Safari ou Chrome

Pour arrêter : `Ctrl+C` dans le Terminal.

### Accès depuis le téléphone (même wifi)

Le script affiche aussi une adresse du type `http://192.168.x.x:8443`.
Ouvre-la depuis le navigateur de ton téléphone, sur le même réseau wifi que
le Mac.

> ⚠️ En wifi local (IP en 192.168.x.x), la PWA fonctionne mais **le mode
> offline est désactivé** : les navigateurs exigent HTTPS pour activer le
> service worker en dehors de `localhost`. Pour un vrai mode offline
> installable, utilise un des déploiements en ligne (§2 à §4).

### Première utilisation

L'écran de verrouillage te demande de définir un mot de passe. Il est stocké
localement (hash SHA-256) sur le téléphone uniquement. Si tu l'oublies, le
bouton « Réinitialiser » efface toutes les données locales et redemande un
nouveau mot de passe.

---

## 2. Déploiement en ligne

Trois cibles possibles, détaillées dans `DEPLOIEMENT.md` :

| Cible | Coût | Complexité | Mot de passe | Offline PWA |
|---|---|---|---|---|
| **GitHub Pages** | Gratuit | ★☆☆ | App seulement | Oui |
| **Netlify** | Gratuit | ★☆☆ | App seulement (basic-auth = payant) | Oui |
| **IONOS (lahune.org)** | Déjà payé | ★★☆ | **Nginx basic-auth + app** | Oui |

Pour un usage stage cette semaine, je recommande GitHub Pages (tu as déjà
un compte). Pour la version "professionnelle" de LA HUNE, la cible finale
est `survey.lahune.org` avec double protection.

---

## Stockage des données

Toutes les données (profils navire, survey en cours, mot de passe) sont
stockées **dans le navigateur du téléphone**, via `localStorage`. Elles
ne quittent jamais l'appareil. Conséquences :

- ✓ Pas de fuite, pas de synchro involontaire
- ✗ Pas de synchro entre téléphone et Mac (chaque appareil a sa propre base)
- ✗ Si tu changes de téléphone, tu repars à zéro (pas de compte cloud)

Pour une synchro future, on pourra brancher l'app à ton ERP NocoBase via
une API — mais ce n'est pas au programme de la v2.

---

## Limitations connues

- **Babel standalone** : le JSX est compilé à la volée dans le navigateur,
  ce qui ajoute ~2 secondes au premier lancement. Pour une version
  "production" plus rapide, il faudrait un build avec Vite (je peux le
  faire plus tard si tu veux).
- **Tailwind CDN** : même principe, chargé à chaque fois (ou depuis le
  cache en offline). ~100 ko.
- **Le mot de passe de l'app** est un verrou symbolique, pas une sécurité
  cryptographique forte. Voir `DEPLOIEMENT.md` pour la vraie protection
  niveau serveur (Nginx basic-auth).

---

## Formules implémentées

Synthèse des 4 templates étudiés (LA HUNE, Calculation, PRO, Form EVER SHIP).
Les principales étapes :

1. **Moyennes BD/TD** des 3 tirants mesurés aux marques
2. **Correction aux perpendiculaires** via LBM = LBP − dF − dA
3. **Quarter Mean** par la règle 6-8 :
   `(F_corr + A_corr + 6 × M_corr) / 8`
4. **Correction au draft moulé** : QM − (épaisseur tôle de quille)
5. **Interpolation hydrostatique** sur draft, déplacement, TPC, LCF, MTC+0,5,
   MTC−0,5 (soit 2 points encadrants, soit table complète)
6. **1ère correction de trim** : −Trim × TPC × LCF × 100 / LBP
7. **2ème correction de trim** : Trim² × 50 × ΔMTC / LBP
8. **Correction de densité** : × ρ_dock / ρ_table
9. **Déductibles** (ballast, FW, FO, DO, LO, slops, autres)
10. **Cargo** = Displ. net final − Displ. net initial

Diagnostics affichés mais non intégrés au calcul : déflection (hog/sag),
gîte.

---

## Auteur

Samy Hanache — LA HUNE, Cabinet d'expertise maritime indépendant
Landéda, Finistère
Version v2 — avril 2026

Prototype à usage pédagogique et de recoupement. Ne substitue pas les calculs
manuels du surveyeur, seuls à engager sa responsabilité professionnelle.
