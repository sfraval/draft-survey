// =============================================================================
// LA HUNE - Draft Survey : moteur de calcul v3
// =============================================================================
// Aucune dependance. Aucun acces reseau. Aucun etat global.
//
// CONVENTIONS INTERNES, uniques et non negociables :
//
//   1. Axe longitudinal des marques : X POSITIF VERS L'AVANT.
//      Une marque situee en arriere de son point de reference a une abscisse
//      negative. Une seule formule couvre les trois stations :
//          correction = x * assiette apparente / LBM
//
//   2. Assiette : positive sur l'arriere (Dar - Dav), conformement au code
//      UNECE (Trim = Dap - Dfp).
//
//   3. LCF : normalise en interne vers POSITIF EN ARRIERE DU MILIEU, qui est
//      la convention de la formule de correction d'assiette. Les tables du
//      bord utilisent des conventions differentes selon les chantiers, donc
//      la convention de la table est declaree explicitement par l'utilisateur
//      et convertie a l'entree. C'est le premier poste d'erreur du metier :
//      une inversion vaut ici 879 t sur un vraquier de 95 000 t de port en
//      lourd. Aucune valeur par defaut silencieuse n'est admise.
//
//   4. Correction de gite : toujours positive, exige la table complete.
//
//   5. Precision : calcul en pleine precision, aucun arrondi intermediaire.
//      Le mode "bord" reproduit volontairement la chaine d'arrondis d'une
//      feuille Excel classique, pour recouper le chiffre d'un tiers en
//      contradictoire. Il n'est jamais actif par defaut.
// =============================================================================

