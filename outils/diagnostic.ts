// Dit pourquoi l'historique est indisponible : fichier de clé, nom de variable, clé acceptée, réseaux activés.
// Usage : npm run diagnostic       (n'affiche jamais la clé)
import './env'
import { existsSync, readdirSync, readFileSync } from 'node:fs'

const racine = new URL('..', import.meta.url)
const fichiers = readdirSync(racine).filter((f) => f.startsWith('.env'))
console.log('\n1. Fichier de clé')
if (!fichiers.length) {
  console.log('   ✗ aucun fichier .env dans le dossier du projet')
  console.log('     → créer un fichier nommé exactement « .env.local », à côté de package.json,')
  console.log('       contenant une seule ligne : VITE_ALCHEMY_KEY=ta_clé')
} else {
  for (const f of fichiers) {
    const contenu = readFileSync(new URL(f, racine), 'utf8')
    const ligne = contenu.split(/\r?\n/).find((l) => l.trim().startsWith('VITE_ALCHEMY_KEY='))
    const autres = contenu
      .split(/\r?\n/)
      .filter((l) => l.includes('=') && !l.trim().startsWith('VITE_ALCHEMY_KEY=') && !l.trim().startsWith('#'))
      .map((l) => l.split('=')[0].trim())
    const marque = f === '.env.local' ? '✓' : '✗'
    console.log(`   ${marque} ${f}${f !== '.env.local' ? "  → Vite ne lit que « .env.local ». Windows a sans doute ajouté une extension : renommer le fichier." : ''}`)
    if (ligne) {
      const valeur = ligne.slice('VITE_ALCHEMY_KEY='.length).trim()
      const propre = valeur.replace(/^["']|["']$/g, '')
      console.log(`      VITE_ALCHEMY_KEY : ${propre.length} caractères${valeur !== propre ? ' (guillemets à retirer)' : ''}`)
    } else {
      console.log(`      ✗ pas de ligne VITE_ALCHEMY_KEY=… (noms trouvés : ${autres.join(', ') || 'aucun'})`)
    }
  }
}

const cle = process.env.VITE_ALCHEMY_KEY?.trim()
console.log('\n2. Clé vue par les outils')
console.log(cle ? `   ✓ clé chargée (${cle.length} caractères)` : '   ✗ aucune clé chargée : les points suivants ne peuvent pas être testés')

if (cle) {
  console.log('\n3. Réseaux Alchemy (à activer dans l’application, onglet Networks)')
  for (const [nom, reseau] of [
    ['Ethereum', 'eth-mainnet'],
    ['Base', 'base-mainnet'],
    ['Robinhood Chain', 'robinhood-mainnet'],
  ] as const) {
    try {
      const reponse = await fetch(`https://${reseau}.g.alchemy.com/v2/${cle}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      })
      const corps = (await reponse.json()) as { result?: string; error?: { message?: string } }
      if (corps.result) console.log(`   ✓ ${nom} : bloc ${BigInt(corps.result)}`)
      else {
        const message = (corps.error?.message ?? `HTTP ${reponse.status}`).split(cle).join('•••')
        console.log(`   ✗ ${nom} : ${message.slice(0, 140)}`)
      }
    } catch (e) {
      console.log(`   ✗ ${nom} : ${String(e).split(cle).join('•••').slice(0, 140)}`)
    }
  }
}

console.log('\n4. Après une modification du fichier')
console.log('   Vite lit .env.local au démarrage : arrêter le serveur (Ctrl+C) puis relancer « npm run dev ».')
console.log('   Sinon, coller la clé directement dans le champ de la page, sans fichier ni redémarrage.\n')
console.log(`   (fichier .env.local présent : ${existsSync(new URL('.env.local', racine)) ? 'oui' : 'non'})`)
