import { AERODROME } from './chaines'
import { estStable } from './jetons'
import type { Historique } from './historique'
import { avanceSurHodl, lisible, prixDeBreakEven, type Comparaison } from './maths'
import { CLE_GAZ, cleDePrix, type Prix } from './prix'
import type { EtatPosition } from './types'

/** Les six fonctions demandées, pour une position. Montants en dollars aux prix du jour sauf mention. */
export interface Analyse {
  etat: EtatPosition
  usd0: number | null
  usd1: number | null
  usdAero: number | null
  valeurUsd: number | null
  feesEnAttenteUsd: number | null
  aeroEnAttenteUsd: number | null
  historique: Historique | null
  /** Position vidée : plus de liquidité, seule son histoire reste. */
  fermee: boolean
  /** Dernier retrait de capital : date et prix du pool à ce moment-là. */
  cloture: { horodatage: number; prix: number } | null
  /** Capital retiré, valorisé au prix du jour de chaque retrait. */
  retireUsd: number | null
  /** Face au HODL au moment de la fermeture (et non aux prix d'aujourd'hui). */
  avanceClotureUsd: number | null
  /** 1. Montant investi : dépôts valorisés au prix du jour de chaque dépôt. */
  investiUsd: number | null
  depose0: number
  depose1: number
  retire0: number
  retire1: number
  /** 2. Prix à l'entrée (premier dépôt). */
  entree: { horodatage: number; prix: number; usd0: number | null; usd1: number | null } | null
  /** 3. Rendement depuis l'ouverture (fees de toutes les tranches libres + AERO des tranches stakées). */
  fees0: number
  fees1: number
  aero: number
  rendementUsd: number | null
  /** Chaque retrait de fees valorisé au prix de sa date ; `prixDuJour` si le prix passé manquait. */
  retraitsDeFees: { horodatage: number; fees0: number; fees1: number; usd: number | null; prixDuJour: boolean }[]
  /** Somme des retraits de fees, chacun au prix du moment où il a été retiré. */
  feesRetireesUsd: number | null
  /** 4. Projection annuelle, sur le capital moyen engagé depuis l'ouverture. */
  aprPourcent: number | null
  jours: number | null
  /** Capital réellement engagé, pondéré par le temps : la base du calcul ci-dessus. */
  capitalMoyenUsd: number | null
  /** Gas payé par toutes les transactions de la position, chacune au prix de l'ETH de sa date. */
  gazUsd: number | null
  /** Nombre de transactions qui ont touché la position. */
  transactions: number
  /** Chaque dépôt et retrait de capital valorisé au prix de sa date (repli sur le prix du jour). */
  mouvementsUsd: {
    type: 'depot' | 'retrait'
    horodatage: number
    quantite0: number
    quantite1: number
    usd0: number | null
    usd1: number | null
    usd: number | null
  }[]
  /**
   * 5. Face au HODL : avance actuelle, et zone de prix (jeton0 en jeton1) où la position bat le HODL.
   * Si elle est en avance, c'est la zone qui contient le prix actuel ; sinon la plus proche.
   * Une borne null veut dire « pas de limite de ce côté » (au-delà de ×1000).
   */
  avanceSurHodlUsd: number | null
  breakEven: { enAvance: boolean; bas: number | null; haut: number | null; existe: boolean }
}

/** Prix en dollars des deux jetons ; si un seul est connu, le prix du pool donne l'autre. */
function prixDesJetons(prix: Prix, etat: EtatPosition, prixDuPool: number): [number | null, number | null] {
  let u0 = prix.get(cleDePrix(etat.ref.chaine, etat.jeton0.adresse)) ?? null
  let u1 = prix.get(cleDePrix(etat.ref.chaine, etat.jeton1.adresse)) ?? null
  if (u0 === null && u1 !== null) u0 = prixDuPool * u1
  if (u1 === null && u0 !== null && prixDuPool > 0) u1 = u0 / prixDuPool
  return [u0, u1]
}

