#!/bin/bash
# Strona dla Twojej Firmy — Mac launcher
# Dubbelklik dit bestand om het dashboard te starten + browser te openen.
# (Houdt deze terminal open zolang het dashboard draait.)

cd "$(dirname "$0")/dashboard" || { echo "dashboard/ niet gevonden"; read; exit 1; }

# Als poort al bezet → open alleen browser
if lsof -i :3000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "✓ Dashboard draait al op poort 3000"
  open "http://localhost:3000"
  exit 0
fi

# Check Node modules
if [ ! -d "node_modules" ]; then
  echo "→ Eerste keer: npm install draait..."
  npm install || { echo "npm install faalde"; read; exit 1; }
fi

# Start dev server
echo "→ Dashboard starten op http://localhost:3000 ..."
echo "  (Sluit dit terminal-venster om te stoppen)"
echo ""

# Wait until ready, then open browser
(
  for _ in $(seq 1 40); do
    sleep 0.5
    if curl -s -o /dev/null http://localhost:3000; then
      open "http://localhost:3000"
      break
    fi
  done
) &

exec npm run dev
