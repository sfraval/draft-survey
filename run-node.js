#!/usr/bin/env node
// =============================================================================
// LA HUNE - Draft Survey : lanceur de validation
// =============================================================================
// Execute deux familles de controles et rend un code de sortie exploitable
// par une chaine d'integration continue.
//
//   1. BANC DE CALCUL   : le moteur contre la pesee reelle de l'EVER SHIP,
//                         plus les garde-fous de refus de calcul.
//   2. AUDIT D'ARCHITECTURE : verifie que l'application ne depend d'aucune
//                         ressource distante et ne compile rien dans le
//                         navigateur. C'est ce qui a tue la v2 : une URL de
//                         CDN non versionnee a change de contenu et l'outil
//                         s'est arrete de fonctionner sans qu'une ligne de
//                         code n'ait bouge. Ce controle rend la panne
//                         impossible a reintroduire.
//
// Code de sortie : 0 si tout est conforme, 1 sinon. Une chaine d'integration
// bloque le deploiement sur ce code.
//
// Usage :
//   node run-node.js                 rapport texte en console
//   node run-node.js --md            rapport Markdown (resume GitHub Actions)
//   node run-node.js --json          rapport JSON
//   node run-node.js --pv proces.txt ecrit le proces-verbal dans un fichier
//   node run-node.js --quiet         verdict seul
//   node run-node.js --no-audit      banc de calcul uniquement
// =============================================================================

"use strict";

const fs = require("fs");
const path = require("path");

const RACINE = __dirname;
const ARGS = process.argv.slice(2);
const opt = {
  md: ARGS.includes("--md"),
  json: ARGS.includes("--json"),
  quiet: ARGS.includes("--quiet"),
  audit: !ARGS.includes("--no-audit"),
  pv: (() => {
    const i = ARGS.indexOf("--pv");
    return i >= 0 && ARGS[i + 1] ? ARGS[i + 1] : null;
  })()
};

// --- couleurs, seulement si la sortie est un vrai terminal ------------------
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const C = {
  r: tty ? "\x1b[0m" : "", gras: tty ? "\x1b[1m" : "",
  vert: tty ? "\x1b[32m" : "", rouge: tty ? "\x1b[31m" : "",
  jaune: tty ? "\x1b[33m" : "", gris: tty ? "\x1b[90m" : "",
  bleu: tty ? "\x1b[36m" : ""
};

// --- chargement du moteur, sans bundler ------------------------------------
// engine.js, bench.js et la table sont ecrits pour le navigateur et attachent
// leurs exports a un objet global. On leur fournit ce global sous Node.
function charger(fichiers) {
  global.window = global;
  for (const f of fichiers) {
    const p = path.join(RACINE, f);
    if (!fs.existsSync(p)) {
      console.error(`Fichier introuvable : ${f}`);
      process.exit(2);
    }
    // eslint-disable-next-line no-eval
    eval(fs.readFileSync(p, "utf8"));
  }
}
charger(["hydro-evership.js", "engine.js", "bench.js", "docx.js"]);
const M = global.MoteurDraftSurvey;
const B = global.BancTestDraftSurvey;

// --- formatage -------------------------------------------------------------
const f = (v, d = 4) =>
  typeof v === "number" && isFinite(v) ? v.toFixed(d) : String(v);

function decimales(cle) {
  if (/^(quarter|quarterMoule|corrAv|corrMi|corrAr|assiette|lcfBrut)$/.test(cle)) return 4;
  if (/^(tpc|mtcP|mtcM|corr1|corr2|corrAssiette)$/.test(cle)) return 3;
  return 2;
}

// =============================================================================
// AUDIT D'ARCHITECTURE
// =============================================================================

const FICHIERS_APP = ["index.html", "app.js", "style.css", "validation.html",
                      "engine.js", "bench.js", "hydro-evership.js", "docx.js"];

// =============================================================================
// Detection des ressources distantes
// =============================================================================
// Toutes les URL ne se valent pas. Il faut distinguer deux natures :
//
//   URL CHARGEE      : l'outil va chercher quelque chose sur un serveur au
//                      moment de s'executer. C'est ce qui a tue la v2, et c'est
//                      interdit sans exception.
//   URL IDENTIFIANTE : une chaine de caracteres qui sert de nom, jamais
//                      appelee sur le reseau. Les espaces de noms XML d'Open
//                      XML en sont : le format .docx les EXIGE dans chaque
//                      partie, et Word ne les telecharge jamais.
//
// Confondre les deux rendrait l'audit inutilisable, mais les tolerer en bloc
// par domaine ouvrirait la porte a un vrai chargement depuis ces memes
// domaines. On qualifie donc chaque URL par son CONTEXTE d'apparition, pas par
// son domaine.

