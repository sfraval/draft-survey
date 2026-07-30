// =============================================================================
// LA HUNE - Draft Survey : banc de test
// =============================================================================
// Source des valeurs attendues : classeur de pesee reelle du vraquier EVER SHIP
// (Panama, LBP 227 m, chargement de charbon, decembre 2019), trois conditions.
// Les ecarts residuels attendus proviennent des arrondis intermediaires du
// classeur ; le moteur, en mode plein, ne les reproduit pas.
//
// Ce banc est le verrou de non-regression : toute modification du moteur doit
// le laisser vert. Il tourne dans le navigateur comme en ligne de commande.
// =============================================================================

(function (global) {
  "use strict";

  var NAVIRE = {
    nom: "EVER SHIP",
    lbp: 227,
    bau: 38,
    toleQuille: 0,
    densiteTable: 1.025,
    lege: 14637,
    conventionLcf: "milieu_arriere_positif",
    marqueAv: { distance: 2.255, position: "arriere" },
    marqueAr: { distance: 10.70, position: "avant" },
    marqueMi: { distance: 0, position: "arriere" }
  };

  // tolerances par grandeur, calees sur les arrondis du classeur
  var TOL = {
    quarter: 0.0002, quarterMoule: 0.0002, assiette: 0.0002,
    corrAv: 0.0002, corrMi: 0.0002, corrAr: 0.0002,
    disp: 0.6, tpc: 0.05, lcfBrut: 0.005,
    mtcP: 0.6, mtcM: 0.6,
    corr1: 0.6, corr2: 0.2, corrAssiette: 0.7,
    dispAssiette: 1.0, dispBrut: 1.0,
    deductibles: 0.01, net: 1.0
  };

  var UNITES = {
    quarter: "m", quarterMoule: "m", assiette: "m",
    corrAv: "m", corrMi: "m", corrAr: "m",
    disp: "t", tpc: "t/cm", lcfBrut: "m", mtcP: "t.m/cm", mtcM: "t.m/cm",
    corr1: "t", corr2: "t", corrAssiette: "t",
    dispAssiette: "t", dispBrut: "t", deductibles: "t", net: "t"
  };

  var LIBELLES = {
    quarter: "Quarter mean", quarterMoule: "Quarter mean moule",
    assiette: "Assiette entre perpendiculaires",
    corrAv: "Correction perp. avant", corrMi: "Correction perp. milieu",
    corrAr: "Correction perp. arriere",
    disp: "Deplacement @ quarter mean", tpc: "TPC", lcfBrut: "LCF lu en table",
    mtcP: "MTC a +0,50 m", mtcM: "MTC a -0,50 m",
    corr1: "1re correction d'assiette", corr2: "2e correction (Nemoto)",
    corrAssiette: "Correction d'assiette totale",
    dispAssiette: "Deplacement corrige de l'assiette",
    dispBrut: "Deplacement brut", deductibles: "Total deductibles",
    net: "Deplacement net"
  };

  var CAS = [
    {
      nom: "INITIAL",
      detail: "navire vide sur ballast, assiette 1,71 m sur l'arriere, LCF en avant du milieu",
      marqueMi: { distance: 0, position: "arriere" },
      releve: {
        avBb: 5.69, avTb: 5.69, miBb: 6.41, miTb: 6.39, arBb: 7.30, arTb: 7.30,
        densiteBassin: 1.023,
        deductibles: { ballast: 29297, eauDouce: 247, fo: 836.18, do: 57.5, lo: 0 }
      },
      attendu: {
        quarter: 6.4317, quarterMoule: 6.4317, assiette: 1.7075,
        corrAv: -0.017, corrAr: 0.0805,
        disp: 45926.92, tpc: 75.8, lcfBrut: -7.7066,
        mtcP: 1102.468, mtcM: 1061.168,
        corr1: -439.4, corr2: 26.5, corrAssiette: -412.9,
        dispAssiette: 45514.02, dispBrut: 45425.2,
        deductibles: 30437.68, net: 14987.52
      }
    },
    {
      nom: "DRAFT CHECK",
      detail: "charge a 88 760 t de charbon, LCF en arriere du milieu, signe de la 1re correction inverse",
      marqueMi: { distance: 0.54, position: "arriere" },
      releve: {
        avBb: 13.83, avTb: 13.83, miBb: 13.98, miTb: 13.98, arBb: 14.12, arTb: 14.12,
        densiteBassin: 1.023,
        deductibles: { ballast: 1245, eauDouce: 242, fo: 831, do: 57.4, lo: 0 }
      },
      attendu: {
        quarter: 13.9797, quarterMoule: 13.9797, assiette: 0.3076,
        corrAv: -0.0031, corrMi: -0.0007, corrAr: 0.0145,
        disp: 106302.5, tpc: 83.4, lcfBrut: 2.46,
        corr1: 27.8, corr2: 0.4, corrAssiette: 28.2,
        dispAssiette: 106330.7, dispBrut: 106123.2,
        deductibles: 2375.4, net: 103747.8
      }
    },
    {
      nom: "FINAL",
      detail: "condition legere, assiette 2,60 m, gite 0,06 deg sur tribord",
      marqueMi: { distance: 0, position: "arriere" },
      releve: {
        avBb: 5.05, avTb: 5.05, miBb: 6.18, miTb: 6.22, arBb: 7.50, arTb: 7.50,
        densiteBassin: 1.022,
        deductibles: { ballast: 28160, eauDouce: 158, fo: 325.7, do: 59.3, lo: 0 }
      },
      attendu: {
        quarter: 6.2308, quarterMoule: 6.2308, assiette: 2.5983,
        corrAv: -0.0258, corrAr: 0.1225,
        disp: 44406.08, tpc: 75.6, lcfBrut: -7.9192,
        corr1: -685.3, corr2: 59.8, corrAssiette: -625.5,
        dispAssiette: 43780.58, dispBrut: 43652.4,
        deductibles: 28703, net: 14949.4
      }
    }
  ];

  // --- garde-fous : ce que le moteur doit REFUSER de calculer --------------

  var GARDES = [
    {
      nom: "Espaces de milliers",
      attendu: "12500 et non 12",
      test: function (M) {
        return M.lire("12 500") === 12500 && M.lire("12\u00A0500") === 12500;
      }
    },
    {
      nom: "Saisie non numerique",
      attendu: "null, jamais 0",
      test: function (M) {
        return M.lire("abc") === null && M.lire("") === null &&
               M.lire("1,2,3") === null && M.lire(undefined) === null;
      }
    },
    {
      nom: "Signe negatif accepte",
      attendu: "-2,255 lu correctement",
      test: function (M) { return M.lire("-2,255") === -2.255; }
    },
    {
      nom: "Tirant d'eau sous la table",
      attendu: "blocage, pas d'extrapolation",
      test: function (M, table) {
        var r = M.interp(table, "disp", 1.5);
        return r.valeur === null && /sous la table/.test(r.motif);
      }
    },
    {
      nom: "Tirant d'eau au-dessus de la table",
      attendu: "blocage, pas d'extrapolation",
      test: function (M, table) {
        var r = M.interp(table, "disp", 16.2);
        return r.valeur === null && /au-dessus de la table/.test(r.motif);
      }
    },
    {
      nom: "Convention LCF non declaree",
      attendu: "blocage du calcul",
      test: function (M, table, navire) {
        var n = Object.assign({}, navire, { conventionLcf: undefined, hydroPrete: table });
        var r = M.pesee(n, CAS[0].releve);
        return r.ok === false && r.bloquants.length > 0;
      }
    },
    {
      nom: "Position de marque non declaree",
      attendu: "blocage du calcul",
      test: function (M, table, navire) {
        var n = Object.assign({}, navire, {
          hydroPrete: table,
          marqueAv: { distance: 2.255, position: null }
        });
        var r = M.pesee(n, CAS[0].releve);
        return r.ok === false;
      }
    },
    {
      nom: "Conversion LCF depuis l'AP",
      attendu: "LCF 100 m de l'AP sur LBP 227 = 13,5 m arriere du milieu",
      test: function (M) {
        var r = M.normaliseLcf(100, "depuis_ap", 227);
        return Math.abs(r.valeur - 13.5) < 1e-9;
      }
    },
    {
      nom: "Conversion LCF depuis la FP",
      attendu: "LCF 120 m de la FP sur LBP 227 = 6,5 m arriere du milieu",
      test: function (M) {
        var r = M.normaliseLcf(120, "depuis_fp", 227);
        return Math.abs(r.valeur - 6.5) < 1e-9;
      }
    },
    {
      nom: "Inversion de convention LCF detectable",
      attendu: "1re correction de signe oppose",
      test: function (M, table, navire) {
        var a = M.pesee(Object.assign({}, navire, { hydroPrete: table, marqueMi: CAS[0].marqueMi }), CAS[0].releve);
        var b = M.pesee(Object.assign({}, navire, {
          hydroPrete: table, marqueMi: CAS[0].marqueMi,
          conventionLcf: "milieu_avant_positif"
        }), CAS[0].releve);
        return a.ok && b.ok && Math.abs(a.corr1 + b.corr1) < 1e-6 && a.corr1 * b.corr1 < 0;
      }
    },
    {
      nom: "Correction de gite toujours positive",
      attendu: "signe + quel que soit le bord",
      test: function (M, table, navire) {
        var base = Object.assign({}, navire, { hydroPrete: table, marqueMi: CAS[2].marqueMi });
        var bb = Object.assign({}, CAS[2].releve, { appliquerGite: true });
        var tb = Object.assign({}, CAS[2].releve, { appliquerGite: true, miBb: 6.22, miTb: 6.18 });
        var a = M.pesee(base, bb), b = M.pesee(base, tb);
        return a.corrGite > 0 && b.corrGite > 0 && Math.abs(a.corrGite - b.corrGite) < 1e-9;
      }
    },
    {
      nom: "Chainage : la constante s'elimine",
      attendu: "cargaison independante du lege declare",
      test: function (M, table, navire) {
        var n1 = Object.assign({}, navire, { hydroPrete: table, marqueMi: CAS[0].marqueMi });
        var n2 = Object.assign({}, navire, { hydroPrete: table, marqueMi: CAS[1].marqueMi });
        var p1 = M.pesee(n1, CAS[0].releve), p2 = M.pesee(n2, CAS[1].releve);
        var c1 = M.cargaison(p1, p2);
        var n1b = Object.assign({}, n1, { lege: 99999 });
        var n2b = Object.assign({}, n2, { lege: 99999 });
        var c2 = M.cargaison(M.pesee(n1b, CAS[0].releve), M.pesee(n2b, CAS[1].releve));
        return Math.abs(c1.poids - c2.poids) < 1e-9;
      }
    },
    {
      nom: "Ecart au connaissement",
      attendu: "alerte au-dela de 0,5 %",
      test: function (M, table, navire) {
        var n1 = Object.assign({}, navire, { hydroPrete: table, marqueMi: CAS[0].marqueMi });
        var n2 = Object.assign({}, navire, { hydroPrete: table, marqueMi: CAS[1].marqueMi });
        var c = M.cargaison(M.pesee(n1, CAS[0].releve), M.pesee(n2, CAS[1].releve),
                            { connaissement: 88000 });
        return c.alertes.length === 1 && Math.abs(c.ecartPct - 0.8633) < 0.01;
      }
    }
  ];

  // --- execution ----------------------------------------------------------

  function lancer(M, hydro) {
    var table = M.prepareTable(hydro);
    var sortie = { cas: [], gardes: [], totalOk: 0, totalKo: 0, chainage: null, physique: null };

    CAS.forEach(function (cas) {
      var nav = Object.assign({}, NAVIRE, { hydroPrete: table, marqueMi: cas.marqueMi });
      var r = M.pesee(nav, cas.releve);
      var lignes = [];
      Object.keys(cas.attendu).forEach(function (k) {
        var got = r[k], att = cas.attendu[k];
        var d = (typeof got === "number") ? got - att : NaN;
        var tol = TOL[k] !== undefined ? TOL[k] : 0.5;
        var ok = isFinite(d) && Math.abs(d) <= tol;
        if (ok) sortie.totalOk++; else sortie.totalKo++;
        lignes.push({
          cle: k, libelle: LIBELLES[k] || k, unite: UNITES[k] || "",
          moteur: got, classeur: att, ecart: d, tol: tol, ok: ok
        });
      });
      sortie.cas.push({ nom: cas.nom, detail: cas.detail, lignes: lignes, resultat: r });
    });

    GARDES.forEach(function (g) {
      var ok = false, err = null;
      try { ok = g.test(M, table, NAVIRE) === true; }
      catch (e) { ok = false; err = String(e && e.message || e); }
      if (ok) sortie.totalOk++; else sortie.totalKo++;
      sortie.gardes.push({ nom: g.nom, attendu: g.attendu, ok: ok, erreur: err });
    });

    // chainage initial -> draft check
    var nav0 = Object.assign({}, NAVIRE, { hydroPrete: table, marqueMi: CAS[0].marqueMi });
    var nav1 = Object.assign({}, NAVIRE, { hydroPrete: table, marqueMi: CAS[1].marqueMi });
    var p0 = M.pesee(nav0, CAS[0].releve);
    var p1 = M.pesee(nav1, CAS[1].releve);
    var c = M.cargaison(p0, p1, { connaissement: 88000 });
    var attenduCargo = 88760.28;
    var okChain = Math.abs(c.poids - attenduCargo) <= 1.0;
    if (okChain) sortie.totalOk++; else sortie.totalKo++;
    sortie.chainage = {
      moteur: c.poids, classeur: attenduCargo, ecart: c.poids - attenduCargo,
      sens: c.sens, ok: okChain, incertitude: c.incertitude,
      connaissement: c.connaissement, ecartPct: c.ecartPct
    };

    // controle physique : navire vide a l'initial
    var residu = p0.net - NAVIRE.lege - 350;
    var okPhys = Math.abs(residu) <= 2.0;
    if (okPhys) sortie.totalOk++; else sortie.totalKo++;
    sortie.physique = {
      netMoinsLege: p0.net - NAVIRE.lege, constanteDeclaree: 350,
      residu: residu, deplacement: p0.dispBrut,
      residuPct: (residu / p0.dispBrut) * 100, ok: okPhys
    };

    // mode bord : reproduction des arrondis du classeur
    var navB = Object.assign({}, NAVIRE, { hydroPrete: table, marqueMi: CAS[0].marqueMi });
    var rb = M.pesee(navB, CAS[0].releve, { mode: "bord" });
    sortie.modeBord = {
      corr1: rb.corr1, corr2: rb.corr2, dispBrut: rb.dispBrut, net: rb.net,
      classeurCorr1: -439.4, classeurCorr2: 26.5,
      classeurDispBrut: 45425.2, classeurNet: 14987.52
    };

    return sortie;
  }

  global.BancTestDraftSurvey = { NAVIRE: NAVIRE, CAS: CAS, GARDES: GARDES, lancer: lancer };
})(typeof window !== "undefined" ? window : globalThis);
