# LA HUNE — Draft Survey (PWA)

Outil de pesée par tirants d'eau, utilisable
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

Samy Fraval — LA HUNE, Cabinet d'expertise maritime indépendant
Landéda, Finistère
Version v2 — avril 2026

Prototype à usage pédagogique et de recoupement. Ne substitue pas les calculs
manuels du surveyeur, seuls à engager sa responsabilité professionnelle.
