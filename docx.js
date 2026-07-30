// =============================================================================
// LA HUNE - Generateur .docx sans dependance
// =============================================================================
// Un fichier .docx est une archive ZIP contenant du XML (WordprocessingML).
// Plutot que d'embarquer une librairie de plusieurs centaines de kilo-octets,
// on ecrit l'archive directement. Les entrees sont stockees sans compression
// (methode 0), ce que Word, Pages, LibreOffice et Google Docs acceptent tous.
//
// Consequence architecturale : aucune ressource distante, aucun paquet a
// maintenir, aucune mise a jour tierce ne peut casser l'export.
//
// Accents et caracteres francais : tout est ecrit en UTF-8 et declare comme
// tel dans chaque partie XML. C'est ce qui manquait a jsPDF.
// =============================================================================

(function (global) {
  "use strict";

  // --- CRC-32, exige par l'en-tete ZIP ------------------------------------
  var TABLE_CRC = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(octets) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < octets.length; i++) {
      c = TABLE_CRC[(c ^ octets[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function utf8(texte) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(texte);
    // repli pour environnements anciens
    var s = unescape(encodeURIComponent(texte));
    var a = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
    return a;
  }

  // --- ecriture de l'archive ----------------------------------------------

  function ecrireZip(entrees) {
    var blocs = [], central = [], offset = 0;

    function u16(v) { return [v & 0xFF, (v >>> 8) & 0xFF]; }
    function u32(v) { return [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]; }

    // horodatage MS-DOS
    var d = new Date();
    var heureDos = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
    var dateDos = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);

    entrees.forEach(function (e) {
      var nom = utf8(e.nom);
      var data = typeof e.contenu === "string" ? utf8(e.contenu) : e.contenu;
      var crc = crc32(data);

      var local = [].concat(
        u32(0x04034B50),          // signature d'en-tete local
        u16(20),                  // version requise
        u16(0x0800),              // drapeau : nom de fichier en UTF-8
        u16(0),                   // methode 0 : stocke, sans compression
        u16(heureDos), u16(dateDos),
        u32(crc), u32(data.length), u32(data.length),
        u16(nom.length), u16(0)
      );
      blocs.push(new Uint8Array(local), nom, data);

      central.push([].concat(
        u32(0x02014B50),          // signature d'entree centrale
        u16(20), u16(20), u16(0x0800), u16(0),
        u16(heureDos), u16(dateDos),
        u32(crc), u32(data.length), u32(data.length),
        u16(nom.length), u16(0), u16(0),
        u16(0), u16(0), u32(0),
        u32(offset)
      ).concat(Array.from(nom)));

      offset += local.length + nom.length + data.length;
    });

    var debutCentral = offset, tailleCentral = 0;
    central.forEach(function (c) { tailleCentral += c.length; blocs.push(new Uint8Array(c)); });

    blocs.push(new Uint8Array([].concat(
      u32(0x06054B50), u16(0), u16(0),
      u16(entrees.length), u16(entrees.length),
      u32(tailleCentral), u32(debutCentral), u16(0)
    )));

    var total = blocs.reduce(function (n, b) { return n + b.length; }, 0);
    var sortie = new Uint8Array(total), p = 0;
    blocs.forEach(function (b) { sortie.set(b, p); p += b.length; });
    return sortie;
  }

  // --- echappement XML ----------------------------------------------------

  function esc(v) {
    if (v === null || v === undefined) return "";
    return String(v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&apos;")
      // caracteres de controle interdits en XML 1.0
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  }

  // --- fragments WordprocessingML ------------------------------------------

  var MARINE = "1C2E5C", CORAIL = "E85B3A", GRIS = "6B7280", TRAIT = "DDD6C9";

  function run(texte, o) {
    o = o || {};
    var rpr = "<w:rPr>";
    if (o.gras) rpr += "<w:b/>";
    if (o.italique) rpr += "<w:i/>";
    if (o.mono) rpr += '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>';
    if (o.taille) rpr += '<w:sz w:val="' + (o.taille * 2) + '"/>';
    if (o.couleur) rpr += '<w:color w:val="' + o.couleur + '"/>';
    if (o.majuscules) rpr += "<w:caps/>";
    if (o.espacement) rpr += '<w:spacing w:val="' + o.espacement + '"/>';
    rpr += "</w:rPr>";
    // xml:space preserve : sans cela Word supprime les espaces de tete
    return '<w:r>' + rpr + '<w:t xml:space="preserve">' + esc(texte) + "</w:t></w:r>";
  }

  function para(contenu, o) {
    o = o || {};
    var ppr = "<w:pPr>";
    if (o.style) ppr += '<w:pStyle w:val="' + o.style + '"/>';
    if (o.align) ppr += '<w:jc w:val="' + o.align + '"/>';
    ppr += '<w:spacing w:before="' + (o.avant || 0) + '" w:after="' + (o.apres === undefined ? 120 : o.apres) + '"/>';
    if (o.bordureBas) {
      ppr += '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="' + (o.couleurBordure || TRAIT) + '"/></w:pBdr>';
    }
    if (o.fond) ppr += '<w:shd w:val="clear" w:fill="' + o.fond + '"/>';
    ppr += "</w:pPr>";
    return "<w:p>" + ppr + contenu + "</w:p>";
  }

  function titre1(t) {
    return para(run(t, { gras: true, taille: 16, couleur: MARINE }), { avant: 240, apres: 60 });
  }
  function titre2(t) {
    return para(run(t, { gras: true, taille: 10, couleur: MARINE, majuscules: true, espacement: 24 }),
      { avant: 220, apres: 80, bordureBas: true });
  }
  function texte(t, o) {
    return para(run(t, Object.assign({ taille: 10 }, o || {})), { apres: 100 });
  }

  function cellule(v, o) {
    o = o || {};
    var largeur = o.largeur ? '<w:tcW w:w="' + o.largeur + '" w:type="dxa"/>' : "";
    var fond = o.fond ? '<w:shd w:val="clear" w:fill="' + o.fond + '"/>' : "";
    var contenu = para(run(v, {
      taille: o.taille || 9, gras: o.gras, mono: o.mono,
      couleur: o.couleur || (o.entete ? MARINE : null),
      majuscules: o.entete, espacement: o.entete ? 16 : 0
    }), { align: o.align || "left", apres: 0 });
    return "<w:tc><w:tcPr>" + largeur + fond +
      '<w:vAlign w:val="center"/><w:tcMar>' +
      '<w:top w:w="60" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/>' +
      '<w:left w:w="90" w:type="dxa"/><w:right w:w="90" w:type="dxa"/>' +
      "</w:tcMar></w:tcPr>" + contenu + "</w:tc>";
  }

  // tableau = { entetes: [..], lignes: [[..]], largeurs: [..], alignements: [..], mono: [bool] }
  function tableau(t) {
    var nb = (t.entetes || (t.lignes[0] || [])).length;
    var largeurs = t.largeurs || null;
    var align = t.alignements || [];
    var mono = t.mono || [];

    var bords = "<w:tblBorders>" +
      ['top', 'left', 'bottom', 'right'].map(function (c) {
        return '<w:' + c + ' w:val="none" w:sz="0" w:space="0" w:color="auto"/>';
      }).join("") +
      '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="' + TRAIT + '"/>' +
      '<w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/>' +
      "</w:tblBorders>";

    var x = '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>' + bords +
      '<w:tblLayout w:type="fixed"/></w:tblPr>';
    if (largeurs) {
      x += "<w:tblGrid>" + largeurs.map(function (w) { return '<w:gridCol w:w="' + w + '"/>'; }).join("") + "</w:tblGrid>";
    }
    if (t.entetes) {
      x += '<w:tr><w:trPr><w:tblHeader/></w:trPr>' + t.entetes.map(function (e, i) {
        return cellule(e, {
          entete: true, gras: true, taille: 8,
          largeur: largeurs ? largeurs[i] : null,
          align: align[i] || "left", fond: "F8F5EF"
        });
      }).join("") + "</w:tr>";
    }
    t.lignes.forEach(function (ligne) {
      x += "<w:tr>" + ligne.map(function (v, i) {
        return cellule(v, {
          largeur: largeurs ? largeurs[i] : null,
          align: align[i] || "left", mono: !!mono[i],
          gras: ligne.gras
        });
      }).join("") + "</w:tr>";
    });
    for (var k = (t.lignes[0] || []).length; k < nb; k++) { /* garde-fou de colonnes */ }
    return x + "</w:tbl>" + para("", { apres: 120 });
  }

  // --- parties de l'archive -----------------------------------------------

  function partieDocument(corps) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      "<w:body>" + corps +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1134" w:right="1021" w:bottom="1134" w:left="1021" ' +
      'w:header="709" w:footer="709" w:gutter="0"/></w:sectPr>' +
      "</w:body></w:document>";
  }

  function partieStyles() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      "<w:docDefaults><w:rPrDefault><w:rPr>" +
      '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>' +
      '<w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="fr-FR"/>' +
      "</w:rPr></w:rPrDefault>" +
      "<w:pPrDefault><w:pPr><w:spacing w:after=\"120\" w:line=\"259\" w:lineRule=\"auto\"/></w:pPr></w:pPrDefault>" +
      "</w:docDefaults>" +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">' +
      '<w:name w:val="Normal"/><w:qFormat/></w:style>' +
      "</w:styles>";
  }

  function partieTypes() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      "</Types>";
  }

  function partieRelsRacine() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      "</Relationships>";
  }

  function partieRelsDocument() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      "</Relationships>";
  }

  function partieCore(meta) {
    var iso = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      "<dc:title>" + esc(meta.titre || "") + "</dc:title>" +
      "<dc:subject>" + esc(meta.sujet || "") + "</dc:subject>" +
      "<dc:creator>" + esc(meta.auteur || "LA HUNE") + "</dc:creator>" +
      "<cp:lastModifiedBy>" + esc(meta.auteur || "LA HUNE") + "</cp:lastModifiedBy>" +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + iso + "</dcterms:created>" +
      '<dcterms:modified xsi:type="dcterms:W3CDTF">' + iso + "</dcterms:modified>" +
      "<cp:revision>1</cp:revision>" +
      "</cp:coreProperties>";
  }

  function partieApp() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
      'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
      "<Application>LA HUNE Draft Survey</Application>" +
      "<Company>LA HUNE</Company>" +
      "</Properties>";
  }

  // --- API ----------------------------------------------------------------
  //
  // blocs acceptes :
  //   { type: "titre",      texte }
  //   { type: "soustitre",  texte }
  //   { type: "texte",      texte, gras, italique, couleur }
  //   { type: "tableau",    entetes, lignes, largeurs, alignements, mono }
  //   { type: "paires",     lignes: [[libelle, valeur], ...] }
  //   { type: "encadre",    texte }
  //   { type: "journal",    lignes: [..] }
  //   { type: "saut" }

  function construire(o) {
    var corps = "";

    // en-tete de document : identite du cabinet
    corps += para(
      run("LA HUNE.", { gras: true, taille: 11, couleur: MARINE, espacement: 60 }),
      { apres: 0 }
    );
    corps += para(
      run("Cabinet d'expertise maritime indépendant", { taille: 8, couleur: GRIS }),
      { apres: 160, bordureBas: true, couleurBordure: MARINE }
    );

    (o.blocs || []).forEach(function (b) {
      switch (b.type) {
        case "titre":
          corps += titre1(b.texte);
          break;
        case "soustitre":
          corps += titre2(b.texte);
          break;
        case "texte":
          corps += texte(b.texte, { gras: b.gras, italique: b.italique, couleur: b.couleur });
          break;
        case "tableau":
          corps += tableau(b);
          break;
        case "paires":
          corps += tableau({
            lignes: b.lignes,
            largeurs: b.largeurs || [6200, 2800],
            alignements: ["left", "right"],
            mono: [false, true]
          });
          break;
        case "encadre":
          corps += para(run(b.texte, { taille: 9, couleur: MARINE }),
            { fond: "F8F5EF", avant: 60, apres: 140 });
          break;
        case "journal":
          (b.lignes || []).forEach(function (l) {
            corps += para(run(l, { taille: 8, mono: true, couleur: "333333" }), { apres: 20 });
          });
          corps += para("", { apres: 120 });
          break;
        case "saut":
          corps += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
          break;
        default:
          break;
      }
    });

    if (o.pied) {
      corps += para(run(o.pied, { taille: 7, couleur: GRIS, italique: true }),
        { avant: 240, bordureBas: false });
    }

    return ecrireZip([
      { nom: "[Content_Types].xml", contenu: partieTypes() },
      { nom: "_rels/.rels", contenu: partieRelsRacine() },
      { nom: "word/document.xml", contenu: partieDocument(corps) },
      { nom: "word/_rels/document.xml.rels", contenu: partieRelsDocument() },
      { nom: "word/styles.xml", contenu: partieStyles() },
      { nom: "docProps/core.xml", contenu: partieCore(o.meta || {}) },
      { nom: "docProps/app.xml", contenu: partieApp() }
    ]);
  }

  // Declenche le telechargement depuis le navigateur.
  function telecharger(octets, nomFichier) {
    var blob = new Blob([octets], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = nomFichier;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  global.DocxLaHune = {
    version: "1.0.0",
    construire: construire,
    telecharger: telecharger,
    crc32: crc32,
    utf8: utf8
  };
})(typeof window !== "undefined" ? window : globalThis);