(function (global) {
  "use strict";

  // --- utilitaires ---------------------------------------------------------

  function estNombre(v) {
    return typeof v === "number" && isFinite(v);
  }

  // Arrondi decimal robuste (evite les artefacts binaires de toFixed)
  function arrondi(v, d) {
    if (!estNombre(v)) return v;
    var f = Math.pow(10, d);
    return Math.round((v + Number.EPSILON * Math.abs(v)) * f) / f;
  }

  // Lecture numerique stricte d'une saisie utilisateur.
  // Renvoie null si la saisie n'est pas un nombre exploitable.
  // Traite la virgule decimale, les espaces de milliers (y compris insecables)
  // et le signe. NE RENVOIE JAMAIS 0 PAR DEFAUT : un zero silencieux sur un
  // ballast de 12 500 t est une erreur de plusieurs milliers de tonnes.
  function lire(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    var s = String(v).trim();
    if (s === "") return null;
    s = s.replace(/[\s\u00A0\u202F\u2009']/g, ""); // espaces et apostrophes
    s = s.replace(",", ".");
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
    var n = parseFloat(s);
    return isFinite(n) ? n : null;
  }

  // --- table hydrostatique -------------------------------------------------

  function prepareTable(lignes) {
    var t = lignes
      .filter(function (r) {
        return estNombre(r.draft) && estNombre(r.disp);
      })
      .map(function (r) {
        return {
          draft: r.draft, disp: r.disp,
          tpc: estNombre(r.tpc) ? r.tpc : null,
          mtc: estNombre(r.mtc) ? r.mtc : null,
          lcf: estNombre(r.lcf) ? r.lcf : null,
          lcb: estNombre(r.lcb) ? r.lcb : null
        };
      })
      .sort(function (a, b) { return a.draft - b.draft; });
    return t;
  }

  // Interpolation lineaire stricte. Hors plage : renvoie null et signale.
  // Aucune extrapolation, jamais, meme d'un centimetre.
  function interp(table, cle, draft) {
    if (!table || table.length < 2) return { valeur: null, motif: "table absente ou incomplete" };
    var lo = table[0], hi = table[table.length - 1];
    var eps = 1e-9;
    if (draft < lo.draft - eps) {
      return { valeur: null, motif: "tirant d'eau " + draft.toFixed(4) + " m sous la table (min " + lo.draft + " m)" };
    }
    if (draft > hi.draft + eps) {
      return { valeur: null, motif: "tirant d'eau " + draft.toFixed(4) + " m au-dessus de la table (max " + hi.draft + " m)" };
    }
    // recherche dichotomique du segment encadrant
    var a = 0, b = table.length - 1;
    while (b - a > 1) {
      var m = (a + b) >> 1;
      if (table[m].draft <= draft) a = m; else b = m;
    }
    var p = table[a], q = table[b];
    if (p[cle] === null || q[cle] === null) {
      return { valeur: null, motif: "colonne " + cle + " absente de la table" };
    }
    if (q.draft === p.draft) return { valeur: p[cle], motif: null };
    var f = (draft - p.draft) / (q.draft - p.draft);
    return { valeur: p[cle] + f * (q[cle] - p[cle]), motif: null };
  }

  // --- normalisation des conventions --------------------------------------

  // Abscisse signee d'une marque, positive vers l'avant.
  function offsetMarque(distance, position) {
    var d = lire(distance);
    if (d === null) return { valeur: null, motif: "distance de marque illisible" };
    d = Math.abs(d);
    if (position === "arriere") return { valeur: -d, motif: null };
    if (position === "avant") return { valeur: +d, motif: null };
    return { valeur: null, motif: "position de marque non declaree" };
  }

  // Libelles destines a l'utilisateur et repris au rapport : ils portent donc
  // les accents, contrairement aux commentaires de ce fichier.
  var CONVENTIONS_LCF = {
    milieu_arriere_positif: "Depuis le milieu, positif vers l'arrière",
    milieu_avant_positif: "Depuis le milieu, positif vers l'avant",
    depuis_ap: "Depuis la perpendiculaire arrière (AP)",
    depuis_fp: "Depuis la perpendiculaire avant (FP)"
  };

  // Normalise vers : positif = en arriere du milieu.
  function normaliseLcf(valeur, convention, lbp) {
    switch (convention) {
      case "milieu_arriere_positif": return { valeur: valeur, motif: null };
      case "milieu_avant_positif": return { valeur: -valeur, motif: null };
      case "depuis_ap": return { valeur: lbp / 2 - valeur, motif: null };
      case "depuis_fp": return { valeur: valeur - lbp / 2, motif: null };
      default: return { valeur: null, motif: "convention LCF non declaree" };
    }
  }

  // --- moteur --------------------------------------------------------------
  //
  // navire = {
  //   lbp, bau, toleQuille (m), densiteTable, lege,
  //   conventionLcf, hydro: [{draft,disp,tpc,mtc,lcf,lcb}],
  //   marqueAv: {distance, position}, marqueMi: {...}, marqueAr: {...}
  // }
  // releve = {
  //   avBb, avTb, miBb, miTb, arBb, arTb,
  //   densiteBassin, appliquerGite, deductibles: {cle: tonnes}
  // }
  // options = { mode: "plein" | "bord" }

  function pesee(navire, releve, options) {
    var mode = (options && options.mode) === "bord" ? "bord" : "plein";
    var R = function (v, d) { return mode === "bord" ? arrondi(v, d) : v; };

    var res = { ok: false, alertes: [], bloquants: [], journal: [], mode: mode };
    var A = function (m) { res.alertes.push(m); };
    var B = function (m) { res.bloquants.push(m); };
    var J = function (m) { res.journal.push(m); };

    // -- geometrie
    var lbp = lire(navire.lbp);
    var bau = lire(navire.bau);
    var tole = lire(navire.toleQuille);
    if (tole === null) tole = 0;
    var densTable = lire(navire.densiteTable);
    if (lbp === null || lbp <= 0) B("LBP non renseignee ou invalide");
    if (densTable === null || densTable <= 0) B("Densite de reference de la table non renseignee");

    var oAv = offsetMarque(navire.marqueAv && navire.marqueAv.distance,
                           navire.marqueAv && navire.marqueAv.position);
    var oMi = offsetMarque(navire.marqueMi && navire.marqueMi.distance,
                           navire.marqueMi && navire.marqueMi.position);
    var oAr = offsetMarque(navire.marqueAr && navire.marqueAr.distance,
                           navire.marqueAr && navire.marqueAr.position);
    [["avant", oAv], ["milieu", oMi], ["arriere", oAr]].forEach(function (p) {
      if (p[1].valeur === null) B("Marque " + p[0] + " : " + p[1].motif);
    });

    // -- lectures
    var l = {};
    ["avBb", "avTb", "miBb", "miTb", "arBb", "arTb"].forEach(function (k) {
      l[k] = lire(releve[k]);
      if (l[k] === null) B("Lecture " + k + " manquante ou illisible");
    });

    if (res.bloquants.length) return res;

    // -- LBM : distance entre marque avant et marque arriere
    var lbm = lbp + oAv.valeur - oAr.valeur;
    if (lbm <= 0) { B("LBM calculee negative ou nulle : verifier les distances de marques"); return res; }
    J("LBM = LBP + xAv - xAr = " + lbp + " + (" + oAv.valeur + ") - (" + oAr.valeur + ") = " + arrondi(lbm, 4) + " m");

    // -- moyennes bord a bord
    var mAv = (l.avBb + l.avTb) / 2;
    var mMi = (l.miBb + l.miTb) / 2;
    var mAr = (l.arBb + l.arTb) / 2;
    J("moyennes bord a bord : av " + arrondi(mAv, 4) + "  mi " + arrondi(mMi, 4) + "  ar " + arrondi(mAr, 4) + " m");

    // -- assiette apparente et correction aux perpendiculaires
    var assietteApp = mAr - mAv;
    var cAv = R(oAv.valeur * assietteApp / lbm, 4);
    var cMi = R(oMi.valeur * assietteApp / lbm, 4);
    var cAr = R(oAr.valeur * assietteApp / lbm, 4);
    var dAv = mAv + cAv, dMi = mMi + cMi, dAr = mAr + cAr;
    J("assiette apparente = " + arrondi(assietteApp, 4) + " m (positive sur l'arriere)");
    J("corrections aux perpendiculaires : av " + arrondi(cAv, 4) + "  mi " + arrondi(cMi, 4) + "  ar " + arrondi(cAr, 4) + " m");

    // -- moyennes successives
    var mAvAr = (dAv + dAr) / 2;
    var mDesM = (dMi + mAvAr) / 2;
    var quarter = R((dAv + dAr + 6 * dMi) / 8, 4);
    var quarterMoule = quarter - tole;
    var assiette = dAr - dAv;
    var flecheCm = (dMi - mAvAr) * 100;
    J("moyenne av/ar = " + arrondi(mAvAr, 4) + "  moyenne des moyennes = " + arrondi(mDesM, 4));
    J("quarter mean = " + arrondi(quarter, 4) + " m, moule = " + arrondi(quarterMoule, 4) + " m (tole " + tole + " m)");
    J("assiette entre perpendiculaires = " + arrondi(assiette, 4) + " m");

    // -- fleche et gite
    var typeFleche = flecheCm >= 0 ? "Sag" : "Hog";
    var gite = 0, bordGite = null, gitesStations = null;
    if (bau !== null && bau > 0) {
      gite = Math.atan(Math.abs(l.miBb - l.miTb) / bau) * 180 / Math.PI;
      bordGite = l.miBb > l.miTb ? "babord" : (l.miTb > l.miBb ? "tribord" : "nulle");
      gitesStations = {
        avant: Math.atan(Math.abs(l.avBb - l.avTb) / bau) * 180 / Math.PI,
        milieu: gite,
        arriere: Math.atan(Math.abs(l.arBb - l.arTb) / bau) * 180 / Math.PI
      };
      var ecartStations = Math.max(gitesStations.avant, gitesStations.milieu, gitesStations.arriere) -
                          Math.min(gitesStations.avant, gitesStations.milieu, gitesStations.arriere);
      if (ecartStations > 0.15) {
        A("Gites incoherentes entre stations (ecart " + arrondi(ecartStations, 2) +
          " deg) : verifier les lectures, ou suspecter une deformation locale de coque");
      }
      if (gite > 0.5 && !releve.appliquerGite) {
        A("Gite " + arrondi(gite, 2) + " deg superieure a 0,50 deg : correction de gite non appliquee");
      }
    } else {
      A("Bau non renseigne : gite non calculee");
    }

    // -- table hydrostatique
    var iDisp = interp(navire.hydroPrete || prepareTable(navire.hydro || []), "disp", quarterMoule);
    var table = navire.hydroPrete || prepareTable(navire.hydro || []);
    if (iDisp.valeur === null) { B("Deplacement : " + iDisp.motif); return res; }
    var iTpc = interp(table, "tpc", quarterMoule);
    var iLcf = interp(table, "lcf", quarterMoule);
    if (iTpc.valeur === null) { B("TPC : " + iTpc.motif); return res; }
    if (iLcf.valeur === null) { B("LCF : " + iLcf.motif); return res; }

    var disp = R(iDisp.valeur, 2);
    var tpc = R(iTpc.valeur, 3);
    var lcfBrut = R(iLcf.valeur, 4);
    var nLcf = normaliseLcf(lcfBrut, navire.conventionLcf, lbp);
    if (nLcf.valeur === null) { B("LCF : " + nLcf.motif); return res; }
    var lcf = nLcf.valeur;
    J("table @ " + arrondi(quarterMoule, 4) + " m : deplacement " + arrondi(disp, 2) +
      " t, TPC " + arrondi(tpc, 3) + " t/cm");
    J("LCF lu " + arrondi(lcfBrut, 4) + " m [" + CONVENTIONS_LCF[navire.conventionLcf] +
      "] normalise a " + arrondi(lcf, 4) + " m positif vers l'arriere du milieu");

    // -- 1re correction d'assiette (layer)
    var corr1 = R(assiette * tpc * lcf * 100 / lbp, 1);
    J("1re correction = assiette x TPC x LCF x 100 / LBP = " + arrondi(corr1, 1) + " t");

    // -- 2e correction d'assiette (Nemoto), toujours positive
    var iMtcP = interp(table, "mtc", quarterMoule + 0.5);
    var iMtcM = interp(table, "mtc", quarterMoule - 0.5);
    var corr2 = 0, mtcP = null, mtcM = null, dmdz = null;
    if (iMtcP.valeur === null || iMtcM.valeur === null) {
      A("Correction Nemoto impossible : MTC a +/- 0,50 m hors table. " +
        "Le deplacement n'est corrige que de la 1re correction d'assiette.");
    } else {
      mtcP = R(iMtcP.valeur, 3);
      mtcM = R(iMtcM.valeur, 3);
      dmdz = mtcP - mtcM;
      corr2 = R(assiette * assiette * dmdz * 50 / lbp, 1);
      if (corr2 < 0) {
        A("2e correction negative (" + arrondi(corr2, 1) + " t) : la MTC decroit avec le " +
          "tirant d'eau sur cette plage, ce qui est atypique. Verifier la table.");
      }
      J("2e correction (Nemoto) = assiette^2 x dM/dz x 50 / LBP = " + arrondi(corr2, 1) +
        " t  [MTC+0,5 = " + arrondi(mtcP, 3) + ", MTC-0,5 = " + arrondi(mtcM, 3) + "]");
    }

    var corrAssiette = corr1 + corr2;
    var dispAssiette = disp + corrAssiette;

    // -- densite
    var densBrut = releve.densiteBassin;
    var densVide = densBrut === null || densBrut === undefined ||
                   (typeof densBrut === "string" && densBrut.trim() === "");
    var densBassin = densVide ? null : lire(densBrut);
    if (densBassin === null) {
      if (!densVide) B("Densite du bassin illisible : " + JSON.stringify(densBrut));
      densBassin = densTable;
      if (densVide) {
        A("Densite du bassin non mesuree : la densite de la table (" + densTable + ") est utilisee");
      }
    }
    if (res.bloquants.length) return res;
    if (densBassin < 0.995 || densBassin > 1.035) {
      A("Densite du bassin de " + densBassin + " hors plage usuelle 0,995 a 1,035 : verifier le densimetre");
    }
    var dispDens = R(dispAssiette * densBassin / densTable, 1);
    J("correction de densite : x " + densBassin + " / " + densTable + " = " + arrondi(dispDens, 2) + " t");

    // -- correction de gite, toujours positive
    var corrGite = 0;
    if (releve.appliquerGite) {
      if (bau === null || bau <= 0) {
        A("Correction de gite demandee mais bau non renseigne : non appliquee");
      } else {
        var t1 = interp(table, "tpc", l.miBb - tole);
        var t2 = interp(table, "tpc", l.miTb - tole);
        if (t1.valeur === null || t2.valeur === null) {
          A("Correction de gite impossible : TPC aux tirants d'eau de bord hors table");
        } else {
          corrGite = Math.abs(6 * (t2.valeur - t1.valeur) * (l.miTb - l.miBb));
          corrGite = R(corrGite, 1);
          J("correction de gite = 6 x (TPC2 - TPC1) x (d2 - d1) = +" + arrondi(corrGite, 1) + " t (toujours positive)");
        }
      }
    }
    var dispBrut = dispDens + corrGite;

    // -- deductibles
    var ded = 0, detailDed = {};
    var dedSrc = releve.deductibles || {};
    Object.keys(dedSrc).forEach(function (k) {
      var brut = dedSrc[k];
      // Un poste laisse vide vaut zero : il n'est pas renseigne, ce n'est pas
      // une faute. Une saisie non vide et non numerique, en revanche, bloque :
      // c'est le cas dangereux, parce qu'un poste mal lu vaut des tonnes.
      var vide = brut === null || brut === undefined ||
                 (typeof brut === "string" && brut.trim() === "");
      if (vide) { detailDed[k] = 0; return; }
      var v = lire(brut);
      if (v === null) {
        B("Deductible \"" + k + "\" illisible : " + JSON.stringify(brut));
      } else {
        if (v < 0) A("Deductible \"" + k + "\" negatif (" + v + " t)");
        detailDed[k] = v;
        ded += v;
      }
    });
    if (res.bloquants.length) return res;

    var net = dispBrut - ded;
    J("deplacement net = " + arrondi(dispBrut, 2) + " - " + arrondi(ded, 2) + " = " + arrondi(net, 2) + " t");

    if (net < 0) B("Deplacement net negatif : deductibles superieurs au deplacement brut");

    // -- controle de coherence lege
    var lege = lire(navire.lege);
    var constantePlusCargo = null;
    if (lege !== null) {
      constantePlusCargo = net - lege;
      if (constantePlusCargo < 0) {
        A("Deplacement net inferieur au lege de " + arrondi(-constantePlusCargo, 1) +
          " t : incoherence, verifier lege, deductibles et densite");
      }
    }

    res.ok = res.bloquants.length === 0;
    Object.assign(res, {
      lbm: lbm,
      moyAv: mAv, moyMi: mMi, moyAr: mAr,
      corrAv: cAv, corrMi: cMi, corrAr: cAr,
      dAv: dAv, dMi: dMi, dAr: dAr,
      moyAvAr: mAvAr, moyDesMoy: mDesM,
      quarter: quarter, quarterMoule: quarterMoule,
      assietteApp: assietteApp, assiette: assiette,
      flecheCm: flecheCm, typeFleche: typeFleche,
      gite: gite, bordGite: bordGite, gitesStations: gitesStations,
      disp: disp, tpc: tpc, lcfBrut: lcfBrut, lcf: lcf,
      mtcP: mtcP, mtcM: mtcM, dmdz: dmdz,
      corr1: corr1, corr2: corr2, corrAssiette: corrAssiette,
      dispAssiette: dispAssiette, densiteBassin: densBassin,
      dispDens: dispDens, corrGite: corrGite, dispBrut: dispBrut,
      deductibles: ded, detailDeductibles: detailDed,
      net: net, lege: lege, constantePlusCargo: constantePlusCargo
    });
    return res;
  }

  // --- audit d'integrite d'une table hydrostatique ------------------------
  //
  // A executer sur TOUTE table saisie ou collee, avant de s'en servir. Les
  // tables du bord sont transcrites a la main dans des tableurs et contiennent
  // des fautes de frappe. Un chiffre errone de mille tonnes ne se voit pas a
  // l'oeil sur 1 300 lignes, mais fausse une pesee de mille tonnes.
  //
  // Principe : le deplacement doit croitre de facon reguliere avec le tirant
  // d'eau, au rythme du TPC. On signale toute ligne dont le pas s'ecarte
  // fortement de la tendance locale, et on propose la valeur coherente
  // reconstruite par les lignes voisines. On ne corrige jamais d'office :
  // c'est un document du bord, la decision revient a l'expert.

  function auditTable(lignes, options) {
    var seuil = (options && estNombre(options.seuilTonnes)) ? options.seuilTonnes : 15;
    var t = prepareTable(lignes);
    var r = { nbLignes: t.length, pas: null, anomalies: [], avertissements: [] };
    if (t.length < 3) {
      r.avertissements.push("Table trop courte pour etre auditee (" + t.length + " ligne(s))");
      return r;
    }

    // pas de tirant d'eau : doit etre constant
    var pas = arrondi(t[1].draft - t[0].draft, 6);
    r.pas = pas;
    for (var i = 1; i < t.length; i++) {
      var p = arrondi(t[i].draft - t[i - 1].draft, 6);
      if (Math.abs(p - pas) > 1e-6) {
        r.avertissements.push("Pas de tirant d'eau irregulier a " + t[i].draft +
          " m (" + p + " m au lieu de " + pas + " m)");
        break;
      }
      if (p <= 0) {
        r.avertissements.push("Tirant d'eau non strictement croissant a " + t[i].draft + " m");
        break;
      }
    }

    // colonnes manquantes
    ["tpc", "mtc", "lcf"].forEach(function (cle) {
      var n = t.filter(function (x) { return x[cle] === null; }).length;
      if (n) r.avertissements.push(n + " ligne(s) sans valeur de " + cle.toUpperCase());
    });

    // anomalies de la colonne deplacement
    //
    // Une valeur fautive fait mentir les deux pas qui l'encadrent, donc un
    // test naif signale aussi les lignes voisines, qui sont saines. On isole
    // la ligne reellement fautive par sa signature : les deux pas encadrants
    // s'ecartent tous deux de la tendance, MAIS leur somme reste conforme,
    // parce que les deux erreurs se compensent. C'est la marque d'une erreur
    // ponctuelle sur une seule ligne, et non d'un decrochage de la table.

    var deltas = [];
    for (var d1 = 1; d1 < t.length; d1++) deltas.push(t[d1].disp - t[d1 - 1].disp);

    function medianeLocale(centre, demiFenetre, exclus) {
      var v = [];
      for (var i = Math.max(0, centre - demiFenetre);
           i <= Math.min(deltas.length - 1, centre + demiFenetre); i++) {
        if (exclus.indexOf(i) >= 0) continue;
        v.push(deltas[i]);
      }
      if (!v.length) return null;
      v.sort(function (a, b) { return a - b; });
      var m = Math.floor(v.length / 2);
      return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
    }

    for (var k = 1; k < t.length - 1; k++) {
      var dAvant = deltas[k - 1];   // pas entrant  : disp[k] - disp[k-1]
      var dApres = deltas[k];       // pas sortant  : disp[k+1] - disp[k]
      var med = medianeLocale(k - 1, 6, [k - 1, k]);
      if (med === null) continue;

      var faux = Math.abs(dAvant - med) > seuil && Math.abs(dApres - med) > seuil;
      var compense = Math.abs(dAvant + dApres - 2 * med) <= seuil;
      if (!faux || !compense) continue;

      var proposee = arrondi(t[k - 1].disp + med, 0);
      r.anomalies.push({
        draft: t[k].draft,
        valeur: t[k].disp,
        proposee: proposee,
        ecart: arrondi(t[k].disp - proposee, 0),
        pasLocal: arrondi(med, 2),
        motif: "valeur ponctuelle incoherente : les deux pas encadrants se compensent"
      });
    }

    // decrochage de bloc : plusieurs pas anormaux qui ne se compensent pas
    for (var b = 1; b < deltas.length; b++) {
      var mb = medianeLocale(b, 8, [b]);
      if (mb === null) continue;
      var dejaSignale = r.anomalies.some(function (an) {
        return Math.abs(an.draft - t[b].draft) < pas * 1.5;
      });
      if (dejaSignale) continue;
      if (Math.abs(deltas[b] - mb) > Math.max(seuil * 3, Math.abs(mb) * 0.5)) {
        r.avertissements.push("Decrochage du deplacement a " + t[b + 1].draft +
          " m : pas de " + arrondi(deltas[b], 1) + " t/cm contre " +
          arrondi(mb, 1) + " t/cm en tendance locale");
      }
    }

    // deplacement decroissant : toujours une faute, jamais une forme de coque.
    // Signale uniquement si la ligne n'est pas deja portee en anomalie.
    for (var m = 1; m < t.length; m++) {
      if (t[m].disp <= t[m - 1].disp) {
        var connu = r.anomalies.some(function (an) { return an.draft === t[m].draft; });
        if (!connu) {
          r.avertissements.push("Deplacement non croissant a " + t[m].draft +
            " m (" + t[m].disp + " t apres " + t[m - 1].disp + " t)");
        }
      }
    }

    r.ok = r.anomalies.length === 0 && r.avertissements.length === 0;
    return r;
  }

  // --- chainage de deux pesees --------------------------------------------
  // Cargaison = |net final - net initial|. La constante et le lege
  // s'eliminent par difference, ce qui est tout l'interet de la methode.

  function cargaison(peseeInitiale, peseeFinale, opts) {
    if (!peseeInitiale || !peseeFinale || !peseeInitiale.ok || !peseeFinale.ok) {
      return { ok: false, motif: "une des deux pesees n'est pas exploitable" };
    }
    var delta = peseeFinale.net - peseeInitiale.net;
    var sens = delta >= 0 ? "chargement" : "dechargement";
    var poids = Math.abs(delta);
    var r = {
      ok: true, sens: sens, poids: poids,
      netInitial: peseeInitiale.net, netFinal: peseeFinale.net,
      alertes: []
    };
    // incertitude indicative de la methode
    var tauxIncertitude = (opts && estNombre(opts.tauxIncertitude)) ? opts.tauxIncertitude : 0.003;
    r.incertitude = poids * tauxIncertitude;
    r.tauxIncertitude = tauxIncertitude;

    var bl = lire(opts && opts.connaissement);
    if (bl !== null && bl > 0) {
      r.connaissement = bl;
      r.ecart = poids - bl;
      r.ecartPct = (r.ecart / bl) * 100;
      if (Math.abs(r.ecartPct) > 0.5) {
        r.alertes.push("Ecart au connaissement de " + arrondi(r.ecartPct, 3) +
          " %, superieur au seuil usuel de 0,5 % : a documenter dans le rapport");
      }
    }
    // controle de coherence des constantes
    if (estNombre(peseeInitiale.constantePlusCargo) && estNombre(peseeFinale.constantePlusCargo)) {
      r.constanteInitiale = peseeInitiale.constantePlusCargo;
      r.constanteFinale = peseeFinale.constantePlusCargo;
    }
    return r;
  }

  global.MoteurDraftSurvey = {
    version: "3.0.0",
    lire: lire,
    arrondi: arrondi,
    prepareTable: prepareTable,
    interp: interp,
    auditTable: auditTable,
    offsetMarque: offsetMarque,
    normaliseLcf: normaliseLcf,
    CONVENTIONS_LCF: CONVENTIONS_LCF,
    pesee: pesee,
    cargaison: cargaison
  };
})(typeof window !== "undefined" ? window : globalThis);
