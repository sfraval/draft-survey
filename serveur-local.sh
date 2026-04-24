#!/bin/bash
# =============================================================================
# LA HUNE — Draft Survey : lanceur local
# =============================================================================
# Démarre un serveur web local pour utiliser la PWA depuis ton Mac ou
# depuis ton téléphone (sur le même wifi).
# =============================================================================

PORT=8443
DIR="$(cd "$(dirname "$0")" && pwd)"

cd "$DIR" || exit 1

# Python3 est préinstallé sur macOS
if ! command -v python3 >/dev/null 2>&1; then
  echo "✗ Python 3 n'est pas installé. Installe-le via : brew install python3"
  exit 1
fi

# IP locale du Mac (pour l'accès depuis le téléphone)
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "—")

cat <<EOF

 ╔════════════════════════════════════════════════════════════════╗
 ║  LA HUNE — Draft Survey                                        ║
 ║  Serveur local démarré                                         ║
 ╠════════════════════════════════════════════════════════════════╣
 ║                                                                ║
 ║   Depuis ce Mac :                                              ║
 ║     http://localhost:${PORT}                                       ║
 ║                                                                ║
 ║   Depuis ton téléphone (même wifi que le Mac) :                ║
 ║     http://${LOCAL_IP}:${PORT}
 ║                                                                ║
 ║   Pour arrêter : Ctrl+C                                        ║
 ║                                                                ║
 ╚════════════════════════════════════════════════════════════════╝

EOF

# Serveur HTTP simple de Python
python3 -m http.server "$PORT"