export function analyser(
  etat: EtatPosition,
  historique: Historique | null,
  prixDuJour: Prix,
  prixPasses: Map<number, Prix>,
): Analyse {
  const d0 = etat.jeton0.decimales
  const d1 = etat.jeton1.decimales
  const [usd0, usd1] = prixDesJetons(prixDuJour, etat, etat.prix)
  const usdAero = etat.ref.protocole === 'aerodrome' ? prixDuJour.get(cleDePrix('base', AERODROME.aero)) ?? null : null
  const enUsd = (q0: number, q1: number) => (usd0 !== null && usd1 !== null ? q0 * usd0 + q1 * usd1 : null)

  const analyse: Analyse = {
    etat,
    usd0,
    usd1,
    usdAero,
    valeurUsd: enUsd(etat.quantite0, etat.quantite1),
    feesEnAttenteUsd: enUsd(lisible(etat.feesEnAttente0, d0), lisible(etat.feesEnAttente1, d1)),
    aeroEnAttenteUsd: usdAero !== null ? lisible(etat.aeroEnAttente, 18) * usdAero : null,
    historique,
    fermee: etat.liquidite === 0n,
    cloture: null,
    retireUsd: 0,
    avanceClotureUsd: null,
    investiUsd: null,
    depose0: 0,
    depose1: 0,
    retire0: 0,
    retire1: 0,
    entree: null,
    fees0: 0,
    fees1: 0,
    aero: 0,
    rendementUsd: null,
    retraitsDeFees: [],
    feesRetireesUsd: null,
    aprPourcent: null,
    jours: null,
    capitalMoyenUsd: null,
    gazUsd: null,
    transactions: 0,
    mouvementsUsd: [],
    avanceSurHodlUsd: null,
    breakEven: { enAvance: false, bas: null, haut: null, existe: false },
  }
  if (!historique) return analyse

  // 1. Montant investi, et flux de capital pour la moyenne pondérée dans le temps.
  let investi: number | null = 0
  const flux: { horodatage: number; usd: number }[] = []
  for (const m of historique.mouvements) {
    const [p0, p1] = prixDesJetons(prixPasses.get(m.horodatage) ?? new Map(), etat, m.prix)
    const u0 = p0 ?? usd0
    const u1 = p1 ?? usd1
    const usd = u0 !== null && u1 !== null ? m.quantite0 * u0 + m.quantite1 * u1 : null
    if (m.type === 'depot') {
      analyse.depose0 += m.quantite0
      analyse.depose1 += m.quantite1
      investi = investi !== null && usd !== null ? investi + usd : null
    } else {
      analyse.retire0 += m.quantite0
      analyse.retire1 += m.quantite1
      analyse.retireUsd = analyse.retireUsd !== null && usd !== null ? analyse.retireUsd + usd : null
      analyse.cloture = { horodatage: m.horodatage, prix: m.prix }
    }
    analyse.mouvementsUsd.push({
      type: m.type,
      horodatage: m.horodatage,
      quantite0: m.quantite0,
      quantite1: m.quantite1,
      usd0: u0,
      usd1: u1,
      usd,
    })
    if (usd !== null) flux.push({ horodatage: m.horodatage, usd: m.type === 'depot' ? usd : -usd })
  }
  analyse.investiUsd = investi

  // Coût en gas : chaque transaction au prix de l'ETH du jour où elle a été envoyée.
  // Un reçu illisible compte pour zéro : le total est alors un minimum, signalé par historique.gazConnu.
  analyse.transactions = historique.transactions.length
  const prixGazDuJour = prixDuJour.get(CLE_GAZ) ?? null
  let gaz: number | null = 0
  for (const t of historique.transactions) {
    const prixEth = prixPasses.get(t.horodatage)?.get(CLE_GAZ) ?? prixGazDuJour
    if (prixEth === null || gaz === null) gaz = null
    else gaz += (Number(t.gaz) / 1e18) * prixEth
  }
  analyse.gazUsd = gaz

  // 2. Prix à l'entrée : celui du premier dépôt.
  const premier = historique.mouvements.find((m) => m.type === 'depot')
  if (premier) {
    const [p0, p1] = prixDesJetons(prixPasses.get(premier.horodatage) ?? new Map(), etat, premier.prix)
    analyse.entree = { horodatage: premier.horodatage, prix: premier.prix, usd0: p0, usd1: p1 }
  }

  // 3. Rendement : fees et AERO gagnés depuis l'ouverture, aux prix du jour.
  analyse.fees0 = lisible(historique.fees0, d0)
  analyse.fees1 = lisible(historique.fees1, d1)
  analyse.aero = lisible(historique.aero, 18)
  const feesUsd = enUsd(analyse.fees0, analyse.fees1)
  const aeroUsd = analyse.aero > 0 ? (usdAero !== null ? analyse.aero * usdAero : null) : 0
  analyse.rendementUsd = feesUsd !== null && aeroUsd !== null ? feesUsd + aeroUsd : null

  // Fees retirées, au prix du moment de chaque retrait. Stable sans cotation passée : 1 $ ;
  // autre prix passé manquant : repli sur le prix du jour, signalé.
  const cle0 = cleDePrix(etat.ref.chaine, etat.jeton0.adresse)
  const cle1 = cleDePrix(etat.ref.chaine, etat.jeton1.adresse)
  analyse.retraitsDeFees = historique.reclamations.map((r) => {
    const passes = prixPasses.get(r.horodatage)
    const p0 = passes?.get(cle0) ?? (estStable(etat.jeton0.symbole) ? 1 : null)
    const p1 = passes?.get(cle1) ?? (estStable(etat.jeton1.symbole) ? 1 : null)
    const u0 = p0 ?? usd0
    const u1 = p1 ?? usd1
    return {
      horodatage: r.horodatage,
      fees0: r.fees0,
      fees1: r.fees1,
      usd: u0 !== null && u1 !== null ? r.fees0 * u0 + r.fees1 * u1 : null,
      prixDuJour: (r.fees0 > 0 && p0 === null) || (r.fees1 > 0 && p1 === null),
    }
  })
  analyse.feesRetireesUsd = analyse.retraitsDeFees.reduce<number | null>(
    (somme, r) => (somme === null || r.usd === null ? null : somme + r.usd),
    0,
  )

  // 4. Rendement annualisé : rapporté au capital moyen engagé, jusqu'à aujourd'hui
  //    ou jusqu'à la fermeture pour une position vidée.
  const finDeVie = analyse.fermee && analyse.cloture ? analyse.cloture.horodatage : etat.horodatage
  const secondes = finDeVie - historique.ouverture.horodatage
  analyse.jours = secondes / 86_400
  if (flux.length && secondes > 3_600) {
    flux.sort((a, b) => a.horodatage - b.horodatage)
    let capital = 0
    let integrale = 0
    for (let i = 0; i < flux.length; i++) {
      capital += flux[i].usd
      const fin = i + 1 < flux.length ? flux[i + 1].horodatage : finDeVie
      integrale += Math.max(capital, 0) * (fin - flux[i].horodatage)
    }
    const capitalMoyen = integrale / secondes
    analyse.capitalMoyenUsd = capitalMoyen
    if (capitalMoyen > 0 && analyse.rendementUsd !== null) {
      analyse.aprPourcent = (analyse.rendementUsd / capitalMoyen) * (365 * 86_400 / secondes) * 100
    }
  }

  // 5. Face au HODL, dans l'unité du jeton1 ; les AERO sont convertis aux prix du jour.
  const comparaison: Comparaison = {
    liquidite: etat.liquidite,
    tickBas: etat.tickBas,
    tickHaut: etat.tickHaut,
    d0,
    d1,
    depose0: analyse.depose0,
    depose1: analyse.depose1,
    retire0: analyse.retire0,
    retire1: analyse.retire1,
    fees0: analyse.fees0,
    fees1: analyse.fees1,
    aeroEnJeton1: usdAero !== null && usd1 ? (analyse.aero * usdAero) / usd1 : 0,
  }
  const avance = avanceSurHodl(comparaison, etat.prix)
  // En dollars, avec les mêmes prix que la valeur et les fees de la carte : au prix du pool, l'écart
  // tombait à quelques centimes ou dollars de « position moins HODL » lu dans les autres cases.
  const avecLp = enUsd(etat.quantite0 + analyse.retire0 + analyse.fees0, etat.quantite1 + analyse.retire1 + analyse.fees1)
  const hodl = enUsd(analyse.depose0, analyse.depose1)
  analyse.avanceSurHodlUsd = avecLp !== null && hodl !== null ? avecLp + (aeroUsd ?? 0) - hodl : null
  analyse.breakEven = zoneGagnante(comparaison, etat.prix, avance >= 0)

  // Pour une position fermée, le résultat qui compte est celui du jour de la fermeture.
  if (analyse.fermee && analyse.cloture) {
    const prixCloture = prixPasses.get(analyse.cloture.horodatage)?.get(cle1) ?? (estStable(etat.jeton1.symbole) ? 1 : usd1)
    const ecart = avanceSurHodl(comparaison, analyse.cloture.prix)
    analyse.avanceClotureUsd = prixCloture !== null ? ecart * prixCloture : null
  }
  return analyse
}

