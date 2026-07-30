// =============================================================================
// LA HUNE - Draft Survey : application v3
// =============================================================================
// Aucune dependance, aucun acces reseau, aucune compilation dans le navigateur.
// Tout l'etat vit dans le navigateur de l'appareil et n'en sort jamais.
//
// Regles de precision, arretees avec l'expert :
//   tirants d'eau lus ........ 2 decimales (le centimetre, soit la lecture)
//   corrections et corriges ... 3 decimales (le millimetre)
//   quarter mean, entree table  4 decimales (ne pas degrader le point d'entree)
//   deplacement .............. 2 decimales
//   TPC, LCF, LCB, MTC ....... 3 decimales (tel que donne par la table)
//   corrections en tonnes .... 1 decimale (usage de la profession)
//   deductibles .............. 2 decimales
//   cargaison ................ 2 a l'ecran, entier au rapport, avec incertitude
// =============================================================================

(function () {
  "use strict";

  var M = window.MoteurDraftSurvey;
  if (!M) { document.body.textContent = "Moteur de calcul absent."; return; }

  // ==========================================================================
  // Stockage : local, tolerant a l'echec (mode navigation privee, iframe)
  // ==========================================================================

  var CLE = "lahune-draft-survey-v3";
  var memoire = null;

  var Stockage = {
    disponible: (function () {
      try {
        var t = "__ds_test__";
        window.localStorage.setItem(t, "1");
        window.localStorage.removeItem(t);
        return true;
      } catch (e) { return false; }
    })(),
    lire: function () {
      if (!this.disponible) return memoire;
      try {
        var b = window.localStorage.getItem(CLE);
        return b ? JSON.parse(b) : null;
      } catch (e) { return null; }
    },
    ecrire: function (o) {
      if (!this.disponible) { memoire = o; return false; }
      try { window.localStorage.setItem(CLE, JSON.stringify(o)); return true; }
      catch (e) { memoire = o; return false; }
    }
  };

  // ==========================================================================
  // Etat
  // ==========================================================================

  var CONDITIONS = [
    { cle: "initial", libelle: "Pesée initiale" },
    { cle: "controle", libelle: "Pesée de contrôle" },
    { cle: "finale", libelle: "Pesée finale" }
  ];

  var POSTES = [
    { cle: "ballast", libelle: "Ballast", densite: "1.025" },
    { cle: "eauDouce", libelle: "Eau douce", densite: "1.000" },
    { cle: "fo", libelle: "Fuel oil", densite: "0.985" },
    { cle: "do", libelle: "Diesel oil", densite: "0.860" },
    { cle: "lo", libelle: "Huile de graissage", densite: "0.900" },
    { cle: "slops", libelle: "Slops et boues", densite: "0.980" },
    { cle: "divers", libelle: "Divers", densite: "1.000" }
  ];

  // Statut de la mesure. Ce n'est pas cosmetique : en contradictoire, la
  // difference entre une soute sondee par l'expert et un chiffre donne par le
  // chef mecanicien est exactement ce qu'on lui opposera. L'outil le trace et
  // le rapport le restitue.
  var STATUTS = [
    { cle: "moi", libelle: "Sondé par moi", classe: "st-moi" },
    { cle: "bord", libelle: "Sondé par le bord", classe: "st-bord" },
    { cle: "declare", libelle: "Déclaré par le bord", classe: "st-bord" },
    { cle: "estime", libelle: "Estimé", classe: "st-est" },
    { cle: "nonsondable", libelle: "Non sondable", classe: "st-est" }
  ];
  function libelleStatut(cle) {
    var s = STATUTS.filter(function (x) { return x.cle === cle; })[0];
    return s ? s.libelle : cle;
  }
  function classeStatut(cle) {
    var s = STATUTS.filter(function (x) { return x.cle === cle; })[0];
    return s ? s.classe : "st-est";
  }
  function libellePoste(cle) {
    var p = POSTES.filter(function (x) { return x.cle === cle; })[0];
    return p ? p.libelle : cle;
  }

  function navireVide() {
    return {
      id: "nav-" + Date.now().toString(36),
      nom: "", pavillon: "", lbp: "", bau: "", toleQuille: "0",
      densiteTable: "1.025", lege: "", constante: "",
      conventionLcf: "",
      marqueAv: { distance: "", position: "arriere" },
      marqueMi: { distance: "0", position: "arriere" },
      marqueAr: { distance: "", position: "avant" },
      hydro: null,
      hydroMeta: null,
      // Registre de tanks, propre au navire et duplique avec lui. Facultatif :
      // il ne sert que si un poste est saisi tank par tank.
      tanks: []
    };
  }

  // --- registre de tanks ----------------------------------------------------

  function tanksDuPoste(n, poste) {
    if (!n || !n.tanks) return [];
    return n.tanks.filter(function (t) { return t.poste === poste; });
  }

  function analyserBareme(brut) {
    var out = [];
    String(brut || "").split(/\r?\n/).forEach(function (l) {
      if (!l.trim()) return;
      var p = l.split(/[\t;,]|\s{2,}|\s+/).filter(function (x) { return x.trim() !== ""; });
      if (p.length < 2) return;
      var sonde = M.lire(p[0]), vol = M.lire(p[1]);
      if (sonde === null || vol === null) return;
      out.push({ s: sonde, v: vol });
    });
    out.sort(function (a, b) { return a.s - b.s; });
    return out;
  }

  // Interpolation lineaire dans le bareme. Hors plage : null, jamais
  // d'extrapolation, meme regle que pour la table hydrostatique.
  function volumeParSonde(tank, sonde) {
    var b = tank.bareme || [];
    if (b.length < 2 || sonde === null) return null;
    if (sonde < b[0].s - 1e-9 || sonde > b[b.length - 1].s + 1e-9) return null;
    for (var i = 1; i < b.length; i++) {
      if (sonde <= b[i].s + 1e-9) {
        var lo = b[i - 1], hi = b[i];
        if (hi.s === lo.s) return lo.v;
        return lo.v + ((sonde - lo.s) / (hi.s - lo.s)) * (hi.v - lo.v);
      }
    }
    return b[b.length - 1].v;
  }

  // Tonnage d'un poste pour une condition donnee.
  // Renvoie { tonnes, mode, detail: [...], erreurs: [...] }
  function tonnagePoste(n, cond, poste) {
    var r = { tonnes: 0, mode: (cond.modes && cond.modes[poste]) || "global", detail: [], erreurs: [] };
    if (r.mode === "global") {
      var brut = cond.deductibles[poste];
      var v = M.lire(brut);
      if (String(brut).trim() !== "" && v === null) {
        r.erreurs.push("Total " + libellePoste(poste) + " illisible : « " + brut + " »");
        r.tonnes = null;
        r.illisible = brut;
        return r;
      }
      r.tonnes = v === null ? 0 : v;
      return r;
    }
    var tks = tanksDuPoste(n, poste);
    if (!tks.length) {
      r.erreurs.push(libellePoste(poste) + " : saisie par tank demandée, mais aucun tank au registre");
      return r;
    }
    tks.forEach(function (tk) {
      var sa = cond.tanks[tk.id] || {};
      var densBrute = (sa.densite !== undefined && String(sa.densite).trim() !== "") ? sa.densite : tk.densite;
      var dens = M.lire(densBrute);
      if (dens === null) {
        r.erreurs.push("Tank « " + tk.nom + " » : densité illisible « " + densBrute + " »");
        dens = null;
      }
      var saisie = String(sa.valeur === undefined ? "" : sa.valeur).trim();
      var val = M.lire(saisie);
      var tonnes = null, motif = "";

      if (saisie !== "" && val === null) {
        r.erreurs.push("Tank « " + tk.nom + " » : valeur illisible « " + saisie + " »");
        r.illisible = saisie;
      } else if (val !== null && dens !== null) {
        if (tk.mode === "tonnage") {
          tonnes = val;
          motif = "tonnage direct";
        } else if (tk.mode === "volume") {
          tonnes = val * dens;
          motif = nb(val, 3) + " m³ × " + nb(dens, 4);
        } else {
          var vol = volumeParSonde(tk, val);
          if (vol === null) {
            r.erreurs.push("Tank « " + tk.nom + " » : sonde " + saisie +
              " hors barème, ou barème absent. Aucun tonnage retenu.");
          } else {
            tonnes = vol * dens;
            motif = "sonde " + nb(val, 1) + " → " + nb(vol, 3) + " m³ × " + nb(dens, 4);
          }
        }
      }
      if (tonnes !== null && r.tonnes !== null) r.tonnes += tonnes;
      r.detail.push({
        tank: tk, tonnes: tonnes, motif: motif,
        statut: sa.statut || "moi", obs: sa.obs || ""
      });
    });
    return r;
  }

  function deductiblesCondition(n, cond) {
    var res = { total: 0, parPoste: {}, erreurs: [], illisibles: [] };
    POSTES.forEach(function (p) {
      var t = tonnagePoste(n, cond, p.cle);
      res.parPoste[p.cle] = t;
      if (t.tonnes !== null) res.total += t.tonnes;
      if (t.illisible !== undefined) {
        res.illisibles.push({ cle: p.cle, brut: t.illisible });
      }
      res.erreurs = res.erreurs.concat(t.erreurs);
    });
    return res;
  }

  function conditionVide(cle) {
    var d = { cle: cle, date: "", heure: "", port: "", observation: "" };
    ["avBb", "avTb", "miBb", "miTb", "arBb", "arTb"].forEach(function (k) { d[k] = ""; });
    d.densiteBassin = "";
    d.appliquerGite = false;
    // Derogation optionnelle sur la marque milieu. Les marques sont soudees a
    // la coque, donc leur position ne varie pas. Mais un expert peut relever un
    // repere different d'une pesee a l'autre, et le classeur de reference le
    // fait. Laisse vide, la valeur du profil navire s'applique.
    d.miDistance = "";
    d.miPosition = "arriere";
    d.deductibles = {};
    // Mode de saisie par poste : total global, ou tank par tank. Le choix est
    // independant d'un poste a l'autre : en pratique les ballasts se sondent
    // tank par tank et les huiles se prennent en total declare, dans la meme
    // pesee.
    d.modes = {};
    POSTES.forEach(function (p) { d.deductibles[p.cle] = ""; d.modes[p.cle] = "global"; });
    // Saisies par tank, indexees par identifiant de tank du registre navire.
    d.tanks = {};
    return d;
  }

  function etatVide() {
    var e = {
      version: 3,
      vue: "navire",
      navires: [],
      navireActif: null,
      dossier: {
        reference: "", cargaison: "", connaissement: "", port: "", expert: "",
        departPesee: "initial", arriveePesee: "controle",
        tauxIncertitude: "0.3"
      },
      conditions: {}
    };
    CONDITIONS.forEach(function (c) { e.conditions[c.cle] = conditionVide(c.cle); });
    return e;
  }

  var S = Stockage.lire() || etatVide();
  if (!S.conditions) S = etatVide();
  CONDITIONS.forEach(function (c) {
    if (!S.conditions[c.cle]) S.conditions[c.cle] = conditionVide(c.cle);
    var d = S.conditions[c.cle];
    if (!d.modes) d.modes = {};
    if (!d.tanks) d.tanks = {};
    POSTES.forEach(function (p) { if (!d.modes[p.cle]) d.modes[p.cle] = "global"; });
  });
  if (!S.dossier) S.dossier = etatVide().dossier;

  var derniereEcritureOk = true;
  function sauver() {
    derniereEcritureOk = Stockage.ecrire(S);
  }

  function navire() {
    if (!S.navireActif) return null;
    for (var i = 0; i < S.navires.length; i++) {
      if (S.navires[i].id === S.navireActif) return S.navires[i];
    }
    return null;
  }

  // ==========================================================================
  // Formatage
  // ==========================================================================

  var DEC = {
    lecture: 2, correction: 3, entree: 4, deplacement: 2,
    hydro: 3, tonnesCorr: 1, deductible: 2, cargaison: 2, densite: 4
  };

  function nb(v, d) {
    if (typeof v !== "number" || !isFinite(v)) return "—";
    var s = Math.abs(v).toFixed(d);
    var p = s.split(".");
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, "\u202F");
    return (v < 0 ? "\u2212" : "") + p.join(",");
  }
  function ech(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ==========================================================================
  // Import de la table hydrostatique
  // ==========================================================================
  //
  // On ne devine JAMAIS l'ordre des colonnes. Le parseur decoupe en matrice
  // numerique, propose une affectation, et l'expert confirme. Un tableau
  // dont on aurait interverti MTC et LCF calculerait faux sans rien signaler.

  var importation = null; // { matrice, colonnes, affectation, apercu }

  var ROLES = [
    { cle: "draft", libelle: "Tirant d'eau (m)" },
    { cle: "disp", libelle: "Déplacement (t)" },
    { cle: "tpc", libelle: "TPC (t/cm)" },
    { cle: "mtc", libelle: "MTC (t.m/cm)" },
    { cle: "lcf", libelle: "LCF (m)" },
    { cle: "lcb", libelle: "LCB (m)" },
    { cle: "", libelle: "— ignorer —" }
  ];

  function decouper(brut) {
    var lignes = String(brut).replace(/\u00A0/g, " ").split(/\r?\n/);
    var matrice = [], rejetees = 0, largeurs = {};
    lignes.forEach(function (ligne) {
      if (!ligne.trim()) return;
      var parts = ligne.split(/\t|;|\s{2,}|,(?=\s)|\s+/).filter(function (x) { return x !== ""; });
      var nums = parts.map(function (x) { return M.lire(x); });
      if (nums.length < 2 || nums.some(function (n) { return n === null; })) { rejetees++; return; }
      matrice.push(nums);
      largeurs[nums.length] = (largeurs[nums.length] || 0) + 1;
    });
    // on ne garde que les lignes de la largeur dominante
    var dominante = 0, meilleur = -1;
    Object.keys(largeurs).forEach(function (k) {
      if (largeurs[k] > meilleur) { meilleur = largeurs[k]; dominante = parseInt(k, 10); }
    });
    var retenues = matrice.filter(function (r) { return r.length === dominante; });
    rejetees += matrice.length - retenues.length;
    return { matrice: retenues, colonnes: dominante, rejetees: rejetees };
  }

  // Proposition d'affectation, a confirmer par l'expert.
  function proposer(matrice, nbCol) {
    var prof = [];
    for (var c = 0; c < nbCol; c++) {
      var col = matrice.map(function (r) { return r[c]; });
      var min = Math.min.apply(null, col), max = Math.max.apply(null, col);
      // Monotonie TOLERANTE : on accepte jusqu'a 2 % de ruptures. Les tables du
      // bord contiennent des fautes de frappe, et une colonne deplacement rendue
      // non monotone par deux coquilles doit rester reconnue comme telle.
      var ruptures = 0;
      for (var i = 1; i < col.length; i++) if (col[i] < col[i - 1] - 1e-9) ruptures++;
      var croissante = ruptures <= Math.max(2, Math.floor(col.length * 0.02));
      var stricte = ruptures === 0;
      var negatifs = col.some(function (v) { return v < 0; });
      prof.push({
        c: c, min: min, max: max, croissante: croissante, stricte: stricte,
        ruptures: ruptures, negatifs: negatifs, amplitude: max - min
      });
    }
    var aff = new Array(nbCol).fill("");
    var pris = {};
    function poser(role, test) {
      if (pris[role]) return;
      var cands = prof.filter(function (p) { return aff[p.c] === "" && test(p); });
      if (!cands.length) return;
      aff[cands[0].c] = role;
      pris[role] = true;
    }
    // tirant d'eau : strictement croissant, borne entre 0 et 40 m
    poser("draft", function (p) { return p.stricte && p.min >= 0 && p.max <= 40; });
    if (!pris.draft) poser("draft", function (p) { return p.croissante && p.min >= 0 && p.max <= 40; });
    // deplacement : croissant, la plus grande amplitude de la table
    var restants = prof.filter(function (p) { return aff[p.c] === "" && p.croissante; })
      .sort(function (a, b) { return b.amplitude - a.amplitude; });
    if (restants.length) { aff[restants[0].c] = "disp"; pris.disp = true; }
    // TPC : valeurs positives modestes
    poser("tpc", function (p) { return !p.negatifs && p.max <= 500 && p.min > 0; });
    // MTC : valeurs positives elevees
    poser("mtc", function (p) { return !p.negatifs && p.max > 100; });
    // LCB puis LCF : petites valeurs, souvent negatives
    poser("lcb", function (p) { return Math.abs(p.max) <= 60 && Math.abs(p.min) <= 60; });
    poser("lcf", function (p) { return Math.abs(p.max) <= 60 && Math.abs(p.min) <= 60; });
    return { affectation: aff, profils: prof };
  }

  function construireTable(matrice, affectation) {
    var idx = {};
    affectation.forEach(function (role, c) { if (role) idx[role] = c; });
    if (idx.draft === undefined || idx.disp === undefined) return null;
    return matrice.map(function (r) {
      return {
        draft: r[idx.draft],
        disp: r[idx.disp],
        tpc: idx.tpc !== undefined ? r[idx.tpc] : null,
        mtc: idx.mtc !== undefined ? r[idx.mtc] : null,
        lcf: idx.lcf !== undefined ? r[idx.lcf] : null,
        lcb: idx.lcb !== undefined ? r[idx.lcb] : null
      };
    });
  }

  // ==========================================================================
  // Calcul
  // ==========================================================================

  function navirePourMoteur(n) {
    if (!n || !n.hydro) return null;
    return {
      lbp: n.lbp, bau: n.bau, toleQuille: n.toleQuille,
      densiteTable: n.densiteTable, lege: n.lege,
      conventionLcf: n.conventionLcf,
      marqueAv: n.marqueAv, marqueMi: n.marqueMi, marqueAr: n.marqueAr,
      hydroPrete: M.prepareTable(n.hydro)
    };
  }

  function calculer(cleCondition) {
    var n = navire();
    var nm = navirePourMoteur(n);
    if (!nm) return null;
    var c = S.conditions[cleCondition];
    var rempli = ["avBb", "avTb", "miBb", "miTb", "arBb", "arTb"].every(function (k) {
      return M.lire(c[k]) !== null;
    });
    if (!rempli) return null;
    if (String(c.miDistance).trim() !== "") {
      nm.marqueMi = { distance: c.miDistance, position: c.miPosition || "arriere" };
    }
    // Les deductibles sont agregees ici (total global ou somme des tanks) puis
    // transmises au moteur en un poste unique. Le moteur ne connait pas les
    // tanks : il ne doit connaitre que des tonnages.
    var ded = deductiblesCondition(n, c);
    // Une saisie illisible est transmise telle quelle au moteur, sous la cle du
    // poste concerne : c'est le moteur qui prononce le blocage, pas l'interface.
    // La regle de refus reste donc dans le fichier couvert par le banc de test.
    var dedMoteur = { total: ded.total };
    ded.illisibles.forEach(function (x) { dedMoteur[libellePoste(x.cle)] = x.brut; });
    var r = M.pesee(nm, {
      avBb: c.avBb, avTb: c.avTb, miBb: c.miBb, miTb: c.miTb, arBb: c.arBb, arTb: c.arTb,
      densiteBassin: c.densiteBassin,
      appliquerGite: !!c.appliquerGite,
      deductibles: dedMoteur
    });
    r.detailDeductibles = ded;
    if (ded.erreurs.length) {
      r.alertes = (r.alertes || []).concat(ded.erreurs);
    }
    // Derogation de marque milieu : tracee dans le journal, pas seulement appliquee.
    if (String(c.miDistance).trim() !== "" && r.journal) {
      r.journal.unshift("derogation marque milieu propre a cette pesee : " +
        nb(M.lire(c.miDistance), 3) + " m " +
        (c.miPosition === "avant" ? "en avant du milieu" : "en arriere du milieu"));
      r.derogationMi = {
        distance: M.lire(c.miDistance),
        position: c.miPosition === "avant" ? "en avant du milieu" : "en arrière du milieu"
      };
    }
    return r;
  }

  // ==========================================================================
  // Fabriques de balisage
  // ==========================================================================

  function champ(o) {
    return '<label class="champ">' +
      '<span class="champ-tete"><span class="champ-lbl">' + ech(o.libelle) + '</span>' +
      (o.unite ? '<span class="champ-unite">' + ech(o.unite) + '</span>' : '') + '</span>' +
      '<input type="text" inputmode="' + (o.texte ? "text" : "decimal") + '"' +
      (o.texte ? ' class="texte"' : '') +
      ' data-set="' + o.chemin + '" value="' + ech(o.valeur == null ? "" : o.valeur) + '"' +
      (o.placeholder ? ' placeholder="' + ech(o.placeholder) + '"' : '') +
      (o.invalide ? ' aria-invalid="true"' : '') + ' />' +
      (o.note ? '<span class="champ-note' + (o.invalide ? " err" : "") + '">' + ech(o.note) + '</span>' : '') +
      '</label>';
  }

  function selecteur(o) {
    var opts = o.options.map(function (x) {
      return '<option value="' + ech(x.cle) + '"' + (x.cle === o.valeur ? " selected" : "") + '>' +
        ech(x.libelle) + '</option>';
    }).join("");
    return '<label class="champ">' +
      '<span class="champ-tete"><span class="champ-lbl">' + ech(o.libelle) + '</span></span>' +
      '<select data-set="' + o.chemin + '">' +
      (o.vide ? '<option value=""' + (!o.valeur ? " selected" : "") + '>' + ech(o.vide) + '</option>' : '') +
      opts + '</select>' +
      (o.note ? '<span class="champ-note' + (o.invalide ? " err" : "") + '">' + ech(o.note) + '</span>' : '') +
      '</label>';
  }

  function marque(libelle, cheminBase, valeur, libAvant, libArriere, note) {
    return '<div class="champ">' +
      '<span class="champ-tete"><span class="champ-lbl">' + ech(libelle) + '</span>' +
      '<span class="champ-unite">m</span></span>' +
      '<input type="text" inputmode="decimal" data-set="' + cheminBase + '.distance" value="' +
      ech(valeur.distance) + '" placeholder="distance en valeur absolue" />' +
      '<div class="bascule" style="margin-top:6px">' +
      '<button type="button" data-pos="' + cheminBase + '|avant" aria-pressed="' +
      (valeur.position === "avant") + '">' + ech(libAvant) + '</button>' +
      '<button type="button" data-pos="' + cheminBase + '|arriere" aria-pressed="' +
      (valeur.position === "arriere") + '">' + ech(libArriere) + '</button>' +
      '</div>' +
      (note ? '<span class="champ-note">' + ech(note) + '</span>' : '') +
      '</div>';
  }

  function ligne(libelle, valeur, unite, classe) {
    return '<tr' + (classe ? ' class="' + classe + '"' : '') + '><td>' + ech(libelle) + '</td>' +
      '<td' + (typeof valeur === "number" && valeur < 0 ? ' class="neg"' : '') + '>' +
      (typeof valeur === "string" ? ech(valeur) : valeur) + '</td>' +
      '<td class="champ-unite">' + ech(unite || "") + '</td></tr>';
  }

  function messages(r) {
    var h = "";
    if (r.bloquants && r.bloquants.length) {
      h += '<div class="msg bloquant"><strong>Calcul interrompu.</strong><ul>' +
        r.bloquants.map(function (m) { return "<li>" + ech(m) + "</li>"; }).join("") + "</ul></div>";
    }
    if (r.alertes && r.alertes.length) {
      h += '<div class="msg alerte"><strong>À vérifier.</strong><ul>' +
        r.alertes.map(function (m) { return "<li>" + ech(m) + "</li>"; }).join("") + "</ul></div>";
    }
    return h;
  }

  // ==========================================================================
  // Vue : navire
  // ==========================================================================

  function vueNavire() {
    var n = navire();
    var h = "";

    h += '<h2 class="section">Profils enregistrés</h2>';
    h += '<div class="carte plate">';
    if (!S.navires.length) {
      h += '<div class="vide">Aucun profil. Créez-en un pour commencer.</div>';
    } else {
      S.navires.forEach(function (v) {
        var etat = v.hydro
          ? '<span class="pastille ok">table ' + v.hydro.length + ' lignes</span>'
          : '<span class="pastille att">table absente</span>';
        h += '<div class="liste-item' + (v.id === S.navireActif ? " actif" : "") + '">' +
          '<div class="liste-corps"><div class="liste-nom">' + ech(v.nom || "Sans nom") + '</div>' +
          '<div class="liste-detail">LBP ' + ech(v.lbp || "?") + ' m · bau ' + ech(v.bau || "?") + ' m</div></div>' +
          etat +
          (v.id === S.navireActif ? '' : '<button class="act sec mini" data-choisir="' + v.id + '">Ouvrir</button>') +
          '<button class="act sec mini" data-dupliquer="' + v.id + '">Dupliquer</button>' +
          '<button class="act danger mini" data-suppr="' + v.id + '">Supprimer</button>' +
          '</div>';
      });
    }
    h += '</div>';
    h += '<div class="barre-actions"><button class="act" data-neuf="1">Nouveau profil</button></div>';

    if (!n) return h;

    h += '<h2 class="section">Identification</h2>';
    h += '<div class="carte"><div class="grille g2">' +
      champ({ libelle: "Nom du navire", chemin: "navire.nom", valeur: n.nom, texte: true }) +
      champ({ libelle: "Pavillon", chemin: "navire.pavillon", valeur: n.pavillon, texte: true }) +
      '</div></div>';

    var lbp = M.lire(n.lbp);
    h += '<h2 class="section">Caractéristiques</h2>';
    h += '<div class="carte"><div class="grille g3">' +
      champ({ libelle: "LBP", unite: "m", chemin: "navire.lbp", valeur: n.lbp,
              invalide: n.lbp !== "" && lbp === null,
              note: n.lbp !== "" && lbp === null ? "valeur illisible" : "" }) +
      champ({ libelle: "Bau", unite: "m", chemin: "navire.bau", valeur: n.bau,
              note: "sert au calcul de la gîte" }) +
      champ({ libelle: "Tôle de quille", unite: "m", chemin: "navire.toleQuille", valeur: n.toleQuille,
              note: "0 si la table est en tirants extrêmes" }) +
      champ({ libelle: "Déplacement lège", unite: "t", chemin: "navire.lege", valeur: n.lege }) +
      champ({ libelle: "Constante du bord", unite: "t", chemin: "navire.constante", valeur: n.constante,
              note: "s'élimine par différence" }) +
      champ({ libelle: "Densité de la table", unite: "", chemin: "navire.densiteTable", valeur: n.densiteTable,
              note: "1,025 en eau de mer" }) +
      '</div></div>';

    h += '<h2 class="section">Position des marques</h2>';
    h += '<p class="aide">Saisissez la distance en valeur absolue et déclarez la position. ' +
      'Le signe est déduit, jamais tapé. Un seul axe interne, positif vers l\'avant.</p>';
    h += '<div class="carte"><div class="grille g3">' +
      marque("Marque avant, par rapport à la FP", "navire.marqueAv", n.marqueAv,
             "en avant de la FP", "en arrière de la FP", "cas courant : en arrière") +
      marque("Marque milieu, par rapport au milieu", "navire.marqueMi", n.marqueMi,
             "en avant du milieu", "en arrière du milieu", "0 si confondue avec le milieu") +
      marque("Marque arrière, par rapport à l'AP", "navire.marqueAr", n.marqueAr,
             "en avant de l'AP", "en arrière de l'AP", "cas courant : en avant") +
      '</div>';
    if (lbp && M.lire(n.marqueAv.distance) !== null && M.lire(n.marqueAr.distance) !== null) {
      var xa = M.offsetMarque(n.marqueAv.distance, n.marqueAv.position).valeur;
      var xr = M.offsetMarque(n.marqueAr.distance, n.marqueAr.position).valeur;
      var lbm = lbp + xa - xr;
      h += '<div class="msg' + (lbm > 0 ? "" : " bloquant") + '">LBM calculée : <strong>' +
        nb(lbm, 3) + ' m</strong>' + (lbm > 0 ? "" : " — vérifiez les distances") + '</div>';
    }
    h += '</div>';

    h += '<h2 class="section">Convention du LCF</h2>';
    h += '<p class="aide">Premier poste d\'erreur du métier. Les chantiers n\'utilisent pas la même ' +
      'référence, et une inversion vaut ici plusieurs centaines de tonnes. Aucune valeur par défaut : ' +
      'lisez l\'en-tête de la table du bord et déclarez-la.</p>';
    h += '<div class="carte">' + selecteur({
      libelle: "Le LCF de la table est donné", chemin: "navire.conventionLcf",
      valeur: n.conventionLcf, vide: "— à déclarer —",
      invalide: !n.conventionLcf,
      note: n.conventionLcf ? "" : "sans cette déclaration, le calcul est bloqué",
      options: Object.keys(M.CONVENTIONS_LCF).map(function (k) {
        return { cle: k, libelle: M.CONVENTIONS_LCF[k] };
      })
    }) + '</div>';

    h += '<h2 class="section">Table hydrostatique</h2>';
    h += vueTable(n);

    h += '<h2 class="section">Registre de tanks</h2>';
    h += '<p class="aide">Facultatif. Ne sert que si vous voulez saisir un poste tank par tank ' +
      'plutôt qu\'en total. Le registre appartient au navire : il se duplique avec lui, ce qui ' +
      'évite de le retaper sur un navire jumeau. Les noms sont libres, pour coller à la ' +
      'nomenclature du bord.</p>';
    POSTES.forEach(function (p) {
      var tks = tanksDuPoste(n, p.cle);
      h += '<div class="poste"><div class="poste-tete">' +
        '<span class="poste-nom">' + ech(p.libelle) + '</span>' +
        '<span class="pastille">' + tks.length + ' tank' + (tks.length > 1 ? 's' : '') + '</span>' +
        '<button type="button" class="bouton petit" data-tank-add="' + p.cle + '">Ajouter un tank</button>' +
        '</div>';
      if (tks.length) {
        h += '<div class="poste-corps">';
        tks.forEach(function (tk) {
          h += '<div class="tank">' +
            '<div class="tank-tete">' +
            '<input type="text" class="tank-nom" data-set="tank.' + tk.id + '.nom" value="' +
            ech(tk.nom) + '" placeholder="Nom du tank" aria-label="Nom du tank" />' +
            '<button type="button" class="bouton petit danger" data-tank-del="' + tk.id + '">Retirer</button>' +
            '</div>' +
            '<div class="grille g2">' +
            selecteur({ libelle: "Mode de saisie", chemin: "tank." + tk.id + ".mode", valeur: tk.mode,
              options: [
                { cle: "tonnage", libelle: "Tonnage direct" },
                { cle: "volume", libelle: "Volume × densité" },
                { cle: "sonde", libelle: "Sonde puis barème" }
              ] }) +
            champ({ libelle: "Densité par défaut", chemin: "tank." + tk.id + ".densite",
                    valeur: tk.densite, note: "modifiable pesée par pesée" }) +
            '</div>';
          if (tk.mode === "sonde") {
            var nbPts = (tk.bareme || []).length;
            h += '<label class="champ" style="margin-top:10px">' +
              '<span class="champ-tete"><span class="champ-lbl">Barème du tank</span>' +
              '<span class="champ-unite" id="bar-' + tk.id + '">' +
              (nbPts ? nbPts + ' points' : 'vide') + '</span></span>' +
              '<textarea data-set="tank.' + tk.id + '.baremeBrut" rows="4" ' +
              'placeholder="sonde&#9;volume&#10;0&#9;0&#10;50&#9;120,5">' + ech(tk.baremeBrut || "") + '</textarea>' +
              '<span class="champ-note">Deux colonnes, sonde puis volume. Interpolation linéaire entre ' +
              'les points, et refus hors plage : même règle que pour la table hydrostatique.</span></label>';
          }
          h += '</div>';
        });
        h += '</div>';
      }
      h += '</div>';
    });
    return h;
  }

  function vueTable(n) {
    var h = "";
    if (n.hydro && !importation) {
      var meta = n.hydroMeta || {};
      var a = M.auditTable(n.hydro);
      h += '<div class="carte">' +
        '<table class="res"><tbody>' +
        ligne("Lignes retenues", n.hydro.length, "") +
        ligne("Pas de tirant d'eau", a.pas, "m") +
        ligne("Plage couverte", nb(n.hydro[0].draft, 2) + " à " + nb(n.hydro[n.hydro.length - 1].draft, 2), "m") +
        ligne("Colonnes affectées", (meta.roles || []).join(", "), "") +
        '</tbody></table>';
      if (a.anomalies.length) {
        h += '<div class="msg alerte"><strong>' + a.anomalies.length +
          ' ligne(s) suspecte(s) dans la colonne déplacement.</strong> ' +
          'Valeur cohérente reconstruite par la tendance locale. La correction ne se fait pas ' +
          'd\'office : c\'est un document du bord.<ul>' +
          a.anomalies.slice(0, 12).map(function (x) {
            return "<li>" + nb(x.draft, 2) + " m : portée " + nb(x.valeur, 0) +
              " t, cohérente " + nb(x.proposee, 0) + " t, écart " + nb(x.ecart, 0) + " t</li>";
          }).join("") + "</ul></div>";
      }
      if (a.avertissements.length) {
        h += '<div class="msg alerte"><strong>Avertissements.</strong><ul>' +
          a.avertissements.slice(0, 8).map(function (x) { return "<li>" + ech(x) + "</li>"; }).join("") +
          "</ul></div>";
      }
      if (a.ok) h += '<div class="msg ok">Table auditée, aucune incohérence relevée.</div>';
      h += '<div class="barre-actions">' +
        '<button class="act sec" data-remplacer="1">Remplacer la table</button></div>';
      h += '</div>';
      return h;
    }

    if (!importation) {
      h += '<div class="carte">' +
        '<p class="aide">Collez la table du bord, une ligne par tirant d\'eau. Tabulations, ' +
        'points-virgules ou espaces multiples sont acceptés. Vous affecterez les colonnes ensuite.</p>' +
        '<textarea id="collage" placeholder="2.50&#9;16924&#9;71.5&#9;932.5&#9;-10.52&#9;-10.02"></textarea>' +
        '<div class="barre-actions"><button class="act" data-analyser="1">Analyser le collage</button>' +
        (n.hydro ? '<button class="act sec" data-annuler-import="1">Annuler</button>' : '') +
        '</div></div>';
      return h;
    }

    // etape d'affectation des colonnes
    var im = importation;
    h += '<div class="carte">';
    h += '<div class="msg"><strong>' + im.matrice.length + ' ligne(s) exploitable(s), ' +
      im.colonnes + ' colonne(s).</strong>' +
      (im.rejetees ? " " + im.rejetees + " ligne(s) écartée(s), en-têtes ou lignes incomplètes." : "") +
      '</div>';
    h += '<p class="aide">Vérifiez l\'affectation proposée. Tirant d\'eau et déplacement sont ' +
      'indispensables. Sans TPC ni MTC, les corrections d\'assiette ne pourront pas être calculées.</p>';
    h += '<div class="grille g3">';
    for (var c = 0; c < im.colonnes; c++) {
      var p = im.profils[c];
      h += selecteur({
        libelle: "Colonne " + (c + 1),
        chemin: "import." + c,
        valeur: im.affectation[c],
        options: ROLES.filter(function (r) { return r.cle !== ""; }),
        vide: "— ignorer —",
        note: "de " + nb(p.min, 2) + " à " + nb(p.max, 2) + (p.croissante ? ", croissante" : "")
      });
    }
    h += '</div>';

    h += '<div class="tab-defile" style="margin-top:12px"><table class="res"><thead><tr>';
    for (var k = 0; k < im.colonnes; k++) {
      var role = im.affectation[k];
      var lib = ROLES.filter(function (r) { return r.cle === role; })[0];
      h += '<th>' + ech(lib && role ? lib.libelle : "ignorée") + '</th>';
    }
    h += '</tr></thead><tbody>';
    im.matrice.slice(0, 5).forEach(function (r) {
      h += '<tr>' + r.map(function (v) { return "<td>" + nb(v, 2) + "</td>"; }).join("") + "</tr>";
    });
    h += '</tbody></table></div>';

    var doublons = {};
    var conflit = false;
    im.affectation.forEach(function (r) {
      if (!r) return;
      if (doublons[r]) conflit = true;
      doublons[r] = true;
    });
    if (conflit) h += '<div class="msg bloquant">Un même rôle est affecté à deux colonnes.</div>';
    if (!doublons.draft || !doublons.disp) {
      h += '<div class="msg bloquant">Tirant d\'eau et déplacement doivent être affectés.</div>';
    }
    h += '<div class="barre-actions">' +
      '<button class="act" data-valider-import="1"' +
      (conflit || !doublons.draft || !doublons.disp ? " disabled" : "") +
      '>Valider et auditer la table</button>' +
      '<button class="act sec" data-annuler-import="1">Annuler</button></div>';
    h += '</div>';
    return h;
  }

  // ==========================================================================
  // Vue : pesees
  // ==========================================================================

  function prerequis() {
    var n = navire();
    if (!n) return ["Aucun profil navire ouvert."];
    var m = [];
    if (M.lire(n.lbp) === null) m.push("La LBP n'est pas renseignée.");
    if (!n.conventionLcf) m.push("La convention du LCF n'est pas déclarée.");
    if (!n.hydro) m.push("La table hydrostatique n'est pas chargée.");
    if (M.lire(n.marqueAv.distance) === null) m.push("La distance de la marque avant n'est pas renseignée.");
    if (M.lire(n.marqueAr.distance) === null) m.push("La distance de la marque arrière n'est pas renseignée.");
    return m;
  }

  function vuePesees() {
    var n = navire();
    var manque = prerequis();
    if (manque.length) {
      return '<div class="msg bloquant"><strong>Profil navire incomplet.</strong><ul>' +
        manque.map(function (x) { return "<li>" + ech(x) + "</li>"; }).join("") +
        '</ul></div>';
    }

    var h = "";
    CONDITIONS.forEach(function (cd) {
      var c = S.conditions[cd.cle];
      h += '<h2 class="section">' + ech(cd.libelle) + '</h2>';
      h += '<div class="carte">';
      h += '<div class="grille g3">' +
        champ({ libelle: "Date", chemin: "cond." + cd.cle + ".date", valeur: c.date, texte: true, placeholder: "20/12/2019" }) +
        champ({ libelle: "Heure", chemin: "cond." + cd.cle + ".heure", valeur: c.heure, texte: true, placeholder: "2230-2330" }) +
        champ({ libelle: "Port", chemin: "cond." + cd.cle + ".port", valeur: c.port, texte: true }) +
        '</div>';

      h += '<div class="grille g3" style="margin-top:12px">';
      [["av", "Avant"], ["mi", "Milieu"], ["ar", "Arrière"]].forEach(function (st) {
        h += '<div class="grille" style="gap:8px">' +
          champ({ libelle: st[1] + " bâbord", unite: "m", chemin: "cond." + cd.cle + "." + st[0] + "Bb", valeur: c[st[0] + "Bb"] }) +
          champ({ libelle: st[1] + " tribord", unite: "m", chemin: "cond." + cd.cle + "." + st[0] + "Tb", valeur: c[st[0] + "Tb"] }) +
          '</div>';
      });
      h += '</div>';

      h += '<div class="grille g2" style="margin-top:12px">' +
        champ({ libelle: "Densité du bassin", chemin: "cond." + cd.cle + ".densiteBassin", valeur: c.densiteBassin,
                note: "mesurée au densimètre" }) +
        '<div class="champ"><span class="champ-tete"><span class="champ-lbl">Correction de gîte</span></span>' +
        '<div class="bascule">' +
        '<button type="button" data-gite="' + cd.cle + '|1" aria-pressed="' + (!!c.appliquerGite) + '">Appliquer</button>' +
        '<button type="button" data-gite="' + cd.cle + '|0" aria-pressed="' + (!c.appliquerGite) + '">Ne pas appliquer</button>' +
        '</div><span class="champ-note">toujours positive, exige la table complète</span></div>' +
        '</div>';

      var derog = String(c.miDistance).trim() !== "";
      // La derogation active est ecrite en clair dans le resume replie : elle
      // doit se voir sans deplier, et se retrouver au rapport.
      h += '<details class="repli"' + (derog ? " open" : "") + '>' +
        '<summary><span id="derog-' + cd.cle + '">' + resumeDerogation(cd.cle) + '</span></summary>' +
        '<p class="aide">Laissez vide pour appliquer la position enregistrée au profil navire (' +
        ech(n.marqueMi.distance || "0") + ' m, ' +
        (n.marqueMi.position === "avant" ? "en avant du milieu" : "en arrière du milieu") +
        '). À ne renseigner que si vous avez relevé un repère différent, et à mentionner au rapport.</p>' +
        '<div class="grille g2">' +
        champ({ libelle: "Distance relevée", unite: "m", chemin: "cond." + cd.cle + ".miDistance",
                valeur: c.miDistance, placeholder: "vide = valeur du profil" }) +
        '<div class="champ"><span class="champ-tete"><span class="champ-lbl">Position</span></span>' +
        '<div class="bascule">' +
        '<button type="button" data-mipos="' + cd.cle + '|avant" aria-pressed="' +
        (c.miPosition === "avant") + '">en avant du milieu</button>' +
        '<button type="button" data-mipos="' + cd.cle + '|arriere" aria-pressed="' +
        (c.miPosition !== "avant") + '">en arrière du milieu</button>' +
        '</div></div></div></details>';

      h += '<h2 class="section" style="margin-top:18px">Déductibles</h2>';
      h += '<p class="aide">Chaque poste se saisit en total, ou tank par tank, indépendamment ' +
        'des autres. Le statut de la mesure est demandé pour chaque tank : en contradictoire, la ' +
        'différence entre une soute que vous avez sondée et un chiffre donné par le bord est ' +
        'exactement ce qu\'on vous opposera.</p>';
      h += '<div id="ded-' + cd.cle + '">' + blocDeductibles(cd.cle) + '</div>';
      h += '<div id="synth-' + cd.cle + '">' + syntheseCondition(cd.cle) + '</div>';
      h += '</div>';
    });
    return h;
  }

  function erreursDuTank(erreurs, nom) {
    var mien = (erreurs || []).filter(function (m) {
      return nom && m.indexOf("« " + nom + " »") >= 0;
    });
    if (!mien.length) return "";
    return '<div class="tank-err">' +
      mien.map(function (m) { return ech(m); }).join("<br />") + '</div>';
  }

  // Bloc des deductibles d'une condition : un panneau par poste, avec bascule
  // total / tank par tank.
  function blocDeductibles(cle) {
    var n = navire();
    var c = S.conditions[cle];
    var calc = deductiblesCondition(n, c);
    var h = "";

    POSTES.forEach(function (p) {
      var mode = c.modes[p.cle] || "global";
      var t = calc.parPoste[p.cle];
      var tks = tanksDuPoste(n, p.cle);
      h += '<div class="poste"><div class="poste-tete">' +
        '<span class="poste-nom">' + ech(p.libelle) + '</span>' +
        '<div class="bascule petite">' +
        '<button type="button" data-dedmode="' + cle + '|' + p.cle + '|global" aria-pressed="' +
        (mode === "global") + '">Total</button>' +
        '<button type="button" data-dedmode="' + cle + '|' + p.cle + '|detail" aria-pressed="' +
        (mode === "detail") + '"' + (tks.length ? "" : " disabled") + '>Par tank</button>' +
        '</div>' +
        '<span class="poste-total">' +
        (t.tonnes === null ? "illisible" : nb(t.tonnes, DEC.deductible) + " t") + '</span>' +
        '</div>';

      if (mode === "global") {
        h += '<div class="poste-corps"><div class="grille g2">' +
          champ({ libelle: "Total " + p.libelle, unite: "t",
                  chemin: "cond." + cle + ".deductibles." + p.cle,
                  valeur: c.deductibles[p.cle],
                  invalide: t.illisible !== undefined }) +
          '</div></div>';
      } else if (!tks.length) {
        h += '<div class="poste-corps"><p class="aide" style="margin:0">Aucun tank au registre pour ' +
          'ce poste. Ajoutez-les dans l\'onglet Navire.</p></div>';
      } else {
        h += '<div class="poste-corps">';
        tks.forEach(function (tk) {
          var sa = c.tanks[tk.id] || {};
          var det = t.detail.filter(function (d) { return d.tank.id === tk.id; })[0] || {};
          var unite = tk.mode === "tonnage" ? "t" : (tk.mode === "volume" ? "m³" : "sonde");
          var statut = sa.statut || "moi";
          h += '<div class="tank">' +
            '<div class="tank-tete">' +
            '<span class="poste-nom" style="flex:1">' + ech(tk.nom || "(sans nom)") + '</span>' +
            '<span class="pastille ' + classeStatut(statut) + '">' + ech(libelleStatut(statut)) + '</span>' +
            '</div>' +
            '<div class="grille g2">' +
            champ({ libelle: tk.mode === "sonde" ? "Sonde relevée" : "Valeur", unite: unite,
                    chemin: "cond." + cle + ".tanks." + tk.id + ".valeur", valeur: sa.valeur || "" }) +
            champ({ libelle: "Densité", chemin: "cond." + cle + ".tanks." + tk.id + ".densite",
                    valeur: (sa.densite !== undefined && String(sa.densite).trim() !== "") ? sa.densite : tk.densite }) +
            selecteur({ libelle: "Statut de la mesure",
                        chemin: "cond." + cle + ".tanks." + tk.id + ".statut", valeur: statut,
                        options: STATUTS.map(function (x) { return { cle: x.cle, libelle: x.libelle }; }) }) +
            champ({ libelle: "Observation", texte: true,
                    chemin: "cond." + cle + ".tanks." + tk.id + ".obs", valeur: sa.obs || "" }) +
            '</div>' +
            '<div class="tank-calc">' +
            (det.tonnes === null || det.tonnes === undefined ? "—" : nb(det.tonnes, 3) + " t") +
            (det.motif ? ' <span class="tank-motif">' + ech(det.motif) + '</span>' : "") +
            '</div>' +
            // Les refus propres a ce tank s'affichent ici, au plus pres de la
            // saisie fautive, et pas seulement dans la synthese generale.
            erreursDuTank(t.erreurs, tk.nom) +
            '</div>';
        });
        h += '</div>';
      }
      h += '</div>';
    });

    h += '<div class="msg' + (calc.illisibles.length ? " bloquant" : "") + '">' +
      '<strong>Total des déductibles : ' + nb(calc.total, DEC.deductible) + ' t</strong> ' +
      POSTES.map(function (p) {
        var t = calc.parPoste[p.cle];
        return ech(p.libelle) + " " + (t.tonnes === null ? "?" : nb(t.tonnes, DEC.deductible));
      }).join(" · ") + '</div>';
    return h;
  }

  // Resume affiche dans le repli. Ecrit en clair pour que la derogation se voie
  // sans deplier, et qu'elle soit repercutee au rapport.
  function resumeDerogation(cle) {
    var c = S.conditions[cle];
    var d = M.lire(c.miDistance);
    if (String(c.miDistance).trim() === "" || d === null) {
      return "Marque milieu propre à cette pesée";
    }
    return "Marque milieu propre à cette pesée — active : " + nb(d, 3) + " m " +
      (c.miPosition === "avant" ? "en avant du milieu" : "en arrière du milieu");
  }

  function syntheseCondition(cle) {
    var r = calculer(cle);
    if (!r) return '<div class="msg" style="margin-top:12px">Six lectures de tirants d\'eau sont nécessaires.</div>';
    var h = messages(r);
    if (!r.ok) return h;
    var ded = 0;
    POSTES.forEach(function (p) {
      var v = M.lire(S.conditions[cle].deductibles[p.cle]);
      if (v !== null) ded += v;
    });
    h += '<div class="tab-defile" style="margin-top:12px"><table class="res"><tbody>' +
      ligne("Quarter mean moulé", nb(r.quarterMoule, DEC.entree), "m") +
      ligne("Assiette entre perpendiculaires", nb(r.assiette, DEC.correction), "m") +
      ligne("Déplacement en table", nb(r.disp, DEC.deplacement), "t") +
      ligne("Correction d'assiette totale", nb(r.corrAssiette, DEC.tonnesCorr), "t") +
      ligne("Déplacement brut", nb(r.dispBrut, DEC.deplacement), "t", "pivot") +
      ligne("Déductibles", nb(ded, DEC.deductible), "t") +
      ligne("Déplacement net", nb(r.net, DEC.deplacement), "t", "finale") +
      '</tbody></table></div>';
    return h;
  }

  // ==========================================================================
  // Vue : resultats
  // ==========================================================================

  function vueResultats() {
    var manque = prerequis();
    if (manque.length) {
      return '<div class="msg bloquant"><strong>Profil navire incomplet.</strong><ul>' +
        manque.map(function (x) { return "<li>" + ech(x) + "</li>"; }).join("") +
        '</ul></div>';
    }
    var h = "";
    CONDITIONS.forEach(function (cd) {
      var r = calculer(cd.cle);
      h += '<h2 class="section">' + ech(cd.libelle) + '</h2>';
      if (!r) { h += '<div class="msg">Lectures incomplètes.</div>'; return; }
      h += messages(r);
      if (!r.ok) return;
      var cd2 = S.conditions[cd.cle];
      if (String(cd2.miDistance).trim() !== "") {
        h += '<div class="msg alerte">Marque milieu dérogatoire pour cette pesée : ' +
          ech(cd2.miDistance) + ' m ' +
          (cd2.miPosition === "avant" ? "en avant du milieu" : "en arrière du milieu") +
          ', au lieu de la valeur du profil navire. À mentionner au rapport.</div>';
      }
      h += '<div class="carte plate"><div class="tab-defile"><table class="res"><tbody>' +
        ligne("Moyenne avant", nb(r.moyAv, DEC.lecture), "m") +
        ligne("Moyenne milieu", nb(r.moyMi, DEC.lecture), "m") +
        ligne("Moyenne arrière", nb(r.moyAr, DEC.lecture), "m") +
        ligne("Assiette apparente", nb(r.assietteApp, DEC.correction), "m") +
        ligne("Correction perpendiculaire avant", nb(r.corrAv, DEC.correction), "m") +
        ligne("Correction perpendiculaire milieu", nb(r.corrMi, DEC.correction), "m") +
        ligne("Correction perpendiculaire arrière", nb(r.corrAr, DEC.correction), "m") +
        ligne("Tirant d'eau avant corrigé", nb(r.dAv, DEC.correction), "m") +
        ligne("Tirant d'eau milieu corrigé", nb(r.dMi, DEC.correction), "m") +
        ligne("Tirant d'eau arrière corrigé", nb(r.dAr, DEC.correction), "m") +
        ligne("Moyenne avant-arrière", nb(r.moyAvAr, DEC.correction), "m") +
        ligne("Moyenne des moyennes", nb(r.moyDesMoy, DEC.correction), "m") +
        ligne("Quarter mean", nb(r.quarter, DEC.entree), "m", "pivot") +
        ligne("Quarter mean moulé", nb(r.quarterMoule, DEC.entree), "m", "pivot") +
        ligne("Assiette entre perpendiculaires", nb(r.assiette, DEC.correction), "m") +
        ligne("Flèche", nb(Math.abs(r.flecheCm), 1) + " (" + r.typeFleche + ")", "cm") +
        ligne("Gîte", nb(r.gite, 2) + (r.bordGite && r.bordGite !== "nulle" ? " sur " + r.bordGite : ""), "°") +
        ligne("Déplacement en table", nb(r.disp, DEC.deplacement), "t") +
        ligne("TPC", nb(r.tpc, DEC.hydro), "t/cm") +
        ligne("LCF lu en table", nb(r.lcfBrut, DEC.hydro), "m") +
        ligne("LCF normalisé, positif arrière", nb(r.lcf, DEC.hydro), "m") +
        ligne("1re correction d'assiette", nb(r.corr1, DEC.tonnesCorr), "t") +
        ligne("2e correction, Nemoto", nb(r.corr2, DEC.tonnesCorr), "t") +
        ligne("Déplacement corrigé de l'assiette", nb(r.dispAssiette, DEC.deplacement), "t") +
        ligne("Densité du bassin appliquée", nb(r.densiteBassin, DEC.densite), "") +
        ligne("Après correction de densité", nb(r.dispDens, DEC.deplacement), "t") +
        (r.corrGite ? ligne("Correction de gîte", nb(r.corrGite, DEC.tonnesCorr), "t") : "") +
        ligne("Déplacement brut", nb(r.dispBrut, DEC.deplacement), "t", "pivot") +
        ligne("Total déductibles", nb(r.deductibles, DEC.deductible), "t") +
        ligne("Déplacement net", nb(r.net, DEC.deplacement), "t", "finale") +
        (r.constantePlusCargo !== null
          ? ligne("Net moins lège, soit constante et cargaison", nb(r.constantePlusCargo, DEC.deplacement), "t")
          : "") +
        '</tbody></table></div></div>';
      h += '<details class="repli"><summary>Journal de calcul</summary>' +
        '<pre class="journal">' + ech(r.journal.join("\n")) + '</pre></details>';
    });
    return h;
  }

  // ==========================================================================
  // Vue : dossier (chainage)
  // ==========================================================================

  function vueDossier() {
    var h = "";
    h += '<h2 class="section">Références du dossier</h2>';
    h += '<div class="carte"><div class="grille g3">' +
      champ({ libelle: "Référence de mission", chemin: "dossier.reference", valeur: S.dossier.reference, texte: true, placeholder: "LH-2026-DS-001" }) +
      champ({ libelle: "Nature de la cargaison", chemin: "dossier.cargaison", valeur: S.dossier.cargaison, texte: true }) +
      champ({ libelle: "Connaissement", unite: "t", chemin: "dossier.connaissement", valeur: S.dossier.connaissement }) +
      champ({ libelle: "Port", chemin: "dossier.port", valeur: S.dossier.port || "", texte: true }) +
      champ({ libelle: "Expert", chemin: "dossier.expert", valeur: S.dossier.expert || "", texte: true }) +
      '</div></div>';

    var opts = CONDITIONS.map(function (c) { return { cle: c.cle, libelle: c.libelle }; });
    h += '<h2 class="section">Chaînage</h2>';
    h += '<p class="aide">La cargaison est la différence des deux déplacements nets. ' +
      'Le lège et la constante s\'éliminent par différence, ce qui est tout l\'intérêt de la méthode.</p>';
    h += '<div class="carte"><div class="grille g3">' +
      selecteur({ libelle: "Pesée de départ", chemin: "dossier.departPesee", valeur: S.dossier.departPesee, options: opts }) +
      selecteur({ libelle: "Pesée d'arrivée", chemin: "dossier.arriveePesee", valeur: S.dossier.arriveePesee, options: opts }) +
      champ({ libelle: "Incertitude retenue", unite: "%", chemin: "dossier.tauxIncertitude", valeur: S.dossier.tauxIncertitude,
              note: "0,3 % pour une pesée bien conduite" }) +
      '</div>';
    h += '<div id="panneau-chainage">' + panneauChainage() + '</div>';
    h += '</div>';

    h += '<h2 class="section">Rapport</h2>';
    var pretRapport = estPretPourRapport();
    h += '<p class="aide">Document Word produit sur l\'appareil, sans passer par aucun serveur. ' +
      'Il reprend les conventions déclarées, la chaîne de calcul des deux pesées, le détail des ' +
      'déductibles avec le statut de chaque mesure, les réserves relevées et le journal.</p>';
    if (!pretRapport.ok) {
      h += '<div class="msg bloquant"><strong>Rapport indisponible</strong><ul>' +
        pretRapport.motifs.map(function (m) { return "<li>" + ech(m) + "</li>"; }).join("") +
        '</ul></div>';
    }
    h += '<div class="barre-actions">' +
      '<button class="act" data-rapport="1"' + (pretRapport.ok ? "" : " disabled") + '>Rapport Word</button>' +
      '<button class="act sec" data-synthese="1"' + (pretRapport.ok ? "" : " disabled") + '>Copier la synthèse</button>' +
      '</div>';
    return h;
  }

  // ==========================================================================
  // Rapport Word
  // ==========================================================================
  // Aucun calcul ici : on ne fait que mettre en forme ce que le moteur a
  // produit. Les chiffres proviennent exclusivement de calculer().

  function blocsRapport() {
    var n = navire();
    var a = S.dossier.departPesee, b = S.dossier.arriveePesee;
    var pa = calculer(a), pb = calculer(b);
    var taux = M.lire(S.dossier.tauxIncertitude);
    var c = M.cargaison(pa, pb, {
      connaissement: S.dossier.connaissement,
      tauxIncertitude: taux === null ? 0.003 : taux / 100
    });
    var B = [];

    B.push({ type: "titre", texte: "Rapport de pesée par tirants d'eau" });
    B.push({ type: "paires", lignes: [
      ["Référence de mission", S.dossier.reference || "—"],
      ["Navire", n.nom || "—"],
      ["Pavillon", n.pavillon || "—"],
      ["Port", S.dossier.port || "—"],
      ["Nature de la cargaison", S.dossier.cargaison || "—"],
      ["Expert", S.dossier.expert || "—"],
      ["Opération", c.sens === "chargement" ? "Chargement" : "Déchargement"]
    ] });

    B.push({ type: "soustitre", texte: "Conventions et caractéristiques déclarées" });
    B.push({ type: "texte", texte:
      "Le signe des corrections dépend de conventions qui varient d'un chantier à l'autre. " +
      "Celles retenues pour la présente pesée sont déclarées ci-dessous et versées au dossier." });
    B.push({ type: "paires", lignes: [
      ["Convention du LCF de la table", M.CONVENTIONS_LCF[n.conventionLcf] || "—"],
      ["Densité de référence de la table", nb(M.lire(n.densiteTable), DEC.densite)],
      ["Longueur entre perpendiculaires", nb(M.lire(n.lbp), 3) + " m"],
      ["Bau", nb(M.lire(n.bau), 3) + " m"],
      ["Épaisseur de tôle de quille", nb(M.lire(n.toleQuille), 3) + " m"],
      ["Marque avant", nb(M.lire(n.marqueAv.distance), 3) + " m " +
        (n.marqueAv.position === "avant" ? "en avant de la perpendiculaire avant" : "en arrière de la perpendiculaire avant")],
      ["Marque milieu", nb(M.lire(n.marqueMi.distance), 3) + " m " +
        (n.marqueMi.position === "avant" ? "en avant du milieu" : "en arrière du milieu")],
      ["Marque arrière", nb(M.lire(n.marqueAr.distance), 3) + " m " +
        (n.marqueAr.position === "avant" ? "en avant de la perpendiculaire arrière" : "en arrière de la perpendiculaire arrière")],
      ["Déplacement lège déclaré", nb(M.lire(n.lege), DEC.deplacement) + " t"]
    ] });

    // L'audit est recalcule ici plutot que lu dans les metadonnees : ainsi la
    // reserve portee au rapport correspond toujours a la table effectivement
    // presente, meme si elle a ete remplacee depuis son import.
    var au = (n.hydro && n.hydro.length >= 3) ? M.auditTable(n.hydro) : null;
    if (au && au.anomalies && au.anomalies.length) {
      B.push({ type: "encadre", texte:
        "Réserve sur la table hydrostatique du bord : " + au.anomalies.length +
        " ligne(s) portent une valeur de déplacement incohérente avec la tendance locale (" +
        au.anomalies.map(function (x) {
          return nb(x.draft, 2) + " m, écart " + nb(x.ecart, 0) + " t";
        }).join(" ; ") + "). Aucune correction n'a été appliquée d'office à la table du bord." });
    }

    [[a, pa], [b, pb]].forEach(function (x) {
      var cle = x[0], r = x[1];
      var cd = S.conditions[cle];
      var lib = CONDITIONS.filter(function (z) { return z.cle === cle; })[0];
      B.push({ type: "soustitre", texte: (lib ? lib.libelle : cle) +
        (cd.date ? " du " + cd.date + (cd.heure ? " à " + cd.heure : "") : "") +
        (cd.port ? ", " + cd.port : "") });

      B.push({ type: "tableau",
        entetes: ["Station", "Bâbord", "Tribord", "Moyenne", "Correction", "Corrigé"],
        largeurs: [1900, 1420, 1420, 1420, 1420, 1420],
        alignements: ["left", "right", "right", "right", "right", "right"],
        mono: [false, true, true, true, true, true],
        lignes: [
          ["Avant", nb(M.lire(cd.avBb), DEC.lecture), nb(M.lire(cd.avTb), DEC.lecture),
            nb(r.moyAv, DEC.correction), nb(r.corrAv, DEC.correction), nb(r.dAv, DEC.correction)],
          ["Milieu", nb(M.lire(cd.miBb), DEC.lecture), nb(M.lire(cd.miTb), DEC.lecture),
            nb(r.moyMi, DEC.correction), nb(r.corrMi, DEC.correction), nb(r.dMi, DEC.correction)],
          ["Arrière", nb(M.lire(cd.arBb), DEC.lecture), nb(M.lire(cd.arTb), DEC.lecture),
            nb(r.moyAr, DEC.correction), nb(r.corrAr, DEC.correction), nb(r.dAr, DEC.correction)]
        ] });

      if (r.derogationMi) {
        B.push({ type: "encadre", texte: "Marque milieu propre à cette pesée : " +
          nb(r.derogationMi.distance, 3) + " m " + r.derogationMi.position +
          ", en dérogation de la valeur portée au profil navire." });
      }

      B.push({ type: "paires", lignes: [
        ["Quarter mean", nb(r.quarter, DEC.entree) + " m"],
        ["Quarter mean moulé", nb(r.quarterMoule, DEC.entree) + " m"],
        ["Assiette entre perpendiculaires", nb(r.assiette, DEC.correction) + " m"],
        ["Flèche de coque", nb(Math.abs(r.flecheCm), 1) + " cm en " + (r.typeFleche === "Sag" ? "sagging" : "hogging")],
        ["Gîte relevée", nb(r.gite, 2) + "° sur " + r.bordGite],
        ["Déplacement lu en table", nb(r.disp, DEC.deplacement) + " t"],
        ["TPC", nb(r.tpc, DEC.hydro) + " t/cm"],
        ["LCF lu en table", nb(r.lcfBrut, DEC.hydro) + " m"],
        ["LCF normalisé, positif vers l'arrière", nb(r.lcf, DEC.hydro) + " m"],
        ["Première correction d'assiette", nb(r.corr1, DEC.tonnesCorr) + " t"],
        ["Seconde correction, dite Nemoto", nb(r.corr2, DEC.tonnesCorr) + " t"],
        ["Déplacement corrigé de l'assiette", nb(r.dispAssiette, DEC.deplacement) + " t"],
        ["Densité du bassin mesurée", nb(r.densiteBassin, DEC.densite)],
        ["Correction de gîte appliquée", nb(r.corrGite, DEC.tonnesCorr) + " t"],
        ["Déplacement brut", nb(r.dispBrut, DEC.deplacement) + " t"],
        ["Total des déductibles", nb(r.deductibles, DEC.deductible) + " t"],
        ["Déplacement net", nb(r.net, DEC.deplacement) + " t"]
      ] });

      var ded = r.detailDeductibles;
      var lignesDed = [];
      POSTES.forEach(function (pp) {
        var t = ded.parPoste[pp.cle];
        if (t.mode === "global") {
          lignesDed.push([pp.libelle, "Total du poste",
            t.tonnes === null ? "—" : nb(t.tonnes, DEC.deductible), "—", "—"]);
        } else {
          t.detail.forEach(function (dt) {
            lignesDed.push([pp.libelle, dt.tank.nom || "(sans nom)",
              dt.tonnes === null ? "—" : nb(dt.tonnes, 3),
              libelleStatut(dt.statut), dt.obs || "—"]);
          });
        }
      });
      B.push({ type: "tableau",
        entetes: ["Poste", "Tank ou total", "Tonnage", "Statut de la mesure", "Observation"],
        largeurs: [1800, 2100, 1400, 1900, 1800],
        alignements: ["left", "left", "right", "left", "left"],
        mono: [false, false, true, false, false],
        lignes: lignesDed.length ? lignesDed : [["—", "—", "—", "—", "—"]] });

      if (r.alertes && r.alertes.length) {
        B.push({ type: "encadre", texte: "Points relevés à cette pesée : " + r.alertes.join(" ; ") + "." });
      }
      if (cd.observation) {
        B.push({ type: "texte", texte: "Observations : " + cd.observation });
      }
    });

    B.push({ type: "soustitre", texte: "Détermination de la cargaison" });
    B.push({ type: "paires", lignes: [
      ["Déplacement net au départ", nb(c.netInitial, DEC.deplacement) + " t"],
      ["Déplacement net à l'arrivée", nb(c.netFinal, DEC.deplacement) + " t"],
      ["Cargaison " + (c.sens === "chargement" ? "chargée" : "déchargée"), nb(c.poids, DEC.cargaison) + " t"],
      ["Chiffre retenu au rapport", nb(Math.round(c.poids), 0) + " t ± " + nb(Math.round(c.incertitude), 0) + " t"],
      ["Incertitude retenue", nb(c.tauxIncertitude * 100, 2) + " %"],
      ["Connaissement", c.connaissement ? nb(c.connaissement, 0) + " t" : "—"],
      ["Écart au connaissement", c.connaissement
        ? nb(c.ecart, DEC.cargaison) + " t, soit " + nb(c.ecartPct, 3) + " %" : "—"]
    ] });
    B.push({ type: "texte", texte:
      "Le déplacement lège et la constante du bord s'éliminent par différence entre les deux pesées : " +
      "une erreur portant sur ces deux valeurs n'affecte pas le tonnage de cargaison déterminé ci-dessus. " +
      "La précision d'affichage ne préjuge pas de l'exactitude de la méthode, dont l'incertitude est " +
      "rappelée au tableau." });
    if (c.alertes && c.alertes.length) {
      B.push({ type: "encadre", texte: c.alertes.join(" ; ") + "." });
    }

    B.push({ type: "soustitre", texte: "Journal de calcul, pesée de départ" });
    B.push({ type: "journal", lignes: pa.journal });
    B.push({ type: "soustitre", texte: "Journal de calcul, pesée d'arrivée" });
    B.push({ type: "journal", lignes: pb.journal });

    return B;
  }

  function exporterRapport() {
    var n = navire();
    var D = window.DocxLaHune;
    var octets = D.construire({
      meta: {
        titre: "Rapport de pesée par tirants d'eau",
        sujet: (n.nom || "") + " " + (S.dossier.reference || ""),
        auteur: S.dossier.expert || "LA HUNE"
      },
      blocs: blocsRapport(),
      pied: "Document établi par LA HUNE, cabinet d'expertise maritime indépendant. " +
        "Calculs produits par le moteur Draft Survey v" + M.version +
        ", validé sur banc de test documenté. Généré le " + new Date().toLocaleString("fr-FR") + "."
    });
    var base = String(S.dossier.reference || n.nom || "sans-reference");
    if (base.normalize) base = base.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    var nom = "pesee-" + base.replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "").toLowerCase() + ".docx";
    D.telecharger(octets, nom);
  }

  function syntheseTexte() {
    var n = navire();
    var pa = calculer(S.dossier.departPesee), pb = calculer(S.dossier.arriveePesee);
    var taux = M.lire(S.dossier.tauxIncertitude);
    var c = M.cargaison(pa, pb, {
      connaissement: S.dossier.connaissement,
      tauxIncertitude: taux === null ? 0.003 : taux / 100
    });
    return [
      "LA HUNE - Pesée par tirants d'eau",
      "Référence : " + (S.dossier.reference || "—"),
      "Navire : " + (n.nom || "—") + (n.pavillon ? ", " + n.pavillon : ""),
      "Port : " + (S.dossier.port || "—") + " · Cargaison : " + (S.dossier.cargaison || "—"),
      "",
      "Déplacement net au départ   : " + nb(c.netInitial, DEC.deplacement) + " t",
      "Déplacement net à l'arrivée : " + nb(c.netFinal, DEC.deplacement) + " t",
      (c.sens === "chargement" ? "Cargaison chargée" : "Cargaison déchargée") + "   : " +
        nb(c.poids, DEC.cargaison) + " t",
      "Chiffre au rapport : " + nb(Math.round(c.poids), 0) + " ± " + nb(Math.round(c.incertitude), 0) + " t",
      c.connaissement ? "Connaissement : " + nb(c.connaissement, 0) + " t, écart " + nb(c.ecartPct, 3) + " %" : "",
      "",
      "Convention du LCF : " + (M.CONVENTIONS_LCF[n.conventionLcf] || "—")
    ].filter(function (x) { return x !== ""; }).join("\n");
  }

  function estPretPourRapport() {
    var r = { ok: false, motifs: [] };
    var n = navire();
    if (!n) { r.motifs.push("Aucun profil navire sélectionné."); return r; }
    if (!window.DocxLaHune) {
      r.motifs.push("Le générateur de document est absent : docx.js doit être présent dans le dossier.");
      return r;
    }
    var a = S.dossier.departPesee, b = S.dossier.arriveePesee;
    if (a === b) { r.motifs.push("Les deux pesées du chaînage doivent être différentes."); return r; }
    var pa = calculer(a), pb = calculer(b);
    if (!pa || !pa.ok) r.motifs.push("La pesée de départ n'est pas exploitable.");
    if (!pb || !pb.ok) r.motifs.push("La pesée d'arrivée n'est pas exploitable.");
    r.ok = r.motifs.length === 0;
    return r;
  }

  function panneauChainage() {
    var a = S.dossier.departPesee, b = S.dossier.arriveePesee;
    if (a === b) return '<div class="msg bloquant">Les deux pesées doivent être différentes.</div>';
    var pa = calculer(a), pb = calculer(b);
    if (!pa || !pb || !pa.ok || !pb.ok) {
      return '<div class="msg">Les deux pesées doivent être complètes et exploitables.</div>';
    }
    var taux = M.lire(S.dossier.tauxIncertitude);
    var c = M.cargaison(pa, pb, {
      connaissement: S.dossier.connaissement,
      tauxIncertitude: taux === null ? 0.003 : taux / 100
    });
    var h = "";
    h += '<div class="tab-defile" style="margin-top:12px"><table class="res"><tbody>' +
      ligne("Déplacement net au départ", nb(c.netInitial, DEC.deplacement), "t") +
      ligne("Déplacement net à l'arrivée", nb(c.netFinal, DEC.deplacement), "t") +
      ligne("Sens de l'opération", c.sens === "chargement" ? "Chargement" : "Déchargement", "") +
      ligne("Cargaison", nb(c.poids, DEC.cargaison), "t", "finale") +
      ligne("Incertitude de méthode", "± " + nb(c.incertitude, 0), "t") +
      ligne("Chiffre à retenir au rapport", nb(Math.round(c.poids), 0) + " ± " + nb(Math.round(c.incertitude), 0), "t", "pivot") +
      (c.connaissement ? ligne("Connaissement", nb(c.connaissement, 0), "t") : "") +
      (c.connaissement ? ligne("Écart au connaissement", nb(c.ecart, DEC.cargaison), "t") : "") +
      (c.connaissement ? ligne("Écart relatif", nb(c.ecartPct, 3), "%") : "") +
      (c.constanteInitiale !== undefined
        ? ligne("Constante et cargaison au départ", nb(c.constanteInitiale, DEC.deplacement), "t") : "") +
      '</tbody></table></div>';
    if (c.alertes && c.alertes.length) {
      h += '<div class="msg alerte"><ul>' +
        c.alertes.map(function (m) { return "<li>" + ech(m) + "</li>"; }).join("") + "</ul></div>";
    }
    return h;
  }

  // ==========================================================================
  // Vue : controle
  // ==========================================================================

  function vueControle() {
    var B = window.BancTestDraftSurvey;
    var h = '<h2 class="section">Autotest du moteur</h2>';
    h += '<p class="aide">Le moteur est confronté à une pesée réelle documentée, le vraquier ' +
      'EVER SHIP, avec la table du bord au pas du centimètre. Lancez ce contrôle après ' +
      'toute mise à jour de l\'outil, et avant une mission si vous voulez pouvoir en attester.</p>';
    if (!B || !window.HYDRO_EVERSHIP) {
      return h + '<div class="msg bloquant">Banc de test absent de cette installation.</div>';
    }
    var t0 = performance.now();
    var out = B.lancer(M, window.HYDRO_EVERSHIP);
    var duree = performance.now() - t0;
    var vert = out.totalKo === 0;
    h += '<div class="msg ' + (vert ? "ok" : "bloquant") + '"><strong>' +
      (vert ? "Conforme." : "Écart détecté.") + '</strong> ' + out.totalOk +
      ' contrôle(s) conforme(s), ' + out.totalKo + ' en échec, en ' + nb(duree, 0) + ' ms. ' +
      'Moteur version ' + ech(M.version) + '.</div>';
    h += '<div class="carte plate"><div class="tab-defile"><table class="res"><tbody>' +
      ligne("Cargaison calculée par le moteur", nb(out.chainage.moteur, 2), "t") +
      ligne("Cargaison portée au classeur de référence", nb(out.chainage.classeur, 2), "t") +
      ligne("Écart", nb(out.chainage.ecart, 2), "t") +
      ligne("Résidu de cargaison, navire vide", nb(out.physique.residu, 2), "t") +
      ligne("Résidu rapporté au déplacement", nb(out.physique.residuPct, 5), "%") +
      '</tbody></table></div></div>';
    out.cas.forEach(function (cas) {
      var ko = cas.lignes.filter(function (l) { return !l.ok; }).length;
      h += '<details class="repli"><summary>Cas ' + ech(cas.nom) + ' — ' +
        (ko ? ko + " écart(s)" : "conforme") + '</summary>' +
        '<div class="tab-defile"><table class="res"><thead><tr><th>Grandeur</th><th>Moteur</th>' +
        '<th>Référence</th><th>Écart</th><th>État</th></tr></thead><tbody>';
      cas.lignes.forEach(function (l) {
        h += '<tr><td>' + ech(l.libelle) + '</td><td>' + nb(l.moteur, 4) + '</td><td>' +
          nb(l.classeur, 4) + '</td><td>' + nb(l.ecart, 4) + '</td><td>' +
          '<span class="pastille ' + (l.ok ? "ok" : "ko") + '">' + (l.ok ? "conforme" : "écart") +
          '</span></td></tr>';
      });
      h += '</tbody></table></div></details>';
    });
    h += '<details class="repli"><summary>Garde-fous</summary><div class="carte plate">';
    out.gardes.forEach(function (g) {
      h += '<div class="liste-item"><span class="pastille ' + (g.ok ? "ok" : "ko") + '">' +
        (g.ok ? "ok" : "ko") + '</span><div class="liste-corps"><div class="liste-nom" style="font-size:13px">' +
        ech(g.nom) + '</div><div class="liste-detail">' + ech(g.attendu) + '</div></div></div>';
    });
    h += '</div></details>';

    h += '<h2 class="section">Données de l\'appareil</h2>';
    h += '<div class="carte"><table class="res"><tbody>' +
      ligne("Stockage local", Stockage.disponible ? "disponible" : "indisponible, session seulement", "") +
      ligne("Dernière écriture", derniereEcritureOk ? "enregistrée" : "en mémoire seulement", "") +
      ligne("Profils navire enregistrés", S.navires.length, "") +
      '</tbody></table>' +
      '<div class="barre-actions">' +
      '<button class="act sec" data-exporter="1">Exporter la sauvegarde</button>' +
      '<button class="act danger" data-effacer="1">Effacer toutes les données</button>' +
      '</div>' +
      '<p class="aide">Les données ne quittent jamais l\'appareil. Aucun serveur, aucun envoi.</p>' +
      '</div>';
    return h;
  }

  // ==========================================================================
  // Rendu et evenements
  // ==========================================================================

  var VUES = {
    navire: vueNavire, pesees: vuePesees, resultats: vueResultats,
    dossier: vueDossier, controle: vueControle
  };

  function majBandeau() {
    var n = navire();
    document.getElementById("ref-dossier").textContent =
      (S.dossier.reference ? S.dossier.reference + " \u00B7 " : "") +
      (n && n.nom ? n.nom : "aucun navire");
  }

  function rendre() {
    var f = VUES[S.vue] || vueNavire;
    document.getElementById("vue").innerHTML = f();
    var ong = document.getElementById("onglets").children;
    for (var i = 0; i < ong.length; i++) {
      if (ong[i].dataset.vue === S.vue) ong[i].setAttribute("aria-current", "page");
      else ong[i].removeAttribute("aria-current");
    }
    majBandeau();
    document.getElementById("pied").innerHTML =
      "Moteur " + ech(M.version) + ". Toutes les données restent sur cet appareil. " +
      (Stockage.disponible ? "" : "<strong>Stockage local indisponible : les saisies seront perdues à la fermeture.</strong>");
  }

  function affecter(chemin, valeur) {
    var p = chemin.split(".");
    if (p[0] === "navire") {
      var n = navire();
      if (!n) return;
      if (p.length === 2) n[p[1]] = valeur;
      else if (p.length === 3) n[p[1]][p[2]] = valeur;
    } else if (p[0] === "cond") {
      var c = S.conditions[p[1]];
      if (!c) return;
      // cond.<cle>.tanks.<idTank>.<champ>
      if (p[2] === "tanks" && p.length === 5) {
        if (!c.tanks[p[3]]) c.tanks[p[3]] = {};
        c.tanks[p[3]][p[4]] = valeur;
      } else if (p.length === 3) c[p[2]] = valeur;
      else if (p.length === 4) c[p[2]][p[3]] = valeur;
    } else if (p[0] === "tank") {
      // tank.<idTank>.<champ> : registre du navire
      var nv = navire();
      if (!nv) return;
      var tk = (nv.tanks || []).filter(function (x) { return x.id === p[1]; })[0];
      if (!tk) return;
      tk[p[2]] = valeur;
      if (p[2] === "baremeBrut") tk.bareme = analyserBareme(valeur);
    } else if (p[0] === "dossier") {
      S.dossier[p[1]] = valeur;
    } else if (p[0] === "import" && importation) {
      importation.affectation[parseInt(p[1], 10)] = valeur;
    }
  }

  document.getElementById("onglets").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-vue]");
    if (!b) return;
    S.vue = b.dataset.vue;
    sauver();
    rendre();
    document.getElementById("vue").focus();
  });

  var racine = document.getElementById("vue");

  // saisie continue : on met a jour l'etat sans reconstruire les champs,
  // pour ne pas perdre le curseur, et on rafraichit les panneaux de calcul.
  racine.addEventListener("input", function (e) {
    var t = e.target;
    if (!t.dataset || !t.dataset.set) return;
    affecter(t.dataset.set, t.value);
    sauver();
    majBandeau();
    var p = t.dataset.set.split(".");
    if (p[0] === "cond") {
      var z = document.getElementById("synth-" + p[1]);
      if (z) z.innerHTML = syntheseCondition(p[1]);
      // La derogation de marque milieu s'affiche dans le resume du repli, hors
      // du panneau de synthese : il faut le remettre a jour aussi, sinon
      // l'ecran annonce une derogation differente de celle qui est appliquee.
      if (p[2] === "miDistance") {
        var res = document.getElementById("derog-" + p[1]);
        if (res) res.innerHTML = resumeDerogation(p[1]);
      }
      if (p[2] === "deductibles" || p[2] === "tanks") {
        var zd = document.getElementById("ded-" + p[1]);
        if (zd) zd.innerHTML = blocDeductibles(p[1]);
      }
    } else if (p[0] === "tank") {
      if (p[2] === "baremeBrut") {
        var nvB = navire();
        var tkB = nvB ? (nvB.tanks || []).filter(function (x) { return x.id === p[1]; })[0] : null;
        var zb = document.getElementById("bar-" + p[1]);
        if (zb && tkB) {
          var nn = (tkB.bareme || []).length;
          zb.textContent = nn ? nn + " points" : "vide";
        }
      }
      // une densite ou un bareme modifie change tous les tonnages calcules
      CONDITIONS.forEach(function (cd) {
        var zt = document.getElementById("ded-" + cd.cle);
        if (zt) zt.innerHTML = blocDeductibles(cd.cle);
        var zs = document.getElementById("synth-" + cd.cle);
        if (zs) zs.innerHTML = syntheseCondition(cd.cle);
      });
    } else if (p[0] === "dossier") {
      var d = document.getElementById("panneau-chainage");
      if (d) d.innerHTML = panneauChainage();
    }
  });

  racine.addEventListener("change", function (e) {
    var t = e.target;
    if (!t.dataset || !t.dataset.set) return;
    affecter(t.dataset.set, t.value);
    sauver();
    rendre();
  });

  racine.addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    var d = b.dataset;

    if (d.pos) {
      var parts = d.pos.split("|");
      affecter(parts[0] + ".position", parts[1]);
      sauver(); rendre(); return;
    }
    if (d.mipos) {
      var mp = d.mipos.split("|");
      S.conditions[mp[0]].miPosition = mp[1];
      sauver(); rendre(); return;
    }
    if (d.gite) {
      var g = d.gite.split("|");
      S.conditions[g[0]].appliquerGite = g[1] === "1";
      sauver(); rendre(); return;
    }
    if (d.rapport) {
      try { exporterRapport(); }
      catch (err) { alert("Le rapport n'a pas pu être produit : " + (err && err.message ? err.message : err)); }
      return;
    }
    if (d.synthese) {
      var txt = syntheseTexte();
      var libelle = b.textContent;
      var fini = function (ok) {
        b.textContent = ok ? "Copié" : "Copie refusée";
        setTimeout(function () { b.textContent = libelle; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () { fini(true); }, function () { fini(false); });
      } else {
        var ta = document.createElement("textarea");
        ta.value = txt; document.body.appendChild(ta); ta.select();
        var ok2 = false;
        try { ok2 = document.execCommand("copy"); } catch (e2) { ok2 = false; }
        document.body.removeChild(ta); fini(ok2);
      }
      return;
    }
    if (d.dedmode) {
      var dm = d.dedmode.split("|");
      S.conditions[dm[0]].modes[dm[1]] = dm[2];
      sauver(); rendre(); return;
    }
    if (d.tankAdd) {
      var na = navire();
      if (!na) return;
      na.tanks = na.tanks || [];
      var def = POSTES.filter(function (x) { return x.cle === d.tankAdd; })[0];
      var rang = tanksDuPoste(na, d.tankAdd).length + 1;
      na.tanks.push({
        id: "tk-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e4).toString(36),
        poste: d.tankAdd,
        nom: def.libelle + " " + rang,
        mode: "tonnage",
        densite: def.densite,
        baremeBrut: "",
        bareme: []
      });
      sauver(); rendre(); return;
    }
    if (d.tankDel) {
      var nd = navire();
      if (!nd) return;
      var cible = (nd.tanks || []).filter(function (x) { return x.id === d.tankDel; })[0];
      if (cible && !window.confirm("Retirer le tank « " + (cible.nom || "sans nom") +
          " » du registre ? Les valeurs saisies pour ce tank dans les pesées seront perdues.")) return;
      nd.tanks = (nd.tanks || []).filter(function (x) { return x.id !== d.tankDel; });
      // on retire aussi les saisies orphelines, sinon elles resteraient a jamais
      CONDITIONS.forEach(function (cd) {
        var cc = S.conditions[cd.cle];
        if (cc && cc.tanks) delete cc.tanks[d.tankDel];
      });
      // un poste laisse sans tank repasse en saisie globale
      CONDITIONS.forEach(function (cd) {
        var cc = S.conditions[cd.cle];
        POSTES.forEach(function (pp) {
          if (cc.modes[pp.cle] === "detail" && !tanksDuPoste(nd, pp.cle).length) {
            cc.modes[pp.cle] = "global";
          }
        });
      });
      sauver(); rendre(); return;
    }
    if (d.neuf) {
      var nv = navireVide();
      S.navires.push(nv);
      S.navireActif = nv.id;
      sauver(); rendre(); return;
    }
    if (d.choisir) { S.navireActif = d.choisir; importation = null; sauver(); rendre(); return; }
    if (d.dupliquer) {
      // Duplication pour navire jumeau : on emporte les conventions, les
      // marques, la table et le registre de tanks, mais pas l'identite.
      var src = S.navires.filter(function (v) { return v.id === d.dupliquer; })[0];
      if (!src) return;
      var cp = JSON.parse(JSON.stringify(src));
      cp.id = "nav-" + Date.now().toString(36);
      cp.nom = (src.nom || "Navire") + " (copie)";
      (cp.tanks || []).forEach(function (tk, i) {
        tk.id = "tk-" + Date.now().toString(36) + "-" + i.toString(36);
      });
      S.navires.push(cp);
      S.navireActif = cp.id;
      sauver(); rendre(); return;
    }
    if (d.suppr) {
      var nom = "";
      S.navires.forEach(function (v) { if (v.id === d.suppr) nom = v.nom || "sans nom"; });
      if (!window.confirm("Supprimer le profil « " + nom + " » ? Cette action est définitive.")) return;
      S.navires = S.navires.filter(function (v) { return v.id !== d.suppr; });
      if (S.navireActif === d.suppr) S.navireActif = S.navires.length ? S.navires[0].id : null;
      sauver(); rendre(); return;
    }
    if (d.remplacer) {
      var n0 = navire();
      if (n0) { n0.hydro = null; n0.hydroMeta = null; }
      importation = null; sauver(); rendre(); return;
    }
    if (d.annulerImport) { importation = null; rendre(); return; }
    if (d.analyser) {
      var ta = document.getElementById("collage");
      var res = decouper(ta ? ta.value : "");
      if (!res.matrice.length) {
        alert("Aucune ligne numérique exploitable dans ce collage.");
        return;
      }
      var prop = proposer(res.matrice, res.colonnes);
      importation = {
        matrice: res.matrice, colonnes: res.colonnes, rejetees: res.rejetees,
        affectation: prop.affectation, profils: prop.profils
      };
      rendre(); return;
    }
    if (d.validerImport && importation) {
      var t = construireTable(importation.matrice, importation.affectation);
      if (!t) { alert("Affectation incomplète."); return; }
      var n1 = navire();
      n1.hydro = t;
      n1.hydroMeta = {
        roles: importation.affectation.filter(function (x) { return x; }),
        lignes: t.length,
        date: new Date().toISOString()
      };
      importation = null;
      sauver(); rendre(); return;
    }
    if (d.exporter) {
      var txt = JSON.stringify(S, null, 2);
      var blob = new Blob([txt], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "draft-survey-sauvegarde-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      return;
    }
    if (d.effacer) {
      if (!window.confirm("Effacer tous les profils, pesées et dossiers ? Cette action est définitive.")) return;
      S = etatVide();
      sauver(); rendre(); return;
    }
  });

  rendre();
})();
