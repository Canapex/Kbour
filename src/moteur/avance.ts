// Chiffres avancés : tout ce que l'état et le journal permettent de déduire, sans une requête de plus.
// Chaque mesure est définie en clair dans l'onglet « Avancé » ; aucune n'est un indicateur maison.

import type { Analyse } from './analyse'
import { lisible } from './maths'

/** Somme qui refuse de mentir : un seul terme inconnu et le total est inconnu. */
function plus(...valeurs: (number | null)[]): number | null {
  let total = 0
  for (const v of valeurs) {
    if (v === null || !Number.isFinite(v)) return null
    total += v
  }
  return total
}

const moins = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : a - b)

/** a rapporté à b, en pourcentage. */
const part = (a: number | null, b: number | null): number | null => (a === null || b === null || b === 0 ? null : (a / b) * 100)

export interface Avance {
  // Résultat
  capitalMoyenUsd: number | null
  entreUsd: number | null
  sortiUsd: number | null
  resteUsd: number | null
  pnlUsd: number | null
  roiPourcent: number | null
  roiAnnualisePourcent: number | null
  gainActifsUsd: number | null
  feesTotalUsd: number | null
  /** Ce que la position a coûté en gas, et la part des fees qu'il n'a pas mangée. */
  gazUsd: number | null
  efficacitePourcent: number | null
  // Face au HODL
  hodlUsd: number | null
  ecartHodlUsd: number | null
  divergenceUsd: number | null
  retentionPourcent: number | null
  vsTout0Pourcent: number | null
  vsTout1Pourcent: number | null
  // Fees
  fees0Usd: number | null
  fees1Usd: number | null
  feesEncaisseesUsd: number | null
  feesAttenteUsd: number | null
  partEncaisseePourcent: number | null
  feesParJourUsd: number | null
  aprRecentPourcent: number | null
  joursDepuisFees: number | null
  aeroReclames: number
  aeroReclamesUsd: number | null
  // Prix
  entree0: number | null
  entree1: number | null
  sortie0: number | null
  sortie1: number | null
  variation0Pourcent: number | null
  variation1Pourcent: number | null
  // Pool et fourchette
  largeurPourcent: number
  valeur0Usd: number | null
  valeur1Usd: number | null
  partJeton0Pourcent: number | null
  tvlPoolUsd: number | null
  partDuPoolPourcent: number | null
  partLiquiditePourcent: number | null
  fraisPoolPourcent: number | null
  // Chronologie
  operations: number
  transactions: number
  fermeture: number | null
}

/** Prix moyen d'un jeton sur un sens de mouvement, pondéré par les quantités. */
function prixMoyen(mouvements: Analyse['mouvementsUsd'], type: 'depot' | 'retrait', jeton: 0 | 1): number | null {
  let quantite = 0
  let usd = 0
  for (const m of mouvements) {
    if (m.type !== type) continue
    const q = jeton === 0 ? m.quantite0 : m.quantite1
    const p = jeton === 0 ? m.usd0 : m.usd1
    if (p === null || q <= 0) continue
    quantite += q
    usd += q * p
  }
  return quantite > 0 ? usd / quantite : null
}

/**
 * Sans le journal, la moitié des mesures est hors de portée : elles valent null,
 * et tout ce qui se lit dans la photo du pool reste affichable.
 */
