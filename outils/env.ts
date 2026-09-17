// Charge .env.local pour les outils en Node (Vite le fait tout seul pour la page).
// À importer en premier : les modules du moteur lisent la clé à leur chargement.
import { existsSync, readFileSync } from 'node:fs'

const chemin = new URL('../.env.local', import.meta.url)
if (existsSync(chemin)) {
  for (const ligne of readFileSync(chemin, 'utf8').split(/\r?\n/)) {
    const m = ligne.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
