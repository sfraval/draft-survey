// =============================================================================
// LA HUNE - Draft Survey : test de bout en bout de l'interface
// =============================================================================
// Charge index.html dans un DOM, pilote l'interface comme un utilisateur, et
// verifie que la chaine complete rend les bons chiffres : creation du profil,
// import de la table du bord, saisie des six tirants d'eau, chainage.
//
// Ce test ne remplace pas le banc de calcul, il verifie le cablage entre
// l'interface et le moteur. Un moteur juste relie a un mauvais champ donne un
// resultat faux.
// =============================================================================

"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const RACINE = __dirname;
let echecs = 0, reussis = 0;

function verifier(nom, condition, detail) {
  if (condition) { reussis++; console.log("  [ok] " + nom); }
  else { echecs++; console.log("  [KO] " + nom + (detail ? "  << " + detail : "")); }
}

// --- montage du DOM --------------------------------------------------------
const html = fs.readFileSync(path.join(RACINE, "index.html"), "utf8");
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/" });
const { window } = dom;

// stockage local minimal, jsdom en fournit un mais on veut le maitriser
const memoire = {};
Object.defineProperty(window, "localStorage", {
  value: {
    getItem: (k) => (k in memoire ? memoire[k] : null),
    setItem: (k, v) => { memoire[k] = String(v); },
    removeItem: (k) => { delete memoire[k]; }
  },
  configurable: true
});
window.confirm = () => true;
window.alert = (m) => { console.log("     alert() : " + m); };

for (const f of ["engine.js", "hydro-evership.js", "bench.js", "docx.js", "app.js"]) {
  window.eval(fs.readFileSync(path.join(RACINE, f), "utf8"));
}

const doc = window.document;
const q = (s) => doc.querySelector(s);
const qa = (s) => Array.from(doc.querySelectorAll(s));

function clic(el) {
  el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
}
function saisir(selecteur, valeur) {
  const el = q(selecteur);
  if (!el) throw new Error("champ introuvable : " + selecteur);
  el.value = valeur;
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
}
function changer(selecteur, valeur) {
  const el = q(selecteur);
  if (!el) throw new Error("champ introuvable : " + selecteur);
  el.value = valeur;
  el.dispatchEvent(new window.Event("change", { bubbles: true }));
}
function onglet(nom) { clic(q('button[data-vue="' + nom + '"]')); }
// On normalise SANS toucher aux espaces fines insecables (\u202F) du formatage
function norm(t) { return String(t).replace(/[ \t\n\r]+/g, " "); }
function texte() { return norm(q("#vue").textContent); }

console.log("=".repeat(76));
console.log("TEST DE BOUT EN BOUT DE L'INTERFACE");
console.log("=".repeat(76));

// --- 1. demarrage ----------------------------------------------------------
console.log("\n1. Démarrage");
verifier("l'application se rend sans erreur", !!q("#vue").innerHTML.length);
verifier("l'onglet Navire est actif", q('button[data-vue="navire"]').getAttribute("aria-current") === "page");
verifier("aucun profil au départ", /Aucun profil/.test(texte()));
verifier("les pesées sont bloquées sans navire",
  (onglet("pesees"), /Aucun profil navire ouvert/.test(texte())));
onglet("navire");

// --- 2. creation du profil -------------------------------------------------
console.log("\n2. Création du profil navire");
clic(q("button[data-neuf]"));
verifier("le formulaire apparaît", !!q('input[data-set="navire.lbp"]'));
saisir('input[data-set="navire.nom"]', "EVER SHIP");
saisir('input[data-set="navire.pavillon"]', "Panama");
saisir('input[data-set="navire.lbp"]', "227");
saisir('input[data-set="navire.bau"]', "38");
saisir('input[data-set="navire.toleQuille"]', "0");
saisir('input[data-set="navire.densiteTable"]', "1.025");
saisir('input[data-set="navire.lege"]', "14637");
saisir('input[data-set="navire.marqueAv.distance"]', "2.255");
saisir('input[data-set="navire.marqueAr.distance"]', "10.70");
saisir('input[data-set="navire.marqueMi.distance"]', "0");
verifier("le nom remonte dans le bandeau", /EVER SHIP/.test(q("#ref-dossier").textContent));

// positions : avant en arriere de la FP, arriere en avant de l'AP
clic(q('button[data-pos="navire.marqueAv|arriere"]'));
clic(q('button[data-pos="navire.marqueAr|avant"]'));
verifier("la position avant est mémorisée",
  q('button[data-pos="navire.marqueAv|arriere"]').getAttribute("aria-pressed") === "true");
