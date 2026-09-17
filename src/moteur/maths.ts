// Formules de liquidité concentrée (Uniswap v3 et Aerodrome Slipstream partagent les mêmes).

export const Q96 = 2n ** 96n
export const Q128 = 2n ** 128n
const M256 = 2n ** 256n

/** Les compteurs de croissance sont des uint256 qui peuvent « faire le tour » : on calcule modulo 2^256. */
export const mod256 = (x: bigint): bigint => ((x % M256) + M256) % M256

/**
 * Croissance « à l'intérieur de la fourchette », exactement comme Tick.getFeeGrowthInside
 * et Tick.getRewardGrowthInside (même formule pour les fees et pour les AERO).
 */
export function croissanceInterieure(
  globale: bigint,
  dehorsBas: bigint,
  dehorsHaut: bigint,
  tick: number,
  tickBas: number,
  tickHaut: number,
): bigint {
  const dessous = tick >= tickBas ? dehorsBas : mod256(globale - dehorsBas)
  const dessus = tick < tickHaut ? dehorsHaut : mod256(globale - dehorsHaut)
  return mod256(globale - dessous - dessus)
}

/** Gain d'une liquidité constante entre deux relevés de croissance (FullMath.mulDiv, arrondi bas). */
export function gainEntre(croissanceFin: bigint, croissanceDebut: bigint, liquidite: bigint): bigint {
  return (mod256(croissanceFin - croissanceDebut) * liquidite) / Q128
}

export const racinePrixDuTick = (tick: number): number => Math.pow(1.0001, tick / 2)

export const racinePrixX96 = (sqrtPriceX96: bigint): number => Number(sqrtPriceX96) / 2 ** 96

/** Prix du jeton0 en jeton1, en unités lisibles, à partir d'une racine de prix brute. */
export const prixLisible = (racine: number, d0: number, d1: number): number => racine * racine * 10 ** (d0 - d1)

/** Racine de prix brute correspondant à un prix lisible. */
export const racineDuPrix = (prix: number, d0: number, d1: number): number => Math.sqrt(prix * 10 ** (d1 - d0))

/** Quantités brutes (unités minimales, en flottant) d'une liquidité à une racine de prix donnée. */
export function quantitesBrutes(liquidite: bigint, racine: number, tickBas: number, tickHaut: number): [number, number] {
  const L = Number(liquidite)
  const sa = racinePrixDuTick(tickBas)
  const sb = racinePrixDuTick(tickHaut)
  if (racine <= sa) return [(L * (sb - sa)) / (sa * sb), 0]
  if (racine >= sb) return [0, L * (sb - sa)]
  return [(L * (sb - racine)) / (racine * sb), L * (racine - sa)]
}

export function quantitesLisibles(
  liquidite: bigint,
  racine: number,
  tickBas: number,
  tickHaut: number,
  d0: number,
  d1: number,
): [number, number] {
  const [x, y] = quantitesBrutes(liquidite, racine, tickBas, tickHaut)
  return [x / 10 ** d0, y / 10 ** d1]
}

export const lisible = (brut: bigint, decimales: number): number => Number(brut) / 10 ** decimales

/**
 * Tout ce qu'il faut pour comparer la position à « si j'avais gardé mes jetons ».
 * Quantités en unités lisibles ; le jeton1 sert d'unité de compte.
 */
export interface Comparaison {
  liquidite: bigint
  tickBas: number
  tickHaut: number
  d0: number
  d1: number
  depose0: number
  depose1: number
  retire0: number
  retire1: number
  fees0: number
  fees1: number
  /** Valeur des AERO gagnés, convertie en jeton1 aux prix du jour (0 si inconnu). */
  aeroEnJeton1: number
}

/** Avance de la position sur le HODL, en jeton1, si le prix du jeton0 valait `prix` jeton1. */
export function avanceSurHodl(c: Comparaison, prix: number): number {
  const [q0, q1] = quantitesLisibles(c.liquidite, racineDuPrix(prix, c.d0, c.d1), c.tickBas, c.tickHaut, c.d0, c.d1)
  const avecLp = (q0 + c.retire0 + c.fees0) * prix + (q1 + c.retire1 + c.fees1) + c.aeroEnJeton1
  const hodl = c.depose0 * prix + c.depose1
  return avecLp - hodl
}

/**
 * Prix où la position et le HODL se valent : racines de avanceSurHodl, cherchées de prix/1000 à prix×1000.
 * En général deux : la position ne bat le HODL qu'entre ces deux prix.
 */
export function prixDeBreakEven(c: Comparaison, prixActuel: number): number[] {
  const pas = 1200
  const debut = prixActuel / 1000
  const racines: number[] = []
  let pPrec = debut
  let gPrec = avanceSurHodl(c, pPrec)
  for (let i = 1; i <= pas; i++) {
    const p = debut * Math.pow(1e6, i / pas)
    const g = avanceSurHodl(c, p)
    if (Math.sign(g) !== Math.sign(gPrec) && gPrec !== 0) {
      let bas = pPrec
      let haut = p
      let gBas = gPrec
      for (let k = 0; k < 100; k++) {
        const m = Math.sqrt(bas * haut)
        const gm = avanceSurHodl(c, m)
        if (Math.sign(gm) === Math.sign(gBas)) {
          bas = m
          gBas = gm
        } else haut = m
      }
      racines.push(Math.sqrt(bas * haut))
    }
    pPrec = p
    gPrec = g
  }
  return racines
}