// Contextes de chargement effectif : la presence d'une URL dans l'un d'eux est
// un echec, quel que soit le domaine.
const CONTEXTES_CHARGEMENT = [
  { re: /\b(?:src|href|data-src|poster|action|formaction)\s*=\s*["']?(https?:\/\/[^\s"'>]+)/gi,
    quoi: "attribut de chargement" },
  { re: /url\(\s*["']?(https?:\/\/[^\s"')]+)/gi, quoi: "url() de feuille de style" },
  { re: /@import\s+(?:url\()?\s*["']?(https?:\/\/[^\s"');]+)/gi, quoi: "@import" },
  { re: /\b(?:fetch|importScripts|open)\s*\(\s*["'`](https?:\/\/[^\s"'`]+)/gi,
    quoi: "appel reseau" },
  { re: /\bimport\s*\(\s*["'`](https?:\/\/[^\s"'`]+)/gi, quoi: "import dynamique" },
  { re: /\bfrom\s+["'](https?:\/\/[^\s"']+)/gi, quoi: "import de module" },
  { re: /\bnew\s+(?:Worker|SharedWorker|WebSocket|EventSource)\s*\(\s*["'`](https?:\/\/[^\s"'`]+)/gi,
    quoi: "worker ou socket" }
];

// Contextes purement identifiants. Une URL doit se trouver dans l'un d'eux ET
// appartenir a la liste des espaces de noms attendus pour etre acceptee.
const CONTEXTES_IDENTIFIANTS = [
  /xmlns(?::[A-Za-z0-9_-]+)?\s*=\s*["'](https?:\/\/[^\s"']+)/gi,
  /\bType\s*=\s*["'](https?:\/\/[^\s"']+)/gi,
  /\bxsi:type\s*=\s*["'][^"']*["']/gi
];

// Espaces de noms admis, parce que le format .docx les impose.
const NAMESPACES_ADMIS = [
  /^https?:\/\/schemas\.openxmlformats\.org\//,
  /^https?:\/\/purl\.org\/dc\//,
  /^https?:\/\/www\.w3\.org\//
];

// Qualifie un fichier. Renvoie { charges: [...], identifiants: [...], inconnues: [...] }
function qualifierUrls(nom, txt) {
  const res = { charges: [], identifiants: [], inconnues: [] };
  const lignes = txt.split(/\r?\n/);

  lignes.forEach((ligne, i) => {
    const num = i + 1;

    // 1. chargements : bloquants sans condition
    for (const c of CONTEXTES_CHARGEMENT) {
      c.re.lastIndex = 0;
      let m;
      while ((m = c.re.exec(ligne)) !== null) {
        res.charges.push({ fichier: nom, ligne: num, url: m[1], contexte: c.quoi });
      }
    }

    // 2. identifiants declares
    const identifiees = new Set();
    for (const re of CONTEXTES_IDENTIFIANTS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(ligne)) !== null) {
        if (!m[1]) continue;
        identifiees.add(m[1]);
        if (NAMESPACES_ADMIS.some((n) => n.test(m[1]))) {
          res.identifiants.push({ fichier: nom, ligne: num, url: m[1] });
        } else {
          res.inconnues.push({ fichier: nom, ligne: num, url: m[1],
            motif: "espace de noms hors liste admise" });
        }
      }
    }

    // 3. tout le reste : une URL qui n'est ni un chargement identifie ni un
    //    identifiant declare doit etre justifiee. Les commentaires ne sont pas
    //    exemptes : une URL en commentaire aujourd'hui devient un src demain.
    const toutes = ligne.match(/https?:\/\/[^\s"'`)<>,;]+/g) || [];
    for (const u of toutes) {
      if (identifiees.has(u)) continue;
      if (res.charges.some((x) => x.ligne === num && x.url === u)) continue;
      if (NAMESPACES_ADMIS.some((n) => n.test(u))) continue;
      res.inconnues.push({ fichier: nom, ligne: num, url: u, motif: "contexte non qualifie" });
    }
  });
  return res;
}

const REGLES_AUDIT = [
  {
    nom: "Aucune ressource distante chargee",
    detail: "aucun src, href, url(), fetch ou import vers un serveur tiers",
    verifier(fichiers) {
      const fautes = [];
      for (const [nom, txt] of Object.entries(fichiers)) {
        const q = qualifierUrls(nom, txt);
        for (const x of q.charges) {
          fautes.push(`${x.fichier}:${x.ligne} → ${x.contexte} vers ${x.url}`);
        }
        for (const x of q.inconnues) {
          fautes.push(`${x.fichier}:${x.ligne} → ${x.url} (${x.motif})`);
        }
      }
      return fautes;
    }
  },
  {
    nom: "Detecteur de ressource distante operationnel",
    detail: "distingue une URL chargee d'un espace de noms XML, sur echantillons",
    // Une regle de securite qui ne se verifie pas elle-meme ne protege rien.
    verifier() {
      const fautes = [];
      const doitBloquer = [
        ['<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>', "le CDN Babel de la v2"],
        ['<script src="https://cdn.tailwindcss.com"></script>', "le CDN Tailwind de la v2"],
        ['<link rel="stylesheet" href="https://fonts.googleapis.com/css?family=X" />', "une police distante"],
        ['@import url("https://exemple.test/a.css");', "un @import distant"],
        ['fetch("https://exemple.test/api")', "un appel reseau"],
        ['import("https://exemple.test/m.js")', "un import dynamique"],
        ['import x from "https://exemple.test/m.js";', "un import de module"],
        ['new Worker("https://exemple.test/w.js")', "un worker distant"],
        ['// voir https://exemple.test/doc pour la suite', "une URL en commentaire"],
        ['xmlns:w="https://exemple.test/inconnu"', "un espace de noms hors liste"]
      ];
      for (const [echantillon, quoi] of doitBloquer) {
        const q = qualifierUrls("echantillon", echantillon);
        if (!q.charges.length && !q.inconnues.length) {
          fautes.push(`non detecte : ${quoi}`);
        }
      }
      const doitPasser = [
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
        '<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
        '<cp:coreProperties xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
        '<script src="engine.js"></script>',
        '<link rel="stylesheet" href="style.css" />'
      ];
      for (const echantillon of doitPasser) {
        const q = qualifierUrls("echantillon", echantillon);
        if (q.charges.length || q.inconnues.length) {
          fautes.push(`bloque a tort : ${echantillon.slice(0, 70)} ` +
            `(${(q.charges.concat(q.inconnues)).map((x) => x.url).join(", ")})`);
        }
      }
      return fautes;
    }
  },
  {
    nom: "Aucune compilation dans le navigateur",
    detail: "pas de Babel a l'execution : c'est la panne de la v2",
    verifier(fichiers) {
      const fautes = [];
      for (const [nom, txt] of Object.entries(fichiers)) {
        if (/type\s*=\s*["']text\/babel["']/.test(txt)) fautes.push(`${nom} → script type="text/babel"`);
        if (/@babel\/standalone/.test(txt)) fautes.push(`${nom} → @babel/standalone`);
        if (/cdn\.tailwindcss\.com/.test(txt)) fautes.push(`${nom} → Tailwind CDN`);
      }
      return fautes;
    }
  },
  {
    nom: "Toutes les ressources sont locales",
    detail: "chaque script et chaque feuille de style est un chemin du dossier",
    verifier(fichiers) {
      const fautes = [];
      for (const page of ["index.html", "validation.html"]) {
        const html = fichiers[page] || "";
        const refs = [
          ...[...html.matchAll(/<script[^>]+src\s*=\s*["']([^"']+)["']/g)].map((m) => ["script", m[1]]),
          ...[...html.matchAll(/<link[^>]+href\s*=\s*["']([^"']+)["']/g)].map((m) => ["link", m[1]])
        ];
        if (!refs.length) fautes.push(`${page} → aucune ressource referencee`);
        for (const [type, ref] of refs) {
          if (/^(https?:)?\/\//.test(ref)) { fautes.push(`${page} → ${type} distant : ${ref}`); continue; }
          if (!fs.existsSync(path.join(RACINE, ref))) fautes.push(`${page} → ${type} introuvable : ${ref}`);
        }
      }
      return fautes;
    }
  },
  {
    nom: "Convention LCF sans valeur par defaut",
    detail: "le moteur doit refuser de calculer si la convention n'est pas declaree",
    verifier() {
      const src = fs.readFileSync(path.join(RACINE, "engine.js"), "utf8");
      const fautes = [];
      if (!/convention LCF non declaree/.test(src)) {
        fautes.push("engine.js → le message de blocage sur convention LCF a disparu");
      }
      // controle fonctionnel : une convention absente doit bloquer
      const table = M.prepareTable(global.HYDRO_EVERSHIP);
      const nav = Object.assign({}, B.NAVIRE, { hydroPrete: table, conventionLcf: undefined });
      const r = M.pesee(nav, B.CAS[0].releve);
      if (r.ok !== false) fautes.push("engine.js → une convention LCF absente n'a pas bloque le calcul");
      return fautes;
    }
  },
  {
    nom: "Aucune extrapolation hors table",
    detail: "sortir de la table hydrostatique doit bloquer, jamais prolonger",
    verifier() {
      const fautes = [];
      const table = M.prepareTable(global.HYDRO_EVERSHIP);
      const bas = table[0].draft - 0.01;
      const haut = table[table.length - 1].draft + 0.01;
      for (const [d, lbl] of [[bas, "un centimetre sous la table"], [haut, "un centimetre au-dessus"]]) {
        const r = M.interp(table, "disp", d);
        if (r.valeur !== null) fautes.push(`engine.js → ${lbl} a renvoye une valeur (${f(r.valeur, 2)} t)`);
      }
      return fautes;
    }
  },
  {
    nom: "Lecture numerique sure",
    detail: "espaces de milliers, virgule decimale, saisie invalide",
    verifier() {
      const fautes = [];
      const cas = [
        ["12 500", 12500], ["12\u00A0500", 12500], ["1 234,5", 1234.5],
        ["-2,255", -2.255], ["+6.43", 6.43]
      ];
      for (const [entree, attendu] of cas) {
        const got = M.lire(entree);
        if (got !== attendu) fautes.push(`lire("${entree}") = ${got}, attendu ${attendu}`);
      }
      for (const mauvais of ["abc", "", "1,2,3", "12-5", null, undefined, "  "]) {
        if (M.lire(mauvais) !== null) fautes.push(`lire(${JSON.stringify(mauvais)}) devait renvoyer null`);
      }
      return fautes;
    }
  },
  {
    nom: "Integrite de la table de reference",
    detail: "1 301 lignes, pas de 0,01 m, et les deux seuls defauts connus du document",
    // La table de l'EVER SHIP est conservee TELLE QUE FOURNIE PAR LE BORD.
    // Elle porte deux fautes de frappe dans la colonne deplacement, relevees
    // le 30 juillet 2026 et documentees ci-dessous. On ne corrige pas un
    // document du bord dans un fichier de reference : on declare son etat.
    // La regle echoue si un defaut nouveau apparait, ET AUSSI si l'un des
    // deux defauts connus disparait, ce qui signalerait qu'on a modifie
    // l'etalon sans le dire.
    verifier() {
      const fautes = [];
      const CONNUS = [
        { draft: 4.52, valeur: 31522, proposee: 31623 },
        { draft: 4.69, valeur: 31879, proposee: 32879 }
      ];
      const t = M.prepareTable(global.HYDRO_EVERSHIP);
      if (t.length !== 1301) fautes.push(`${t.length} lignes au lieu de 1301`);

      const a = M.auditTable(global.HYDRO_EVERSHIP);
      if (a.pas !== 0.01) fautes.push(`pas de tirant d'eau ${a.pas} m au lieu de 0,01 m`);
      for (const av of a.avertissements) fautes.push(`avertissement inattendu → ${av}`);

      for (const c of CONNUS) {
        const trouve = a.anomalies.find((x) => Math.abs(x.draft - c.draft) < 1e-9);
        if (!trouve) {
          fautes.push(`defaut connu a ${c.draft} m non retrouve : l'etalon a-t-il ete modifie ?`);
          continue;
        }
        if (trouve.valeur !== c.valeur) {
          fautes.push(`a ${c.draft} m : valeur ${trouve.valeur} t au lieu de ${c.valeur} t attendue`);
        }
        if (trouve.proposee !== c.proposee) {
          fautes.push(`a ${c.draft} m : valeur coherente proposee ${trouve.proposee} t au lieu de ${c.proposee} t`);
        }
      }
      const inattendues = a.anomalies.filter(
        (x) => !CONNUS.some((c) => Math.abs(x.draft - c.draft) < 1e-9)
      );
      for (const x of inattendues) {
        fautes.push(`anomalie nouvelle a ${x.draft} m : ${x.valeur} t, coherent ${x.proposee} t`);
      }
      return fautes;
    }
  },
  {
    nom: "Disponibilite hors reseau coherente",
    detail: "la liste du service worker couvre exactement les fichiers livres",
    // Ajouter un fichier a l'application sans l'ajouter au service worker
    // donnerait un outil qui marche au bureau et se casse sur le quai, sans
    // qu'aucun message ne le signale. Ce controle rend l'oubli impossible.
    verifier(fichiers) {
      const fautes = [];
      const sw = fs.existsSync(path.join(RACINE, "sw.js"))
        ? fs.readFileSync(path.join(RACINE, "sw.js"), "utf8") : null;
      if (!sw) return ["sw.js absent : l'outil ne fonctionnerait pas hors reseau"];

      const bloc = sw.match(/var FICHIERS\s*=\s*\[([\s\S]*?)\];/);
      if (!bloc) return ["sw.js → liste FICHIERS introuvable"];
      const listes = [...bloc[1].matchAll(/["']([^"']+)["']/g)]
        .map((m) => m[1].replace(/^\.\//, "")).filter((x) => x !== "");

      // 1. tout fichier reference par index.html doit etre precache
      const html = fichiers["index.html"] || "";
      const refs = [
        ...[...html.matchAll(/<script[^>]+src\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]),
        ...[...html.matchAll(/<link[^>]+href\s*=\s*["']([^"']+)["']/g)].map((m) => m[1])
      ].filter((r) => !/^(https?:)?\/\//.test(r));
      for (const r of refs) {
        if (listes.indexOf(r.replace(/^\.\//, "")) < 0) {
          fautes.push(`sw.js → ${r} est chargé par index.html mais absent du précache`);
        }
      }
      // 2. la page elle-meme et l'ecran de validation
      for (const attendu of ["index.html", "validation.html"]) {
        if (listes.indexOf(attendu) < 0) fautes.push(`sw.js → ${attendu} absent du précache`);
      }
      // 3. aucun fichier listé ne doit manquer sur le disque
      for (const l of listes) {
        if (l === "") continue;
        if (!fs.existsSync(path.join(RACINE, l))) {
          fautes.push(`sw.js → ${l} est précaché mais absent du dossier : l'installation échouerait en bloc`);
        }
      }
      // 4. le cache doit etre versionne, sinon la v2 se repete
      if (!/var CACHE\s*=\s*"[^"]*"\s*\+\s*VERSION/.test(sw)) {
        fautes.push("sw.js → le nom du cache ne porte pas la version : risque de servir une version périmée");
      }
      if (!/skipWaiting/.test(sw) || !/clients\.claim/.test(sw)) {
        fautes.push("sw.js → sans skipWaiting et clients.claim, une correction peut rester invisible");
      }
      return fautes;
    }
  },
  {
    nom: "Aucune formule de pesee dans l'interface",
    detail: "app.js saisit, affiche et exporte : aucun calcul, sinon il echappe au banc",
    verifier(fichiers) {
      const app = fichiers["app.js"] || "";
      const fautes = [];
      const interdits = [
        [/\bcorr1\s*=[^=]/, "calcul de la 1re correction d'assiette"],
        [/\bcorr2\s*=[^=]/, "calcul de la 2e correction"],
        [/\bquarter(Mean|Moule)?\s*=[^=]/, "calcul du quarter mean"],
        [/\bassietteApp\s*=[^=]/, "calcul de l'assiette apparente"],
        [/Math\.atan/, "calcul de la gite"],
        [/\*\s*100\s*\/\s*(lbp|LBP)/, "formule de correction d'assiette"]
      ];
      for (const [re, quoi] of interdits) if (re.test(app)) fautes.push(`app.js → ${quoi}`);
      return fautes;
    }
  },
  {
    nom: "Generateur de document operationnel",
    detail: "archive valide, parties Word presentes, accents preserves",
    verifier() {
      const fautes = [];
      const G = global.DocxLaHune;
      if (!G) return ["docx.js n'expose pas DocxLaHune"];
      let octets;
      try {
        octets = G.construire({
          meta: { titre: "Essai" },
          blocs: [
            { type: "titre", texte: "Rapport de pesée par tirants d'eau" },
            { type: "texte", texte: "Accents : éèêàçùôîï ÉÈÀÇ et 12 500 t." },
            { type: "tableau", entetes: ["Station", "Bâbord"], lignes: [["Arrière", "7,300"]] }
          ]
        });
      } catch (e) {
        return [`exception a la construction : ${e && e.message ? e.message : e}`];
      }
      if (!octets || octets.length < 3000) {
        fautes.push(`archive trop courte (${octets ? octets.length : 0} octets)`);
        return fautes;
      }
      if (octets[0] !== 0x50 || octets[1] !== 0x4B) fautes.push("signature ZIP absente");
      const buf = Buffer.from(octets);
      const brut = buf.toString("latin1");
      for (const partie of ["[Content_Types].xml", "_rels/.rels", "word/document.xml",
                            "word/styles.xml", "docProps/core.xml"]) {
        if (brut.indexOf(partie) < 0) fautes.push(`partie manquante → ${partie}`);
      }
      const txt = buf.toString("utf8");
      for (const mot of ["pesée", "Bâbord", "Arrière"]) {
        if (txt.indexOf(mot) < 0) fautes.push(`accents perdus → ${mot}`);
      }
      return fautes;
    }
  },
  {
    nom: "Auditeur de table operationnel",
    detail: "detecte une faute injectee, reste muet sous le seuil, muet sur table saine",
    verifier() {
      const fautes = [];
      const idx = (d) => Math.round((d - 2.50) / 0.01);
      const propre = global.HYDRO_EVERSHIP.map((r) => Object.assign({}, r));
      propre[idx(4.52)].disp = 31623;
      propre[idx(4.69)].disp = 32879;

      const saine = M.auditTable(propre);
      if (!saine.ok) {
        fautes.push(`table assainie signalee a tort (${saine.anomalies.length} anomalie(s), ` +
          `${saine.avertissements.length} avertissement(s))`);
      }

      const injectee = propre.map((r) => Object.assign({}, r));
      injectee[idx(9.00)].disp += 40;
      const ri = M.auditTable(injectee);
      const vu = ri.anomalies.filter((x) => Math.abs(x.draft - 9.00) < 1e-9).length === 1;
      if (!vu) fautes.push("faute injectee de +40 t a 9,00 m non detectee");
      if (ri.anomalies.length !== 1) fautes.push(`${ri.anomalies.length} anomalie(s) au lieu d'une seule`);

      const sousSeuil = propre.map((r) => Object.assign({}, r));
      sousSeuil[idx(11.00)].disp -= 12;
      if (M.auditTable(sousSeuil).anomalies.length !== 0) {
        fautes.push("faute de -12 t signalee alors que le seuil est a 15 t");
      }
      return fautes;
    }
  }
];

function lancerAudit() {
  const fichiers = {};
  for (const nom of FICHIERS_APP) {
    const p = path.join(RACINE, nom);
    if (fs.existsSync(p)) fichiers[nom] = fs.readFileSync(p, "utf8");
  }
  const absents = FICHIERS_APP.filter((n) => !(n in fichiers));
  const resultats = REGLES_AUDIT.map((r) => {
    let fautes = [];
    try { fautes = r.verifier(fichiers) || []; }
    catch (e) { fautes = [`exception : ${e && e.message ? e.message : e}`]; }
    return { nom: r.nom, detail: r.detail, ok: fautes.length === 0, fautes };
  });
  if (absents.length) {
    resultats.unshift({
      nom: "Presence des fichiers livres", detail: FICHIERS_APP.join(", "),
      ok: false, fautes: absents.map((n) => `fichier absent → ${n}`)
    });
  }
  return resultats;
}

// =============================================================================
// EXECUTION
// =============================================================================

const t0 = process.hrtime.bigint();
const banc = B.lancer(M, global.HYDRO_EVERSHIP);
const audit = opt.audit ? lancerAudit() : [];
const dureeMs = Number(process.hrtime.bigint() - t0) / 1e6;

const auditKo = audit.filter((a) => !a.ok).length;
const totalKo = banc.totalKo + auditKo;
const totalOk = banc.totalOk + (audit.length - auditKo);
const conforme = totalKo === 0;

// --- rapport texte ---------------------------------------------------------
function rapportTexte() {
  const L = [];
  const trait = (c = "=") => c.repeat(88);
  L.push(trait());
  L.push(`${C.gras}LA HUNE — Draft Survey : validation du moteur${C.r}`);
  L.push(`${C.gris}moteur v${M.version} · ${new Date().toLocaleString("fr-FR")}${C.r}`);
  L.push(trait());

  for (const cas of banc.cas) {
    L.push("");
    L.push(`${C.bleu}CAS ${cas.nom}${C.r}  ${C.gris}${cas.detail}${C.r}`);
    L.push(trait("-"));
    L.push(
      "grandeur".padEnd(34) + "moteur".padStart(15) + "classeur".padStart(15) +
      "ecart".padStart(12) + "  etat"
    );
    for (const l of cas.lignes) {
      const d = decimales(l.cle);
      const etat = l.ok ? `${C.vert}conforme${C.r}` : `${C.rouge}ECART${C.r}`;
      L.push(
        l.libelle.padEnd(34) + f(l.moteur, d).padStart(15) +
        f(l.classeur, d).padStart(15) + f(l.ecart, d).padStart(12) + "  " + etat
      );
    }
  }

  L.push("");
  L.push(`${C.bleu}GARDE-FOUS${C.r}  ${C.gris}ce que le moteur doit refuser de calculer${C.r}`);
  L.push(trait("-"));
  for (const g of banc.gardes) {
    const p = g.ok ? `${C.vert}[ok]${C.r}` : `${C.rouge}[KO]${C.r}`;
    L.push(`${p} ${g.nom.padEnd(42)} ${C.gris}${g.attendu}${C.r}` + (g.erreur ? ` ${C.rouge}<< ${g.erreur}${C.r}` : ""));
  }

  if (opt.audit) {
    L.push("");
    L.push(`${C.bleu}AUDIT D'ARCHITECTURE${C.r}  ${C.gris}la panne de la v2 doit rester impossible${C.r}`);
    L.push(trait("-"));
    for (const a of audit) {
      const p = a.ok ? `${C.vert}[ok]${C.r}` : `${C.rouge}[KO]${C.r}`;
      L.push(`${p} ${a.nom.padEnd(42)} ${C.gris}${a.detail}${C.r}`);
      for (const faute of a.fautes) L.push(`     ${C.rouge}→ ${faute}${C.r}`);
    }
  }

  const ch = banc.chainage, ph = banc.physique, mb = banc.modeBord;
  L.push("");
  L.push(`${C.bleu}CHAINAGE${C.r}`);
  L.push(trait("-"));
  L.push(`  ${ch.sens} : moteur ${f(ch.moteur, 2)} t · classeur ${f(ch.classeur, 2)} t · ecart ${f(ch.ecart, 2)} t`);
  L.push(`  connaissement ${f(ch.connaissement, 0)} t · ecart ${f(ch.ecartPct, 3)} % · incertitude a 0,3 % : ± ${f(ch.incertitude, 0)} t`);
  L.push("");
  L.push(`${C.bleu}CONTROLE PHYSIQUE${C.r}  ${C.gris}navire vide a la pesee initiale${C.r}`);
  L.push(trait("-"));
  L.push(`  net moins lege ${f(ph.netMoinsLege, 2)} t · constante declaree ${f(ph.constanteDeclaree, 2)} t`);
  L.push(`  residu ${f(ph.residu, 2)} t soit ${f(ph.residuPct, 5)} % du deplacement`);
  L.push("");
  L.push(`${C.bleu}MODE ARRONDIS DU BORD${C.r}  ${C.gris}reproduction de la chaine d'arrondis du classeur${C.r}`);
  L.push(trait("-"));
  L.push(`  1re corr ${f(mb.corr1, 1)} / ${f(mb.classeurCorr1, 1)}   2e corr ${f(mb.corr2, 1)} / ${f(mb.classeurCorr2, 1)}`);
  L.push(`  brut ${f(mb.dispBrut, 2)} / ${f(mb.classeurDispBrut, 2)}   net ${f(mb.net, 2)} / ${f(mb.classeurNet, 2)}`);

  L.push("");
  L.push(trait());
  const verdict = conforme
    ? `${C.vert}${C.gras}CONFORME${C.r}`
    : `${C.rouge}${C.gras}ECART DETECTE${C.r}`;
  L.push(`VERDICT : ${verdict}   ${totalOk} controle(s) conforme(s), ${totalKo} en echec   ${C.gris}${f(dureeMs, 1)} ms${C.r}`);
  L.push(trait());
  return L.join("\n");
}

// --- rapport Markdown (resume GitHub Actions) ------------------------------
function rapportMarkdown() {
  const L = [];
  const badge = conforme ? "✅ **CONFORME**" : "❌ **ÉCART DÉTECTÉ**";
  L.push(`## Draft Survey — validation du moteur`);
  L.push("");
  L.push(`${badge} · ${totalOk} contrôle(s) conforme(s), ${totalKo} en échec · moteur v${M.version} · ${f(dureeMs, 0)} ms`);
  L.push("");
  L.push(`Étalon : vraquier EVER SHIP, LBP 227,00 m, table du bord de 1 301 lignes.`);
  for (const cas of banc.cas) {
    L.push("");
    L.push(`### Cas ${cas.nom}`);
    L.push(`_${cas.detail}_`);
    L.push("");
    L.push("| Grandeur | Unité | Moteur | Classeur | Écart | État |");
    L.push("|---|---|--:|--:|--:|:--|");
    for (const l of cas.lignes) {
      const d = decimales(l.cle);
      L.push(`| ${l.libelle} | ${l.unite} | ${f(l.moteur, d)} | ${f(l.classeur, d)} | ${f(l.ecart, d)} | ${l.ok ? "✅" : "❌"} |`);
    }
  }
  L.push("");
  L.push("### Garde-fous");
  L.push("");
  L.push("| Contrôle | Attendu | État |");
  L.push("|---|---|:--|");
  for (const g of banc.gardes) {
    L.push(`| ${g.nom} | ${g.attendu} | ${g.ok ? "✅" : "❌"} |`);
  }
  if (opt.audit) {
    L.push("");
    L.push("### Audit d'architecture");
    L.push("");
    L.push("| Règle | Objet | État |");
    L.push("|---|---|:--|");
    for (const a of audit) {
      L.push(`| ${a.nom} | ${a.detail} | ${a.ok ? "✅" : "❌"} |`);
    }
    const fautes = audit.flatMap((a) => a.fautes);
    if (fautes.length) {
      L.push("");
      L.push("**Manquements relevés**");
      L.push("");
      for (const x of fautes) L.push(`- \`${x}\``);
    }
  }
  const ch = banc.chainage, ph = banc.physique, mb = banc.modeBord;
  L.push("");
  L.push("### Chaînage et contrôle physique");
  L.push("");
  L.push("| Grandeur | Valeur |");
  L.push("|---|--:|");
  L.push(`| Cargaison calculée (${ch.sens}) | ${f(ch.moteur, 2)} t |`);
  L.push(`| Cargaison portée au classeur | ${f(ch.classeur, 2)} t |`);
  L.push(`| Écart | ${f(ch.ecart, 2)} t |`);
  L.push(`| Écart au connaissement | ${f(ch.ecartPct, 3)} % |`);
  L.push(`| Incertitude de méthode à 0,3 % | ± ${f(ch.incertitude, 0)} t |`);
  L.push(`| Résidu de cargaison, navire vide | ${f(ph.residu, 2)} t |`);
  L.push(`| Résidu rapporté au déplacement | ${f(ph.residuPct, 5)} % |`);
  L.push("");
  L.push("### Mode arrondis du bord");
  L.push("");
  L.push("| Grandeur | Mode bord | Classeur |");
  L.push("|---|--:|--:|");
  L.push(`| 1re correction d'assiette | ${f(mb.corr1, 1)} | ${f(mb.classeurCorr1, 1)} |`);
  L.push(`| 2e correction (Nemoto) | ${f(mb.corr2, 1)} | ${f(mb.classeurCorr2, 1)} |`);
  L.push(`| Déplacement brut | ${f(mb.dispBrut, 2)} | ${f(mb.classeurDispBrut, 2)} |`);
  L.push(`| Déplacement net | ${f(mb.net, 2)} | ${f(mb.classeurNet, 2)} |`);
  return L.join("\n");
}

// --- proces-verbal, sans couleur, destine a un dossier ---------------------
function procesVerbal() {
  const L = [];
  L.push("LA HUNE - Cabinet d'expertise maritime independant");
  L.push("Draft Survey : proces-verbal de validation du moteur de calcul");
  L.push("");
  L.push(`Moteur          : version ${M.version}`);
  L.push(`Date du controle: ${new Date().toLocaleString("fr-FR")}`);
  L.push(`Etalon          : vraquier EVER SHIP, LBP 227,00 m, bau 38,00 m,`);
  L.push(`                  table hydrostatique du bord, 1 301 lignes au pas du centimetre`);
  L.push(`Verdict         : ${conforme ? "CONFORME" : "ECART DETECTE"}`);
  L.push(`Controles       : ${totalOk} conforme(s), ${totalKo} en echec`);
  L.push("");
  for (const cas of banc.cas) {
    L.push(`Cas ${cas.nom} : ${cas.detail}`);
    for (const l of cas.lignes) {
      const d = decimales(l.cle);
      L.push(`  ${l.ok ? "[conforme]" : "[ECART]   "} ${l.libelle} : moteur ${f(l.moteur, d)} / classeur ${f(l.classeur, d)} / ecart ${f(l.ecart, d)} ${l.unite}`);
    }
    L.push("");
  }
  L.push("Garde-fous");
  for (const g of banc.gardes) L.push(`  ${g.ok ? "[conforme]" : "[ECART]   "} ${g.nom} : ${g.attendu}`);
  L.push("");
  if (opt.audit) {
    L.push("Audit d'architecture");
    for (const a of audit) {
      L.push(`  ${a.ok ? "[conforme]" : "[ECART]   "} ${a.nom} : ${a.detail}`);
      for (const x of a.fautes) L.push(`      manquement : ${x}`);
    }
    L.push("");
  }
  const ch = banc.chainage, ph = banc.physique;
  L.push(`Chainage    : ${ch.sens} de ${f(ch.moteur, 2)} t, ecart au classeur ${f(ch.ecart, 2)} t`);
  L.push(`Controle physique : residu ${f(ph.residu, 2)} t, soit ${f(ph.residuPct, 5)} % du deplacement`);
  L.push("");
  L.push("Ce proces-verbal est genere automatiquement par le lanceur de validation.");
  return L.join("\n");
}

// --- sortie ---------------------------------------------------------------
if (opt.json) {
  process.stdout.write(JSON.stringify({
    moteur: M.version,
    date: new Date().toISOString(),
    conforme, totalOk, totalKo, dureeMs,
    cas: banc.cas.map((c) => ({
      nom: c.nom, detail: c.detail,
      lignes: c.lignes.map((l) => ({
        cle: l.cle, libelle: l.libelle, unite: l.unite,
        moteur: l.moteur, classeur: l.classeur, ecart: l.ecart, tolerance: l.tol, ok: l.ok
      }))
    })),
    gardes: banc.gardes,
    audit,
    chainage: banc.chainage,
    physique: banc.physique,
    modeBord: banc.modeBord
  }, null, 2) + "\n");
} else if (opt.md) {
  process.stdout.write(rapportMarkdown() + "\n");
} else if (opt.quiet) {
  process.stdout.write(
    `${conforme ? "CONFORME" : "ECART DETECTE"} · ${totalOk} conforme(s), ${totalKo} en echec\n`
  );
} else {
  process.stdout.write(rapportTexte() + "\n");
}

if (opt.pv) {
  fs.writeFileSync(path.join(process.cwd(), opt.pv), procesVerbal(), "utf8");
  if (!opt.json && !opt.md) process.stdout.write(`\nProces-verbal ecrit dans ${opt.pv}\n`);
}

process.exit(conforme ? 0 : 1);
