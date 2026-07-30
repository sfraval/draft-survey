// =============================================================================
// LA HUNE - Draft Survey : service worker
// =============================================================================
// Objectif unique : que l'outil s'ouvre sur un quai, sans reseau.
//
// Le piege classique du cache-first, et c'est celui de la v2, est de servir
// indefiniment une version perimee. La parade tient en trois points :
//
//   1. Le nom du cache porte un numero de version. Un changement de version
//      cree un cache neuf ; l'ancien est supprime a l'activation.
//   2. skipWaiting et clients.claim : la nouvelle version prend la main tout de
//      suite, sans attendre la fermeture de tous les onglets.
//   3. Pour les pages, on tente le reseau d'abord et on retombe sur le cache.
//      Pour les fichiers de l'application, on sert le cache et on rafraichit en
//      arriere-plan. Le calcul reste donc disponible hors reseau, sans figer
//      indefiniment une version fausse.
//
// La liste ci-dessous est verifiee par l'audit d'architecture : ajouter un
// fichier a l'application sans l'ajouter ici casserait le fonctionnement hors
// reseau, et la chaine d'integration refuse ce cas.
// =============================================================================

var VERSION = "3.0.0";
var CACHE = "lahune-draft-survey-" + VERSION;

var FICHIERS = [
  "./",
  "./index.html",
  "./style.css",
  "./engine.js",
  "./docx.js",
  "./app.js",
  "./bench.js",
  "./hydro-evership.js",
  "./validation.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // addAll echoue en bloc si un seul fichier manque, ce qui est le
      // comportement voulu : une installation partielle donnerait un outil
      // a moitie disponible hors reseau, sans que rien ne le signale.
      return c.addAll(FICHIERS);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (noms) {
      return Promise.all(noms.map(function (n) {
        if (n !== CACHE) return caches.delete(n);
        return null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  // Pages : reseau d'abord, cache en secours. Evite de rester bloque sur une
  // ancienne version de l'interface quand le reseau est disponible.
  if (req.mode === "navigate" || (req.headers.get("accept") || "").indexOf("text/html") >= 0) {
    e.respondWith(
      fetch(req).then(function (rep) {
        var copie = rep.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copie); });
        return rep;
      }).catch(function () {
        return caches.match(req).then(function (r) {
          return r || caches.match("./index.html");
        });
      })
    );
    return;
  }

  // Fichiers de l'application : cache d'abord pour la vitesse et le hors
  // reseau, rafraichissement silencieux derriere.
  e.respondWith(
    caches.match(req).then(function (r) {
      var reseau = fetch(req).then(function (rep) {
        if (rep && rep.ok) {
          var copie = rep.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copie); });
        }
        return rep;
      }).catch(function () { return r; });
      return r || reseau;
    })
  );
});

// Permet a l'interface de connaitre la version servie, et de forcer une mise
// a jour immediate si besoin.
self.addEventListener("message", function (e) {
  if (!e.data) return;
  if (e.data === "version" && e.source) e.source.postMessage({ version: VERSION });
  if (e.data === "maj") self.skipWaiting();
});