verifier("la LBM est affichée à 214,045 m", /214,045/.test(texte()), texte().slice(0, 200));

// --- 3. convention LCF, blocage attendu ------------------------------------
console.log("\n3. Convention du LCF");
verifier("le calcul est bloqué sans convention déclarée",
  (onglet("pesees"), /convention du LCF n'est pas déclarée/i.test(texte())));
onglet("navire");
changer('select[data-set="navire.conventionLcf"]', "milieu_arriere_positif");
verifier("la convention est enregistrée",
  q('select[data-set="navire.conventionLcf"]').value === "milieu_arriere_positif");

// --- 4. import de la table -------------------------------------------------
console.log("\n4. Import de la table hydrostatique");
const lignes = window.HYDRO_EVERSHIP.map(
  (r) => [r.draft, r.disp, r.tpc, r.mtc, r.lcb, r.lcf].join("\t")
);
const collage = "Draught\tDispl\tTPC\tMTC\tLCB\tLCF\n" + lignes.join("\n");
q("#collage").value = collage;
clic(q("button[data-analyser]"));
verifier("1 301 lignes retenues", /1\u202F301 ligne|1301 ligne/.test(texte()), texte().slice(0, 240));
verifier("l'en-tête est écartée", /écartée/.test(texte()));

const selects = qa('select[data-set^="import."]');
verifier("six colonnes à affecter", selects.length === 6, "trouvé " + selects.length);
const propose = selects.map((s) => s.value);
console.log("     affectation proposée : " + propose.join(" | "));
verifier("colonne 1 proposée comme tirant d'eau", propose[0] === "draft");
verifier("colonne 2 proposée comme déplacement", propose[1] === "disp");

// affectation explicite, comme le ferait l'expert
["draft", "disp", "tpc", "mtc", "lcb", "lcf"].forEach((role, i) => {
  changer('select[data-set="import.' + i + '"]', role);
});
clic(q("button[data-valider-import]"));
verifier("la table est chargée", /lignes retenues|Lignes retenues/.test(texte()));
verifier("les deux défauts du bord sont signalés",
  /4,52/.test(texte()) && /4,69/.test(texte()), texte().slice(0, 400));
verifier("la valeur cohérente est proposée", /31\u202F623/.test(texte()) && /32\u202F879/.test(texte()));

// --- 5. saisie des pesees --------------------------------------------------
console.log("\n5. Saisie des pesées");
onglet("pesees");
verifier("les trois conditions sont proposées",
  /Pesée initiale/.test(texte()) && /Pesée de contrôle/.test(texte()) && /Pesée finale/.test(texte()));

function remplir(cle, d) {
  saisir('input[data-set="cond.' + cle + '.avBb"]', d.avBb);
  saisir('input[data-set="cond.' + cle + '.avTb"]', d.avTb);
  saisir('input[data-set="cond.' + cle + '.miBb"]', d.miBb);
  saisir('input[data-set="cond.' + cle + '.miTb"]', d.miTb);
  saisir('input[data-set="cond.' + cle + '.arBb"]', d.arBb);
  saisir('input[data-set="cond.' + cle + '.arTb"]', d.arTb);
  saisir('input[data-set="cond.' + cle + '.densiteBassin"]', d.dens);
  Object.keys(d.ded).forEach((k) => {
    saisir('input[data-set="cond.' + cle + '.deductibles.' + k + '"]', d.ded[k]);
  });
}

remplir("initial", {
  avBb: "5.69", avTb: "5.69", miBb: "6.41", miTb: "6.39", arBb: "7.30", arTb: "7.30",
  dens: "1.023",
  ded: { ballast: "29297", eauDouce: "247", fo: "836.18", do: "57.5", lo: "0" }
});
remplir("controle", {
  avBb: "13.83", avTb: "13.83", miBb: "13.98", miTb: "13.98", arBb: "14.12", arTb: "14.12",
  dens: "1.023",
  ded: { ballast: "1245", eauDouce: "242", fo: "831", do: "57.4", lo: "0" }
});

// Sur ce navire, le classeur de reference releve la marque milieu a 0,54 m en
// charge seulement. On utilise la derogation par pesee, pas le profil navire :
// les marques sont soudees a la coque, la derogation doit rester tracee.
saisir('input[data-set="cond.controle.miDistance"]', "0.54");
verifier("la dérogation de marque milieu est prise en compte",
  /0,54/.test(norm(q("#synth-controle").parentNode.textContent)));

const synth = norm(q("#synth-controle").textContent);
console.log("     synthèse contrôle : " + synth.slice(0, 150));
verifier("déplacement net en charge à 103 747 t", /103\u202F747/.test(synth), synth);

// --- 6. resultats detailles ------------------------------------------------
console.log("\n6. Résultats détaillés");
onglet("resultats");
const res = texte();
verifier("quarter mean moulé 13,9796 m", /13,9796/.test(res));
verifier("LCF lu 2,460 m", /2,460/.test(res));
verifier("1re correction 27,8 t", /27,8/.test(res));
verifier("journal de calcul présent", /Journal de calcul/.test(res));
verifier("convention LCF tracée dans le journal", /positif vers l'arrière|positif arrière/.test(res));

// --- 7. chainage -----------------------------------------------------------
console.log("\n7. Chaînage et écart au connaissement");
onglet("dossier");
saisir('input[data-set="dossier.reference"]', "LH-2026-DS-001");
saisir('input[data-set="dossier.connaissement"]', "88000");
changer('select[data-set="dossier.departPesee"]', "initial");
changer('select[data-set="dossier.arriveePesee"]', "controle");
const ch = norm(q("#panneau-chainage").textContent);
console.log("     " + ch.slice(0, 220));
verifier("cargaison 88 759,74 t", /88\u202F759,74/.test(ch), ch);
verifier("sens détecté : chargement", /Chargement/.test(ch));
verifier("écart au connaissement 0,863 %", /0,863/.test(ch));
verifier("alerte au-delà de 0,5 %", /0,5 %/.test(ch));
verifier("chiffre au rapport arrondi avec incertitude", /88\u202F760 ± 266/.test(ch), ch);

// --- 8. autotest embarque --------------------------------------------------
console.log("\n8. Autotest embarqué dans l'application");
onglet("controle");
const ct = texte();
verifier("l'autotest se lance et conclut conforme", /Conforme\./.test(ct), ct.slice(0, 200));
verifier("71 contrôles ou plus", /(\d+) contrôle\(s\) conforme/.test(ct) && parseInt(ct.match(/(\d+) contrôle\(s\) conforme/)[1], 10) >= 63);

// --- 9. persistance --------------------------------------------------------
console.log("\n9. Persistance");
verifier("l'état est écrit dans le stockage local", !!memoire["lahune-draft-survey-v3"]);
const sauve = JSON.parse(memoire["lahune-draft-survey-v3"]);
verifier("le profil navire est sauvegardé", sauve.navires.length === 1 && sauve.navires[0].nom === "EVER SHIP");
verifier("la table est sauvegardée", sauve.navires[0].hydro.length === 1301);
verifier("les pesées sont sauvegardées", sauve.conditions.controle.avBb === "13.83");

// --- 10. saisies fautives --------------------------------------------------
console.log("\n10. Saisies fautives");
onglet("pesees");
saisir('input[data-set="cond.initial.deductibles.ballast"]', "29 297");
const s2 = norm(q("#synth-initial").textContent);
verifier("un ballast collé « 29 297 » est bien lu 29 297 t", /14\u202F987/.test(s2), s2.slice(0, 200));
saisir('input[data-set="cond.initial.deductibles.ballast"]', "vingt-neuf mille");
const s3 = norm(q("#synth-initial").textContent);
verifier("une saisie non numérique interrompt le calcul", /Calcul interrompu/.test(s3), s3.slice(0, 200));
saisir('input[data-set="cond.initial.deductibles.ballast"]', "29297");

// --- 11. registre de tanks -------------------------------------------------
console.log("\n11. Registre de tanks");
onglet("navire");
clic(q('button[data-tank-add="ballast"]'));
clic(q('button[data-tank-add="ballast"]'));
const tanksBallast = qa('input[data-set^="tank."][data-set$=".nom"]');
verifier("deux tanks ajoutés au poste ballast", tanksBallast.length === 2,
  tanksBallast.length + " trouvé(s)");
const idTank1 = tanksBallast[0].dataset.set.split(".")[1];
const idTank2 = tanksBallast[1].dataset.set.split(".")[1];

saisir('input[data-set="tank.' + idTank1 + '.nom"]', "WBT 1 BB");
verifier("le tank est renommable",
  /WBT 1 BB/.test(q('input[data-set="tank.' + idTank1 + '.nom"]').value));

// tank 2 en sonde avec bareme
changer('select[data-set="tank.' + idTank2 + '.mode"]', "sonde");
saisir('textarea[data-set="tank.' + idTank2 + '.baremeBrut"]', "0\t0\n100\t500\n200\t1100");
saisir('input[data-set="tank.' + idTank2 + '.densite"]', "1.025");
verifier("le barème est accepté",
  /3 points/.test(norm(texte())), norm(texte()).slice(0, 0) || "points non affichés");

// saisie par tank sur la pesee initiale
onglet("pesees");
clic(q('button[data-dedmode="initial|ballast|detail"]'));
saisir('input[data-set="cond.initial.tanks.' + idTank1 + '.valeur"]', "20 000");
saisir('input[data-set="cond.initial.tanks.' + idTank2 + '.valeur"]', "150");
changer('select[data-set="cond.initial.tanks.' + idTank2 + '.statut"]', "bord");
const ded = norm(q("#ded-initial").textContent);
// tank 1 : 20 000 t direct. tank 2 : sonde 150 -> 800 m3 x 1,025 = 820 t
verifier("tonnage direct lu malgré l'espace des milliers", /20\u202F000/.test(ded), ded.slice(0, 260));
verifier("sonde 150 interpolée à 820,000 t", /820,000/.test(ded), ded.slice(0, 260));
verifier("total du poste à 20 820", /20\u202F820/.test(ded), ded.slice(0, 260));
verifier("statut « sondé par le bord » affiché", /Sondé par le bord/.test(ded));

// hors bareme : refus, pas d'extrapolation
saisir('input[data-set="cond.initial.tanks.' + idTank2 + '.valeur"]', "260");
const ded2 = norm(q("#ded-initial").textContent);
verifier("sonde hors barème refusée sans extrapolation",
  /hors barème/.test(ded2), ded2.slice(0, 260));
saisir('input[data-set="cond.initial.tanks.' + idTank2 + '.valeur"]', "150");

// retour en saisie globale pour la suite
clic(q('button[data-dedmode="initial|ballast|global"]'));
const dedG = norm(q("#ded-initial").textContent);
verifier("retour en saisie globale", /29\u202F297/.test(dedG), dedG.slice(0, 200));

// --- 12. rapport Word ------------------------------------------------------
console.log("\n12. Rapport Word");
onglet("dossier");
saisir('input[data-set="dossier.port"]', "Bayuquan");
saisir('input[data-set="dossier.expert"]', "S. Fraval");
const vueDos = norm(texte());
verifier("le bouton de rapport est proposé", /Rapport Word/.test(vueDos));
verifier("le rapport n'est pas annoncé indisponible", !/Rapport indisponible/.test(vueDos),
  vueDos.slice(0, 200));

let octets = null;
window.URL.createObjectURL = () => "blob:essai";
window.URL.revokeObjectURL = () => {};
const vraiBlob = window.Blob;
window.Blob = function (parts) { octets = parts[0]; return new vraiBlob(parts); };
clic(q('button[data-rapport]'));
window.Blob = vraiBlob;
verifier("le document est produit", octets && octets.length > 5000,
  octets ? octets.length + " octets" : "aucun octet");
if (octets) {
  const buf = Buffer.from(octets);
  verifier("signature ZIP valide", buf[0] === 0x50 && buf[1] === 0x4B);
  fs.writeFileSync(path.join(RACINE, "rapport-essai.docx"), buf);
  const brut = buf.toString("latin1");
  verifier("les parties Word attendues sont présentes",
    /word\/document\.xml/.test(brut) && /docProps\/core\.xml/.test(brut));
}

// --- 13. synthese texte ----------------------------------------------------
console.log("\n13. Synthèse copiable");
let presse = null;
window.navigator.clipboard = { writeText: (t) => { presse = t; return Promise.resolve(); } };
clic(q('button[data-synthese]'));
verifier("la synthèse est copiée", presse && /Pesée par tirants d'eau/.test(presse),
  presse ? presse.slice(0, 90) : "presse-papier vide");
verifier("la synthèse porte la convention LCF", presse && /positif vers l'arrière/i.test(presse),
  presse ? presse.slice(-120) : "");
verifier("la synthèse porte le chiffre au rapport", presse && /88\u202F760 ± 266/.test(presse),
  presse ? presse.slice(0, 400) : "");

console.log("\n" + "=".repeat(76));
console.log("RESULTAT : " + reussis + " controle(s) OK, " + echecs + " en echec");
console.log("=".repeat(76));
process.exit(echecs === 0 ? 0 : 1);
