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

// ── Calcul exact, en entiers, comme le contrat (TickMath, SqrtPriceMath, FullMath) ──────────────────────────
// Sert à Uniswap v4, dont le journal ne donne que la liquidité ajoutée ou retirée, pas les montants.

const FACTEURS_TICK: [number, bigint][] = [
  [0x2, 0xfff97272373d413259a46990580e213an],
  [0x4, 0xfff2e50f5f656932ef12357cf3c7fdccn],
  [0x8, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
  [0x10, 0xffcb9843d60f6159c9db58835c926644n],
  [0x20, 0xff973b41fa98c081472e6896dfb254c0n],
  [0x40, 0xff2ea16466c96a3843ec78b326b52861n],
  [0x80, 0xfe5dee046a99a2a811c461f1969c3053n],
  [0x100, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
  [0x200, 0xf987a7253ac413176f2b074cf7815e54n],
  [0x400, 0xf3392b0822b70005940c7a398e4b70f3n],
  [0x800, 0xe7159475a2c29b7443b29c7fa6e889d9n],
  [0x1000, 0xd097f3bdfd2022b8845ad8f792aa5825n],
  [0x2000, 0xa9f746462d870fdf8a65dc1f90e061e5n],
  [0x4000, 0x70d869a156d2a1b890bb3df62baf32f7n],
  [0x8000, 0x31be135f97d08fd981231505542fcfa6n],
  [0x10000, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
  [0x20000, 0x5d6af8dedb81196699c329225ee604n],
  [0x40000, 0x2216e584f5fa1ea926041bedfe98n],
  [0x80000, 0x48a170391f7dc42444e8fa2n],
]

/** TickMath.getSqrtPriceAtTick : racine du prix au tick, format X96, au bit près. */
export function racineX96DuTick(tick: number): bigint {
  const abs = Math.abs(tick)
  let ratio = abs & 0x1 ? 0xfffcb933bd6fad37aa2d162d1a594001n : 0x100000000000000000000000000000000n
  for (const [bit, facteur] of FACTEURS_TICK) if (abs & bit) ratio = (ratio * facteur) >> 128n
  if (tick > 0) ratio = (M256 - 1n) / ratio
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n)
}

const diviserArrondiHaut = (a: bigint, b: bigint): bigint => (a % b === 0n ? a / b : a / b + 1n)
const mulDiv = (a: bigint, b: bigint, c: bigint, haut: boolean): bigint => (haut ? diviserArrondiHaut(a * b, c) : (a * b) / c)

/** SqrtPriceMath.getAmount0Delta. */
function montant0(sa: bigint, sb: bigint, liquidite: bigint, haut: boolean): bigint {
  const [bas, hautPrix] = sa < sb ? [sa, sb] : [sb, sa]
  const n1 = liquidite << 96n
  const n2 = hautPrix - bas
  return haut ? diviserArrondiHaut(mulDiv(n1, n2, hautPrix, true), bas) : mulDiv(n1, n2, hautPrix, false) / bas
}

/** SqrtPriceMath.getAmount1Delta. */
function montant1(sa: bigint, sb: bigint, liquidite: bigint, haut: boolean): bigint {
  const [bas, hautPrix] = sa < sb ? [sa, sb] : [sb, sa]
  return mulDiv(liquidite, hautPrix - bas, Q96, haut)
}

/**
 * Montants bruts qu'une variation de liquidité fait entrer (arrondis vers le haut, comme un dépôt)
 * ou sortir (vers le bas, comme un retrait) de la position, au prix du pool : Pool.modifyLiquidity.
 */
export function montantsExacts(liquidite: bigint, sqrtPriceX96: bigint, tick: number, tickBas: number, tickHaut: number, depot: boolean): [bigint, bigint] {
  const sa = racineX96DuTick(tickBas)
  const sb = racineX96DuTick(tickHaut)
  if (tick < tickBas) return [montant0(sa, sb, liquidite, depot), 0n]
  if (tick < tickHaut) return [montant0(sqrtPriceX96, sb, liquidite, depot), montant1(sa, sqrtPriceX96, liquidite, depot)]
  return [0n, montant1(sa, sb, liquidite, depot)]
}

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
