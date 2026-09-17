import type { Address } from 'viem'
import { abiGauge, abiGestionnaire, abiVoter } from './abis'
import { AERODROME, CHAINES, UNISWAP_V3, masquerCle, raisonIndisponible } from './chaines'
import { lireParPaquets, lireTout, valeur } from './lecture'
import type { IdChaine, Protocole, RefPosition } from './types'

interface GaugeCL {
  gauge: Address
  gestionnaire: Address
}

let gaugesEnCache: Promise<GaugeCL[]> | null = null

/** Tous les gauges de positions concentrées Aerodrome, via le Voter. La liste bouge peu : lue une fois par visite. */
export function gaugesAerodrome(): Promise<GaugeCL[]> {
  gaugesEnCache ??= (async () => {
    const client = CHAINES.base.etat
    const n = await client.readContract({ address: AERODROME.voter, abi: abiVoter, functionName: 'length' })
    const indices = Array.from({ length: Number(n) }, (_, i) => BigInt(i))
    const pools = (
      await lireParPaquets(client, indices.map((i) => ({ address: AERODROME.voter, abi: abiVoter, functionName: 'pools', args: [i] })))
    )
      .map((r) => valeur<Address>(r))
      .filter((p): p is Address => !!p)
    const gauges = (
      await lireParPaquets(client, pools.map((p) => ({ address: AERODROME.voter, abi: abiVoter, functionName: 'gauges', args: [p] })))
    )
      .map((r) => valeur<Address>(r))
      .filter((g): g is Address => !!g && BigInt(g) !== 0n)
    const nfts = await lireParPaquets(client, gauges.map((g) => ({ address: g, abi: abiGauge, functionName: 'nft' })))
    const connus = new Map(AERODROME.gestionnaires.map((g) => [g.adresse.toLowerCase(), g.adresse]))
    const resultat: GaugeCL[] = []
    gauges.forEach((gauge, i) => {
      const gestionnaire = connus.get(valeur<Address>(nfts[i])?.toLowerCase() ?? '')
      if (gestionnaire) resultat.push({ gauge, gestionnaire })
    })
    return resultat
  })().catch((erreur) => {
    gaugesEnCache = null
    throw erreur
  })
  return gaugesEnCache
}

function ref(chaine: IdChaine, protocole: Protocole, gestionnaire: Address, id: bigint, gauge: Address | null = null): RefPosition {
  return { chaine, protocole, gestionnaire, id, gauge }
}

/** NFT de positions détenus directement par le wallet (contrats énumérables). */
async function nftDuWallet(chaine: IdChaine, gestionnaire: Address, wallet: Address): Promise<bigint[]> {
  const client = CHAINES[chaine].etat
  const n = await client.readContract({ address: gestionnaire, abi: abiGestionnaire, functionName: 'balanceOf', args: [wallet] })
  const appels = Array.from({ length: Number(n) }, (_, i) => ({
    address: gestionnaire,
    abi: abiGestionnaire,
    functionName: 'tokenOfOwnerByIndex',
    args: [wallet, BigInt(i)],
  }))
  return (await lireParPaquets(client, appels)).map((r) => valeur<bigint>(r)).filter((id): id is bigint => id !== undefined)
}

/** Positions stakées : le NFT est dans le gauge, on les retrouve en interrogeant tous les gauges d'un coup. */
async function stakeesAerodrome(wallet: Address): Promise<RefPosition[]> {
  const client = CHAINES.base.etat
  const gauges = await gaugesAerodrome()
  const longueurs = await lireParPaquets(
    client,
    gauges.map((g) => ({ address: g.gauge, abi: abiGauge, functionName: 'stakedLength', args: [wallet] })),
  )
  const touches = gauges.filter((_, i) => (valeur<bigint>(longueurs[i]) ?? 0n) > 0n)
  const valeurs = await lireTout(
    client,
    touches.map((g) => ({ address: g.gauge, abi: abiGauge, functionName: 'stakedValues', args: [wallet] })),
  )
  return touches.flatMap((g, i) =>
    (valeur<readonly bigint[]>(valeurs[i]) ?? []).map((id) => ref('base', 'aerodrome', g.gestionnaire, id, g.gauge)),
  )
}

/** Écarte les positions vidées (liquidité nulle) : les bots en laissent des centaines. */
async function garderOuvertes(chaine: IdChaine, candidats: RefPosition[]): Promise<{ ouvertes: RefPosition[]; fermees: number }> {
  const res = await lireParPaquets(
    CHAINES[chaine].etat,
    candidats.map((c) => ({ address: c.gestionnaire, abi: abiGestionnaire, functionName: 'positions', args: [c.id] })),
  )
  const ouvertes: RefPosition[] = []
  let fermees = 0
  candidats.forEach((c, i) => {
    const p = valeur<readonly unknown[]>(res[i])
    if (p && (p[7] as bigint) > 0n) ouvertes.push(c)
    else fermees++
  })
  return { ouvertes, fermees }
}

export interface Inventaire {
  positions: RefPosition[]
  fermees: number
  erreurs: string[]
}

export async function listerPositions(wallet: Address): Promise<Inventaire> {
  const sources: { nom: string; chaine: IdChaine; lire: () => Promise<RefPosition[]> }[] = [
    ...UNISWAP_V3.map((u) => ({
      nom: `Uniswap v3 (${CHAINES[u.chaine].nom})`,
      chaine: u.chaine,
      lire: async () =>
        (await nftDuWallet(u.chaine, u.gestionnaire, wallet)).map((id) => ref(u.chaine, 'uniswap-v3', u.gestionnaire, id)),
    })),
    ...AERODROME.gestionnaires.map((g) => ({
      nom: `Aerodrome ${g.adresse.slice(0, 6)} (Base)`,
      chaine: 'base' as IdChaine,
      lire: async () => (await nftDuWallet('base', g.adresse, wallet)).map((id) => ref('base', 'aerodrome', g.adresse, id)),
    })),
    { nom: 'Aerodrome stakées (Base)', chaine: 'base', lire: () => stakeesAerodrome(wallet) },
  ]
  const erreurs: string[] = []
  for (const chaine of new Set(sources.map((s) => s.chaine))) {
    const raison = raisonIndisponible(chaine)
    if (raison) erreurs.push(`${CHAINES[chaine].nom} non lue : ${raison}`)
  }
  const lus = await Promise.allSettled(
    sources.map((s) => (raisonIndisponible(s.chaine) ? Promise.resolve([]) : s.lire())),
  )
  const parChaine: Record<IdChaine, RefPosition[]> = { ethereum: [], base: [], robinhood: [] }
  lus.forEach((r, i) => {
    if (r.status === 'fulfilled') parChaine[sources[i].chaine].push(...r.value)
    else erreurs.push(`${sources[i].nom} inaccessible (réseau activé dans l'application Alchemy ?) : ${message(r.reason)}`)
  })
  const positions: RefPosition[] = []
  let fermees = 0
  for (const chaine of Object.keys(CHAINES) as IdChaine[]) {
    if (!parChaine[chaine].length) continue
    try {
      const tri = await garderOuvertes(chaine, parChaine[chaine])
      positions.push(...tri.ouvertes)
      fermees += tri.fermees
    } catch (e) {
      erreurs.push(`${CHAINES[chaine].nom} : ${message(e)}`)
    }
  }
  return { positions, fermees, erreurs }
}

export function message(e: unknown): string {
  const brut = e instanceof Error ? ((e as { shortMessage?: string }).shortMessage ?? e.message) : String(e)
  return masquerCle(brut.split('\n')[0].slice(0, 160))
}
