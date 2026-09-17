import { createPublicClient, fallback, http, type Address, type Chain, type PublicClient } from 'viem'
import { base, mainnet, robinhood } from 'viem/chains'
import { limiteur } from './lecture'
import type { IdChaine } from './types'

/**
 * Clé Alchemy : fichier .env.local (VITE_ALCHEMY_KEY), lu par Vite dans la page et par les outils en Node ;
 * à défaut, saisie dans la page (configurerCle), gardée en mémoire et jamais écrite nulle part.
 */
let cle: string | undefined =
  import.meta.env?.VITE_ALCHEMY_KEY ?? (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.VITE_ALCHEMY_KEY

/** Les messages d'erreur de viem contiennent l'URL, donc la clé : à passer avant tout affichage. */
export const masquerCle = (texte: string): string => (cle ? texte.split(cle).join('•••') : texte)

export const cleConfiguree = (): boolean => !!cle

export interface Chaine {
  id: IdChaine
  nom: string
  /** Lectures de l'état actuel : Alchemy, puis RPC publics en secours. */
  etat: PublicClient
  /** Lectures dans le passé. */
  archive: PublicClient
  /** Journal d'événements, là où un fournisseur le sert sur toute la plage. */
  journal: PublicClient | null
  /** Préfixe DefiLlama pour les prix. */
  llama: string
  multicallDepuis: bigint
  /**
   * Blocs de retrait sous le sommet pour la photo : les nœuds derrière un répartiteur
   * n'ont pas tous le tout dernier bloc (≈ 2 à 12 s selon la chaîne).
   */
  marge: bigint
  limiterArchive: <T>(tache: () => Promise<T>) => Promise<T>
  /** Le RPC public de Robinhood coupe (« timed out », 429) dès que plusieurs lectures de journal se chevauchent. */
  limiterJournal: <T>(tache: () => Promise<T>) => Promise<T>
}

function client(chain: Chain, urls: string[]): PublicClient {
  const transport = fallback(
    // Peu de relances : une requête refusée (réseau non activé, CORS) échouerait en boucle et figerait la page.
    urls.map((url) => http(url, { timeout: 20_000, retryCount: 2, retryDelay: 400 })),
    { retryCount: 0 },
  )
  return createPublicClient({ chain, transport }) as PublicClient
}

// Un réseau non activé dans l'application Alchemy répond « not enabled » : viem passe alors au suivant.
const alchemy = (reseau: string): string[] => (cle ? [`https://${reseau}.g.alchemy.com/v2/${cle}`] : [])

// Le RPC public de Robinhood envoie un en-tête CORS invalide (« *,* ») : inutilisable depuis une page web,
// il ne sert qu'aux outils en Node. Dans le navigateur, Robinhood Chain passe par Alchemy.
const dansNavigateur = typeof window !== 'undefined'
const ROBINHOOD_PUBLIC = ['https://rpc.mainnet.chain.robinhood.com']
const robinhoodUrls = (): string[] =>
  cle ? [...alchemy('robinhood-mainnet'), ...(dansNavigateur ? [] : ROBINHOOD_PUBLIC)] : ROBINHOOD_PUBLIC

/** Sans clé, le RPC public de Robinhood est le seul accès, et un navigateur le refuse. */
export function raisonIndisponible(id: IdChaine): string | null {
  return id === 'robinhood' && dansNavigateur && !cle ? 'clé Alchemy requise' : null
}

const construire = (): Record<IdChaine, Chaine> => ({
  ethereum: {
    id: 'ethereum',
    nom: 'Ethereum',
    etat: client(mainnet, [...alchemy('eth-mainnet'), 'https://ethereum.publicnode.com', 'https://eth.drpc.org']),
    archive: client(mainnet, [...alchemy('eth-mainnet'), 'https://eth.drpc.org']),
    journal: cle ? client(mainnet, alchemy('eth-mainnet')) : null,
    llama: 'ethereum',
    multicallDepuis: 14_353_601n,
    marge: 1n,
    limiterArchive: limiteur(8),
    limiterJournal: limiteur(4),
  },
  base: {
    id: 'base',
    nom: 'Base',
    etat: client(base, [...alchemy('base-mainnet'), 'https://base.publicnode.com', 'https://base.drpc.org']),
    archive: client(base, [...alchemy('base-mainnet'), 'https://base.drpc.org']),
    journal: cle ? client(base, alchemy('base-mainnet')) : null,
    llama: 'base',
    multicallDepuis: 5_022n,
    marge: 2n,
    limiterArchive: limiteur(8),
    limiterJournal: limiteur(4),
  },
  robinhood: {
    id: 'robinhood',
    nom: 'Robinhood Chain',
    etat: client(robinhood, robinhoodUrls()),
    archive: client(robinhood, robinhoodUrls()),
    // Alchemy et le RPC public servent le journal sur toute la plage (mesuré le 17/09/2026).
    journal: client(robinhood, robinhoodUrls()),
    llama: 'robinhood',
    multicallDepuis: 0n,
    marge: 30n,
    limiterArchive: limiteur(4),
    limiterJournal: limiteur(1),
  },
})

export const CHAINES: Record<IdChaine, Chaine> = construire()

/** Clé collée dans la page : reconstruit les accès des trois chaînes avec elle. */
export function configurerCle(nouvelle: string): void {
  cle = nouvelle.trim() || undefined
  Object.assign(CHAINES, construire())
}

/**
 * Essaie la clé sur Ethereum avant de s'en servir. Une clé refusée ralentirait chaque lecture
 * (tentative Alchemy, échec, repli) : on la rejette tout de suite et on revient à l'état précédent.
 */
export async function verifierCle(nouvelle: string): Promise<{ ok: boolean; detail?: string }> {
  const precedente = cle
  configurerCle(nouvelle)
  try {
    await CHAINES.ethereum.journal!.getChainId()
    return { ok: true }
  } catch (erreur) {
    configurerCle(precedente ?? '')
    return { ok: false, detail: masquerCle(String((erreur as Error)?.message ?? erreur).split('\n')[0]) }
  }
}

export const MULTICALL3: Address = '0xcA11bde05977b3631167028862bE2a173976CA11'

/** Uniswap v3 : même contrat NFT partout, adresses différentes par chaîne (docs Uniswap, vérifiées on-chain). */
export const UNISWAP_V3: { chaine: IdChaine; gestionnaire: Address; creation: bigint }[] = [
  { chaine: 'ethereum', gestionnaire: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88', creation: 12_369_651n },
  { chaine: 'robinhood', gestionnaire: '0x73991a25c818bf1f1128deaab1492d45638de0d3', creation: 0n },
]

export const AERODROME = {
  /** Les deux déploiements Slipstream en service ; blocs de création mesurés le 17/09/2026. */
  gestionnaires: [
    { adresse: '0x827922686190790b37229fd06084350E74485b72' as Address, creation: 13_843_719n },
    { adresse: '0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53' as Address, creation: 44_394_730n },
  ],
  voter: '0x16613524e02ad97eDfeF371bC883F2F5d6C480A5' as Address,
  aero: '0x940181a94A35A4569E4529A3CDfB74e38FD98631' as Address,
}
