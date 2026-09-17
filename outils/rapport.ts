// Rapport texte des positions d'un wallet : les six fonctions, pour comparer avec Krystal.
// Usage : npm run rapport -- 0xAdresse   (l'adresse n'est écrite nulle part)
import './env'
import { getAddress, isAddress } from 'viem'
import { analyser, horodatagesUtiles, type Analyse } from '../src/moteur/analyse'
import { AERODROME, CHAINES } from '../src/moteur/chaines'
import { lireEtats } from '../src/moteur/etat'
import { reconstruireHistorique, type Historique } from '../src/moteur/historique'
import { listerPositions, message } from '../src/moteur/lister'
import { lisible } from '../src/moteur/maths'
import { cleDePrix, prixActuels, prixHistoriquesGroupes, type Prix } from '../src/moteur/prix'
import * as F from '../src/ui/format'

const saisie = process.argv[2]
if (!saisie || !isAddress(saisie)) {
  console.error('usage : npm run rapport -- 0xAdresseDuWallet')
  process.exit(1)
}
const wallet = getAddress(saisie)
const chrono = Date.now()
const secondes = () => ((Date.now() - chrono) / 1000).toFixed(1)

console.log(`Wallet ${wallet.slice(0, 6)}…${wallet.slice(-4)}`)
const inventaire = await listerPositions(wallet)
console.log(`${inventaire.positions.length} position(s) ouverte(s), ${inventaire.fermees} vide(s) ignorée(s) — ${secondes()} s`)
for (const e of inventaire.erreurs) console.log(`  ! ${e}`)
if (!inventaire.positions.length) process.exit(0)

const etats = await lireEtats(inventaire.positions, wallet)
const prixDuJour = await prixActuels([
  ...etats.flatMap((e) => [cleDePrix(e.ref.chaine, e.jeton0.adresse), cleDePrix(e.ref.chaine, e.jeton1.adresse)]),
  cleDePrix('base', AERODROME.aero),
])
console.log(`état actuel et prix lus — ${secondes()} s`)

const resultats = await Promise.all(
  etats.map(async (etat) => {
    let historique: Historique | null = null
    let erreur: string | null = null
    try {
      historique = await reconstruireHistorique(etat)
    } catch (e) {
      erreur = message(e)
    }
    const cles = [cleDePrix(etat.ref.chaine, etat.jeton0.adresse), cleDePrix(etat.ref.chaine, etat.jeton1.adresse)]
    const passes = historique
      ? await prixHistoriquesGroupes(cles, horodatagesUtiles(historique)).catch(() => new Map<number, Prix>())
      : new Map<number, Prix>()
    return { analyse: analyser(etat, historique, prixDuJour, passes), erreur }
  }),
)

