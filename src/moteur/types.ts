import type { Address } from 'viem'

export type IdChaine = 'ethereum' | 'base' | 'robinhood'
export type Protocole = 'uniswap-v3' | 'aerodrome'

/** Ce qui suffit à désigner une position. */
export interface RefPosition {
  chaine: IdChaine
  protocole: Protocole
  /** Contrat NFT qui porte la position. */
  gestionnaire: Address
  id: bigint
  /** Gauge où la position est stakée en ce moment, sinon null. */
  gauge: Address | null
}

export interface Jeton {
  adresse: Address
  symbole: string
  decimales: number
}

/** Photographie de la position au bloc `bloc`, tout lu dans la même requête. */
export interface EtatPosition {
  ref: RefPosition
  bloc: bigint
  horodatage: number
  jeton0: Jeton
  jeton1: Jeton
  /** Tier de fee (Uniswap) ou espacement des ticks (Aerodrome). */
  feeOuEspacement: number
  tickBas: number
  tickHaut: number
  liquidite: bigint
  pool: Address
  /** Gauge du pool (Aerodrome), que la position soit stakée ou non. */
  gaugeDuPool: Address | null
  sqrtPriceX96: bigint
  tick: number
  dansLaFourchette: boolean
  /** Prix du jeton0 exprimé en jeton1, unités lisibles. */
  prix: number
  prixBas: number
  prixHaut: number
  /** Quantités actuellement dans la position, unités lisibles. */
  quantite0: number
  quantite1: number
  /** Fees réclamables maintenant (unités minimales). Toujours 0 pour une position stakée. */
  feesEnAttente0: bigint
  feesEnAttente1: bigint
  /** AERO réclamables maintenant, nets d'une éventuelle pénalité de sortie anticipée. */
  aeroEnAttente: bigint
  /** Croissances « à l'intérieur de la fourchette » au bloc de la photo. */
  croissanceFees0: bigint
  croissanceFees1: bigint
  croissanceAero: bigint
}