/** Découpe l'axe des prix aux points morts et garde l'intervalle gagnant utile. */
function zoneGagnante(c: Comparaison, prix: number, enAvance: boolean): Analyse['breakEven'] {
  const bornes = [prix / 1000, ...prixDeBreakEven(c, prix), prix * 1000]
  const intervalles = bornes.slice(0, -1).map((bas, i) => ({ bas, haut: bornes[i + 1], i }))
  const gagnants = intervalles.filter((iv) => avanceSurHodl(c, Math.sqrt(iv.bas * iv.haut)) > 0)
  if (!gagnants.length) return { enAvance, bas: null, haut: null, existe: false }
  const distance = (iv: { bas: number; haut: number }) =>
    prix >= iv.bas && prix <= iv.haut ? 0 : Math.min(Math.abs(Math.log(prix / iv.bas)), Math.abs(Math.log(prix / iv.haut)))
  const choisi = gagnants.reduce((a, b) => (distance(b) < distance(a) ? b : a))
  return {
    enAvance,
    bas: choisi.i === 0 ? null : choisi.bas,
    haut: choisi.i === intervalles.length - 1 ? null : choisi.haut,
    existe: true,
  }
}

/** Horodatages dont il faut les prix passés : chaque mouvement, chaque retrait de fees, chaque transaction. */
export const horodatagesUtiles = (h: Historique): number[] => [
  ...new Set([
    ...h.mouvements.map((m) => m.horodatage),
    ...h.reclamations.map((r) => r.horodatage),
    ...h.transactions.map((t) => t.horodatage),
  ]),
]
