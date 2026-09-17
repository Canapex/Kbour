import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  HttpRequestError,
  RpcRequestError,
  TimeoutError,
  type Abi,
  type Address,
  type PublicClient,
} from 'viem'

/** Panne de transport (réseau, limite de débit, délai) : ne doit jamais passer pour un refus du contrat. */
const estPanneReseau = (erreur: unknown): boolean =>
  erreur instanceof BaseError &&
  !!erreur.walk((e) => e instanceof HttpRequestError || e instanceof RpcRequestError || e instanceof TimeoutError)

export interface Appel {
  address: Address
  abi: Abi
  functionName: string
  args?: readonly unknown[]
}

export type Resultat = { ok: true; valeur: unknown } | { ok: false; erreur: unknown }

/**
 * Lit tous les appels en une seule requête (Multicall3), éventuellement dans le passé.
 * Avant le déploiement de Multicall3 sur la chaîne, retombe sur des appels séparés.
 */
export async function lireTout(
  client: PublicClient,
  appels: Appel[],
  bloc?: bigint,
  multicallDepuis = 0n,
): Promise<Resultat[]> {
  if (appels.length === 0) return []
  if (bloc !== undefined && bloc < multicallDepuis) {
    return Promise.all(
      appels.map(async (appel): Promise<Resultat> => {
        try {
          return { ok: true, valeur: await client.readContract({ ...appel, blockNumber: bloc }) }
        } catch (erreur) {
          // Seul un refus du contrat compte comme « échec de l'appel » ; une panne réseau doit remonter.
          const refus =
            erreur instanceof BaseError &&
            erreur.walk((e) => e instanceof ContractFunctionRevertedError || e instanceof ContractFunctionZeroDataError)
          if (!refus) throw erreur
          return { ok: false, erreur }
        }
      }),
    )
  }
  const res = await client.multicall({
    contracts: appels,
    allowFailure: true,
    blockNumber: bloc,
    batchSize: 0,
  })
  // viem range une requête refusée par le RPC parmi les « appels échoués » : on la fait remonter.
  for (const r of res) if (r.status === 'failure' && estPanneReseau(r.error)) throw r.error
  return res.map((r): Resultat => (r.status === 'success' ? { ok: true, valeur: r.result } : { ok: false, erreur: r.error }))
}

/** Découpe en paquets, pour les listes longues (gauges, NFT d'un gros wallet). */
export async function lireParPaquets(
  client: PublicClient,
  appels: Appel[],
  taille = 500,
  bloc?: bigint,
): Promise<Resultat[]> {
  const paquets: Promise<Resultat[]>[] = []
  for (let i = 0; i < appels.length; i += taille) paquets.push(lireTout(client, appels.slice(i, i + taille), bloc))
  return (await Promise.all(paquets)).flat()
}

export function valeur<T>(r: Resultat | undefined): T | undefined {
  return r && r.ok ? (r.valeur as T) : undefined
}

/** Pas plus de `max` requêtes en vol en même temps : les RPC gratuits coupent au-delà. */
export function limiteur(max: number) {
  let actifs = 0
  const file: (() => void)[] = []
  return async function <T>(tache: () => Promise<T>): Promise<T> {
    while (actifs >= max) await new Promise<void>((reprendre) => file.push(reprendre))
    actifs++
    try {
      return await tache()
    } finally {
      actifs--
      file.shift()?.()
    }
  }
}
