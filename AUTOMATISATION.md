# Automatisation de la validation

Tout ce qui suit se fait **depuis l'interface web de GitHub**. Aucune commande à taper, aucun terminal.

---

## Ce que fait la chaîne

À chaque fois qu'un fichier change sur la branche `main`, GitHub exécute automatiquement, sur ses propres serveurs :

1. **Le banc de test.** Le moteur est confronté à la pesée réelle du vraquier EVER SHIP, sur les trois conditions, plus les garde-fous de refus de calcul.
2. **L'audit d'architecture.** Vérifie qu'aucun fichier ne charge de ressource distante et que rien n'est compilé dans le navigateur. C'est ce contrôle qui rend impossible le retour de la panne de la v2.
3. **Le déploiement**, uniquement si les deux premières étapes sont vertes.

Un seul contrôle en échec arrête tout. Un moteur qui calcule faux ne peut pas atteindre la production.

---

## Installation, une seule fois

### 1. Créer le fichier de workflow

Le dossier `.github` commence par un point, donc il est **invisible** pour le glisser-déposer du Finder. C'est exactement ce qui avait bloqué le déploiement de `Conv.-CC-BL`. Il faut passer par la création de fichier en ligne :

- Dans le dépôt, bouton **Add file** puis **Create new file**
- Dans le champ du nom, taper exactement :
  ```
  .github/workflows/validation.yml
  ```
  GitHub crée les deux dossiers tout seul dès que tu tapes les barres obliques.
- Coller le contenu de `validation.yml`
- **Commit changes**

### 2. Basculer Pages sur GitHub Actions

Sans cette bascule, Pages publie directement depuis la branche et court-circuite la validation. Le verrou ne sert alors à rien.

- **Settings** puis **Pages**
- **Source** : choisir **GitHub Actions** au lieu de *Deploy from a branch*

C'est tout. La chaîne tourne dès le commit suivant.

---

## Lire les résultats

### Le rapport
Onglet **Actions**, cliquer sur la dernière exécution. Le rapport complet s'affiche sur la page, en tableaux : chaque grandeur, la valeur du moteur, celle du classeur, l'écart, l'état. Pas besoin d'ouvrir un fichier.

### Le procès-verbal
Sur la même page, section **Artifacts**, le fichier `validation-<numéro>` contient le procès-verbal daté en texte et le rapport en JSON. Conservé 90 jours. Utile si tu veux joindre à un dossier la preuve que le moteur était validé à la date de la pesée.

### En cas d'échec
Une pastille rouge apparaît sur le commit et dans l'onglet Actions. GitHub t'envoie un courriel. Le rapport indique la grandeur en écart et l'ampleur de l'écart, donc tu sais immédiatement quel calcul a bougé.

### Relancer à la main
Onglet **Actions**, choisir le workflow **Validation et déploiement**, bouton **Run workflow**. Sert à revérifier sans rien modifier.

---

## Le lanceur en local

Le même contrôle tourne aussi sur ta machine, si un jour tu en as besoin :

| Commande | Effet |
|---|---|
| `node run-node.js` | rapport complet en couleur |
| `node run-node.js --quiet` | verdict en une ligne |
| `node run-node.js --md` | rapport Markdown |
| `node run-node.js --json` | rapport machine |
| `node run-node.js --pv pv.txt` | écrit le procès-verbal dans `pv.txt` |
| `node run-node.js --no-audit` | banc de calcul seul |
| `npm install && node test-interface.js` | test de bout en bout de l'interface |

Code de sortie 0 si conforme, 1 sinon.

Le test d'interface charge `index.html` dans un DOM et pilote l'application comme un utilisateur : création du profil navire, import de la table du bord avec affectation des colonnes, saisie des six tirants d'eau, registre de tanks, interpolation par barème, chaînage, production du rapport Word. Il vérifie le **câblage**, pas le calcul : un moteur juste relié à un mauvais champ donne un résultat faux. Il a besoin de `jsdom`, seule dépendance du projet, et elle est de développement uniquement : rien de ce dossier n'est déployé.

---

## Ce que l'audit surveille

| Règle | Ce qu'elle empêche |
|---|---|
| Aucune ressource distante chargée | qu'une mise à jour de CDN casse l'outil, comme en avril |
| Détecteur de ressource distante opérationnel | que la règle ci-dessus devienne aveugle sans qu'on le voie |
| Aucune compilation dans le navigateur | le retour de Babel à l'exécution |
| Toutes les ressources sont locales | un chemin cassé ou une URL glissée par erreur |
| Convention LCF sans valeur par défaut | qu'une convention non déclarée passe en silence |
| Aucune extrapolation hors table | qu'un tirant d'eau hors plage produise un chiffre inventé |
| Lecture numérique sûre | qu'un `12 500` collé devienne 12 |
| Intégrité de la table de référence | qu'on modifie l'étalon sans le déclarer |
| Disponibilité hors réseau cohérente | un outil qui marche au bureau et se casse sur le quai |
| Aucune formule de pesée dans l'interface | qu'un calcul migre dans `app.js` et échappe au banc |
| Générateur de document opérationnel | un rapport Word illisible ou aux accents cassés |
| Auditeur de table opérationnel | que le détecteur d'erreurs de table cesse de fonctionner |

### Sur les URL tolérées

La règle « aucune ressource distante » ne juge pas les URL par leur domaine mais par leur **contexte d'apparition**. Une URL dans un `src`, un `href`, un `url()`, un `fetch`, un `import` ou un `new Worker` est un chargement : refus systématique. Une URL en valeur de `xmlns` est un identifiant, jamais appelé sur le réseau, et le format `.docx` en exige plusieurs dans chaque partie du document : elle passe, à condition d'appartenir à la liste des espaces de noms Open XML attendus.

Juger par domaine aurait ouvert la porte à un vrai chargement depuis ces mêmes domaines. Et pour que la règle ne devienne pas aveugle avec le temps, elle est elle-même testée sur dix échantillons qui doivent être refusés (dont les deux lignes exactes qui ont cassé la v2) et cinq qui doivent passer.

---

## Défauts connus de la table étalon

La table hydrostatique de l'EVER SHIP est conservée **telle que fournie par le bord**. Elle porte deux fautes de frappe dans la colonne déplacement, relevées le 30 juillet 2026 :

| Tirant d'eau | Valeur portée | Valeur cohérente | Écart |
|---|---|---|---|
| 4,52 m | 31 522 t | 31 623 t | −101 t |
| 4,69 m | 31 879 t | 32 879 t | −1 000 t |

Elles ne sont pas corrigées dans le fichier : on ne retouche pas un document du bord dans un étalon. Elles sont **déclarées**, et l'audit échoue aussi bien si une nouvelle anomalie apparaît que si l'une de ces deux disparaît, ce qui signalerait une modification silencieuse de l'étalon.

La fonction qui les a trouvées, `MoteurDraftSurvey.auditTable`, sera branchée dans l'application : à chaque table de navire saisie ou collée, elle signalera les lignes suspectes et proposera la valeur cohérente. La décision de corriger restera la tienne, avec mention au rapport.