function afficher(a: Analyse, erreur: string | null) {
  const e = a.etat
  const s = F.sens(e.jeton0.symbole, e.jeton1.symbole)
  const h = a.historique
  const protocole = e.ref.protocole === 'aerodrome' ? 'Aerodrome' : 'Uniswap v3'
  const statut = [e.ref.gauge ? 'stakée' : null, e.dansLaFourchette ? 'DANS la fourchette' : 'HORS fourchette'].filter(Boolean).join(' · ')
  const [pBas, pHaut] = [s.prix(e.prixBas), s.prix(e.prixHaut)].sort((x, y) => x - y)
  const prix = s.prix(e.prix)
  console.log(`\n━━━ ${e.jeton0.symbole}/${e.jeton1.symbole} · ${protocole} (${CHAINES[e.ref.chaine].nom}) #${e.ref.id} · ${statut}`)
  console.log(`  Prix           1 ${s.base} = ${F.nombre(prix)} ${s.cotation}   (fourchette ${F.nombre(pBas)} – ${F.nombre(pHaut)})`)
  console.log(`  Valeur         ${F.dollars(a.valeurUsd)}   (${F.nombre(e.quantite0)} ${e.jeton0.symbole} + ${F.nombre(e.quantite1)} ${e.jeton1.symbole})`)
  if (!h) {
    console.log(`  Historique     indisponible : ${erreur}`)
    return
  }
  const depots = h.mouvements.filter((m) => m.type === 'depot').length
  const retraits = h.mouvements.length - depots
  console.log(`  1. Investi     ${F.dollars(a.investiUsd)}   ouverte le ${F.date(h.ouverture.horodatage)} (${depots} dépôt${depots > 1 ? 's' : ''}${retraits ? `, ${retraits} retrait${retraits > 1 ? 's' : ''}` : ''})`)
  if (a.entree) {
    console.log(`  2. Entrée      1 ${s.base} = ${F.nombre(s.prix(a.entree.prix))} ${s.cotation}   (${e.jeton0.symbole} ${F.dollars(a.entree.usd0)}, ${e.jeton1.symbole} ${F.dollars(a.entree.usd1)})`)
  }
  const aero = a.aero > 0 ? ` + ${F.nombre(a.aero)} AERO` : ''
  console.log(`  3. Rendement   ${F.dollars(a.rendementUsd)}   (fees ${F.nombre(a.fees0)} ${e.jeton0.symbole} + ${F.nombre(a.fees1)} ${e.jeton1.symbole}${aero})`)
  const approximatifs = a.retraitsDeFees.filter((r) => r.prixDuJour).length
  console.log(
    `     au retrait ${F.dollars(a.feesRetireesUsd)} sur ${a.retraitsDeFees.length} retrait(s) de fees, chacun au prix de sa date` +
      `${approximatifs ? ` (${approximatifs} sans cotation, au prix du jour)` : ''} · en attente ${F.dollars(a.feesEnAttenteUsd)}`,
  )
  console.log(`  4. Projection  APR ${F.pourcent(a.aprPourcent)} par an   (moyenne sur ${F.duree(a.jours)})`)
  const be = a.breakEven
  let zone = 'aucune zone de prix où la position rattrape le HODL'
  if (be.existe) {
    const [b, hh] = [be.bas, be.haut].map((p) => (p === null ? null : s.prix(p)))
    const [bas, haut] = s.inverse ? [hh, b] : [b, hh]
    const texte = bas !== null && haut !== null ? `entre ${F.nombre(bas)} et ${F.nombre(haut)}` : bas !== null ? `au-dessus de ${F.nombre(bas)}` : `en dessous de ${F.nombre(haut)}`
    zone = be.enAvance ? `bat le HODL tant que 1 ${s.base} reste ${texte} ${s.cotation}` : `repasserait devant si 1 ${s.base} allait ${texte} ${s.cotation}`
  }
  console.log(`  5. vs HODL     ${F.dollars(a.avanceSurHodlUsd, true)} aujourd'hui · ${zone}`)
  console.log(`  6. Alerte      à venir`)
  const attenteAero = e.ref.gauge ? ` · AERO ${F.nombre(lisible(e.aeroEnAttente, 18))} (${F.dollars(a.aeroEnAttenteUsd)})` : ''
  console.log(`  En attente     fees ${F.dollars(a.feesEnAttenteUsd)}${attenteAero}`)
  const stake = h.periodesStakees.length ? ` · ${h.periodesStakees.length} période(s) stakée(s)${h.penalites > 0n ? `, pénalités ${F.nombre(lisible(h.penalites, 18))} AERO` : ''}` : ''
  console.log(`  Journal        ${h.requetes} requête(s), ${h.secondes.toFixed(1)} s · ${h.reclamations.length} retrait(s) de fees${stake}`)
  for (const r of a.retraitsDeFees) {
    console.log(`     ${F.dateHeure(r.horodatage)}  ${F.nombre(r.fees0)} ${e.jeton0.symbole} + ${F.nombre(r.fees1)} ${e.jeton1.symbole} = ${F.dollars(r.usd)}${r.prixDuJour ? ' (prix du jour)' : ''}`)
  }
}

for (const r of resultats) afficher(r.analyse, r.erreur)
console.log(`\nTerminé en ${secondes()} s`)