export function metriquesAvancees(a: Analyse): Avance {
  const h = a.historique
  const e = a.etat

  // Les AERO déjà réclamés : le total gagné moins ce qui reste à réclamer.
  const aeroReclames = Math.max(0, a.aero - lisible(e.aeroEnAttente, 18))
  const aeroReclamesUsd = a.usdAero !== null ? aeroReclames * a.usdAero : aeroReclames > 0 ? null : 0
  const aeroAttenteUsd = e.ref.protocole === 'aerodrome' ? a.aeroEnAttenteUsd : 0

  const feesEncaisseesUsd = plus(a.feesRetireesUsd, aeroReclamesUsd)
  const feesAttenteUsd = plus(a.feesEnAttenteUsd, aeroAttenteUsd)
  const feesTotalUsd = plus(feesEncaisseesUsd, feesAttenteUsd)
  const sortiUsd = plus(a.retireUsd, feesEncaisseesUsd)
  const resteUsd = plus(a.valeurUsd, feesAttenteUsd)
  const pnlUsd = moins(plus(sortiUsd, resteUsd), a.investiUsd)
  const roiPourcent = part(pnlUsd, a.investiUsd)

  const entree0 = prixMoyen(a.mouvementsUsd, 'depot', 0) ?? a.entree?.usd0 ?? null
  const entree1 = prixMoyen(a.mouvementsUsd, 'depot', 1) ?? a.entree?.usd1 ?? null
  const variation0Pourcent = part(moins(a.usd0, entree0), entree0)
  const variation1Pourcent = part(moins(a.usd1, entree1), entree1)

  const dernierRetrait = !h ? null : h.reclamations.length ? h.reclamations[h.reclamations.length - 1].horodatage : h.ouverture.horodatage
  const joursDepuisFees = dernierRetrait === null ? 0 : (e.horodatage - dernierRetrait) / 86_400
  const valeurVive = a.valeurUsd && a.valeurUsd > 0 ? a.valeurUsd : null

  // Position fermée : l'IL se mesure le jour où elle a été vidée — le capital retiré, face aux jetons
  // déposés valorisés à ce même jour —, pas aux prix d'aujourd'hui.
  const derniereSortie = [...a.mouvementsUsd].reverse().find((mv) => mv.type === 'retrait')
  const ilCloture =
    a.fermee && derniereSortie && derniereSortie.usd0 !== null && derniereSortie.usd1 !== null && a.retireUsd !== null
      ? a.retireUsd - (a.depose0 * derniereSortie.usd0 + a.depose1 * derniereSortie.usd1)
      : null

  const [bas, haut] = [e.prixBas, e.prixHaut].sort((x, y) => x - y)
  const valeur0Usd = a.usd0 !== null ? e.quantite0 * a.usd0 : null
  const valeur1Usd = a.usd1 !== null ? e.quantite1 * a.usd1 : null
  const tvlPoolUsd =
    e.reserve0 !== null && e.reserve1 !== null && a.usd0 !== null && a.usd1 !== null
      ? e.reserve0 * a.usd0 + e.reserve1 * a.usd1
      : null

  return {
    capitalMoyenUsd: a.capitalMoyenUsd,
    entreUsd: a.investiUsd,
    sortiUsd,
    resteUsd,
    pnlUsd,
    roiPourcent,
    // Le même rendement ramené à l'année, pour comparer des positions de durées différentes.
    roiAnnualisePourcent: roiPourcent !== null && a.jours && a.jours > 0 ? (roiPourcent * 365) / a.jours : null,
    gainActifsUsd: moins(pnlUsd, feesTotalUsd),
    feesTotalUsd,
    gazUsd: a.gazUsd,
    efficacitePourcent:
      a.gazUsd !== null && feesTotalUsd !== null && feesTotalUsd > a.gazUsd ? (1 - a.gazUsd / feesTotalUsd) * 100 : null,

    hodlUsd: h && a.usd0 !== null && a.usd1 !== null ? a.depose0 * a.usd0 + a.depose1 * a.usd1 : null,
    ecartHodlUsd: a.fermee ? a.avanceClotureUsd : a.avanceSurHodlUsd,
    divergenceUsd: a.fermee ? ilCloture : moins(a.avanceSurHodlUsd, a.rendementUsd),
    retentionPourcent: a.fermee
      ? feesTotalUsd && feesTotalUsd > 0 && ilCloture !== null
        ? ((feesTotalUsd + ilCloture) / feesTotalUsd) * 100
        : null
      : a.rendementUsd && a.rendementUsd > 0
        ? part(a.avanceSurHodlUsd, a.rendementUsd)
        : null,
    vsTout0Pourcent: moins(roiPourcent, variation0Pourcent),
    vsTout1Pourcent: moins(roiPourcent, variation1Pourcent),

    fees0Usd: a.usd0 !== null ? a.fees0 * a.usd0 : null,
    fees1Usd: a.usd1 !== null ? a.fees1 * a.usd1 : null,
    feesEncaisseesUsd,
    feesAttenteUsd,
    partEncaisseePourcent: part(feesEncaisseesUsd, feesTotalUsd),
    feesParJourUsd: a.rendementUsd !== null && a.jours && a.jours > 0 ? a.rendementUsd / a.jours : null,
    // Rythme des seules fees accumulées depuis le dernier retrait : le « maintenant », pas la moyenne de la vie.
    aprRecentPourcent:
      valeurVive !== null && feesAttenteUsd !== null && joursDepuisFees > 0.25
        ? (feesAttenteUsd / valeurVive) * (365 / joursDepuisFees) * 100
        : null,
    joursDepuisFees: h && h.reclamations.length ? joursDepuisFees : null,
    aeroReclames,
    aeroReclamesUsd,

    entree0,
    entree1,
    sortie0: prixMoyen(a.mouvementsUsd, 'retrait', 0),
    sortie1: prixMoyen(a.mouvementsUsd, 'retrait', 1),
    variation0Pourcent,
    variation1Pourcent,

    largeurPourcent: ((haut - bas) / ((haut + bas) / 2)) * 100,
    valeur0Usd,
    valeur1Usd,
    partJeton0Pourcent: part(valeur0Usd, a.valeurUsd),
    tvlPoolUsd,
    partDuPoolPourcent: part(a.valeurUsd, tvlPoolUsd),
    partLiquiditePourcent:
      e.dansLaFourchette && e.liquiditeActive && e.liquiditeActive > 0n
        ? (Number(e.liquidite) / Number(e.liquiditeActive)) * 100
        : null,
    fraisPoolPourcent: e.fraisPool !== null ? e.fraisPool / 10_000 : null,

    operations: h ? h.mouvements.length + h.reclamations.length : 0,
    transactions: a.transactions,
    fermeture: a.cloture?.horodatage ?? null,
  }
}
