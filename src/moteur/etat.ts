import { encodeAbiParameters, hexToString, keccak256, pad, toHex, type Address, type Hex } from 'viem'
import {
  abiFactoryAerodrome,
  abiFactoryUniswap,
  abiGauge,
  abiGestionnaire,
  abiJeton,
  abiJetonBytes32,
  abiMulticall3,
  abiPoolAerodrome,
  abiPoolUniswap,
  abiPositionsV4,
  abiStateView,
} from './abis'
import { CHAINES, MULTICALL3, v4De } from './chaines'
import { lireTout, valeur, type Appel, type Resultat } from './lecture'
import {
  Q128,
  croissanceInterieure,
  gainEntre,
  lisible,
  prixLisible,
  quantitesLisibles,
  racinePrixDuTick,
  racinePrixX96,
} from './maths'
import type { EtatPosition, IdChaine, Jeton, RefPosition } from './types'

type Tuple = readonly unknown[]

const unique = <T>(xs: T[]): T[] => [...new Set(xs)]

/** Solde lu dans la photo, en unités lisibles ; null si le jeton n'a pas répondu. */
const solde = (r: Resultat | undefined, decimales: number): number | null => {
  const brut = valeur<bigint>(r)
  return brut === undefined ? null : lisible(brut, decimales)
}

/** Photographie de toutes les positions d'une chaîne, cohérente au bloc près. */
async function etatsDeLaChaine(chaine: IdChaine, refs: RefPosition[], wallet: Address): Promise<EtatPosition[]> {
  const client = CHAINES[chaine].etat

  // 1. Définition des positions et adresse de la factory de chaque contrat NFT.
  const gestionnaires = unique(refs.map((r) => r.gestionnaire))
  const a = await lireTout(client, [
    ...refs.map((r) => ({ address: r.gestionnaire, abi: abiGestionnaire, functionName: 'positions', args: [r.id] })),
    ...gestionnaires.map((g) => ({ address: g, abi: abiGestionnaire, functionName: 'factory' })),
  ])
  const factoryDe = new Map(gestionnaires.map((g, i) => [g, valeur<Address>(a[refs.length + i])]))
  const definitions = refs.map((r, i) => {
    const p = valeur<Tuple>(a[i])
    if (!p) throw new Error(`position #${r.id} illisible`)
    return {
      ref: r,
      token0: p[2] as Address,
      token1: p[3] as Address,
      feeOuEspacement: Number(p[4]),
      tickBas: Number(p[5]),
      tickHaut: Number(p[6]),
    }
  })

  // 2. Adresse du pool de chaque position.
  const b = await lireTout(
    client,
    definitions.map((d) => ({
      address: factoryDe.get(d.ref.gestionnaire)!,
      abi: d.ref.protocole === 'aerodrome' ? abiFactoryAerodrome : abiFactoryUniswap,
      functionName: 'getPool',
      args: [d.token0, d.token1, d.feeOuEspacement],
    })),
  )
  const pools = definitions.map((d, i) => {
    const pool = valeur<Address>(b[i])
    if (!pool || BigInt(pool) === 0n) throw new Error(`pool de la position #${d.ref.id} introuvable`)
    return pool
  })

  // 3. La photo : tout ce qui sert aux calculs, lu au même bloc.
  // Le bloc vient du RPC et pas de Multicall3.getBlockNumber() : sur une chaîne Arbitrum (Robinhood),
  // block.number renvoie le numéro de bloc d'Ethereum (mesuré : 25,9 M au lieu de 65,5 M).
  const bloc = (await client.getBlockNumber()) - CHAINES[chaine].marge
  const appels: Appel[] = []
  const ajouter = (appel: Appel): number => appels.push(appel) - 1
  const iHeure = ajouter({ address: MULTICALL3, abi: abiMulticall3, functionName: 'getCurrentBlockTimestamp' })

  const poolsUniques = unique(pools)
  const protocoleDuPool = new Map(pools.map((p, i) => [p, definitions[i].ref.protocole]))
  const jetonsDuPool = new Map(pools.map((p, i) => [p, [definitions[i].token0, definitions[i].token1] as const]))
  const lecturesPool = new Map(
    poolsUniques.map((pool) => {
      const aero = protocoleDuPool.get(pool) === 'aerodrome'
      const abi = aero ? abiPoolAerodrome : abiPoolUniswap
      const lire = (functionName: string) => ajouter({ address: pool, abi, functionName })
      const [t0, t1] = jetonsDuPool.get(pool)!
      // Pour l'onglet avancé : liquidité active, frais du pool et réserves (sa TVL).
      const soldeDuPool = (jeton: Address) => ajouter({ address: jeton, abi: abiJeton, functionName: 'balanceOf', args: [pool] })
      return [
        pool,
        {
          active: lire('liquidity'),
          frais: lire('fee'),
          solde0: soldeDuPool(t0),
          solde1: soldeDuPool(t1),
          slot0: lire('slot0'),
          fg0: lire('feeGrowthGlobal0X128'),
          fg1: lire('feeGrowthGlobal1X128'),
          rg: aero ? lire('rewardGrowthGlobalX128') : -1,
          reserve: aero ? lire('rewardReserve') : -1,
          majRecompenses: aero ? lire('lastUpdated') : -1,
          stakee: aero ? lire('stakedLiquidity') : -1,
          gauge: aero ? lire('gauge') : -1,
        },
      ]
    }),
  )

  const lecturesPosition = definitions.map((d, i) => {
    const abiPool = d.ref.protocole === 'aerodrome' ? abiPoolAerodrome : abiPoolUniswap
    return {
      position: ajouter({ address: d.ref.gestionnaire, abi: abiGestionnaire, functionName: 'positions', args: [d.ref.id] }),
      proprietaire: ajouter({ address: d.ref.gestionnaire, abi: abiGestionnaire, functionName: 'ownerOf', args: [d.ref.id] }),
      tickBas: ajouter({ address: pools[i], abi: abiPool, functionName: 'ticks', args: [d.tickBas] }),
      tickHaut: ajouter({ address: pools[i], abi: abiPool, functionName: 'ticks', args: [d.tickHaut] }),
      gagne: d.ref.gauge
        ? ajouter({ address: d.ref.gauge, abi: abiGauge, functionName: 'earned', args: [wallet, d.ref.id] })
        : -1,
      debitGauge: d.ref.gauge ? ajouter({ address: d.ref.gauge, abi: abiGauge, functionName: 'rewardRate' }) : -1,
    }
  })

  const jetons = unique(definitions.flatMap((d) => [d.token0, d.token1]))
  const lecturesJeton = new Map(
    jetons.map((j) => [
      j,
      {
        symbole: ajouter({ address: j, abi: abiJeton, functionName: 'symbol' }),
        decimales: ajouter({ address: j, abi: abiJeton, functionName: 'decimals' }),
      },
    ]),
  )

  const r = await lireTout(client, appels, bloc)
  const horodatage = Number(valeur<bigint>(r[iHeure]) ?? 0n)
  if (!horodatage) throw new Error(`photo ${CHAINES[chaine].nom} illisible`)

  // Symboles en bytes32 (vieux jetons) : seconde passe pour ceux qui ont échoué.
  const infoJeton = new Map<Address, Jeton>()
  const aRelire = jetons.filter((j) => !r[lecturesJeton.get(j)!.symbole].ok)
  const relus = await lireTout(client, aRelire.map((j) => ({ address: j, abi: abiJetonBytes32, functionName: 'symbol' })))
  for (const j of jetons) {
    const l = lecturesJeton.get(j)!
    let symbole = valeur<string>(r[l.symbole])
    if (symbole === undefined) {
      const brut = valeur<string>(relus[aRelire.indexOf(j)])
      symbole = brut ? hexToString(brut as Hex, { size: 32 }) : undefined
    }
    infoJeton.set(j, {
      adresse: j,
      symbole: symbole || `${j.slice(0, 6)}…`,
      decimales: Number(valeur<number>(r[l.decimales]) ?? 18),
    })
  }

  return definitions.map((d, i) => {
    const lp = lecturesPosition[i]
    const lpool = lecturesPool.get(pools[i])!
    const aero = d.ref.protocole === 'aerodrome'
    const p = valeur<Tuple>(r[lp.position])!
    const slot0 = valeur<Tuple>(r[lpool.slot0])!
    const tBas = valeur<Tuple>(r[lp.tickBas])!
    const tHaut = valeur<Tuple>(r[lp.tickHaut])!
    const liquidite = p[7] as bigint
    const sqrtPriceX96 = slot0[0] as bigint
    const tick = Number(slot0[1])
    const j0 = infoJeton.get(d.token0)!
    const j1 = infoJeton.get(d.token1)!

    // Fees : même calcul que collect() — dû enregistré + croissance depuis le dernier relevé.
    const decalage = aero ? 1 : 0 // Aerodrome glisse stakedLiquidityNet avant les compteurs
    const croissanceFees0 = croissanceInterieure(
      valeur<bigint>(r[lpool.fg0])!,
      tBas[2 + decalage] as bigint,
      tHaut[2 + decalage] as bigint,
      tick,
      d.tickBas,
      d.tickHaut,
    )
    const croissanceFees1 = croissanceInterieure(
      valeur<bigint>(r[lpool.fg1])!,
      tBas[3 + decalage] as bigint,
      tHaut[3 + decalage] as bigint,
      tick,
      d.tickBas,
      d.tickHaut,
    )
    const gaugeDuPool = aero ? valeur<Address>(r[lpool.gauge]) ?? null : null
    const proprietaire = valeur<Address>(r[lp.proprietaire])
    const stakee = !!gaugeDuPool && BigInt(gaugeDuPool) !== 0n && proprietaire?.toLowerCase() === gaugeDuPool.toLowerCase()
    const feesEnAttente0 = (p[10] as bigint) + (stakee ? 0n : gainEntre(croissanceFees0, p[8] as bigint, liquidite))
    const feesEnAttente1 = (p[11] as bigint) + (stakee ? 0n : gainEntre(croissanceFees1, p[9] as bigint, liquidite))

    // AERO : croissance globale projetée à l'instant de la photo, comme CLGauge._earned.
    let croissanceAero = 0n
    if (aero) {
      let globale = valeur<bigint>(r[lpool.rg]) ?? 0n
      const reserve = valeur<bigint>(r[lpool.reserve]) ?? 0n
      const liquiditeStakee = valeur<bigint>(r[lpool.stakee]) ?? 0n
      const ecoule = BigInt(horodatage) - BigInt(valeur<number>(r[lpool.majRecompenses]) ?? horodatage)
      const debit = lp.debitGauge >= 0 ? valeur<bigint>(r[lp.debitGauge]) ?? 0n : 0n
      if (ecoule > 0n && reserve > 0n && liquiditeStakee > 0n && debit > 0n) {
        const distribue = debit * ecoule > reserve ? reserve : debit * ecoule
        globale += (distribue * Q128) / liquiditeStakee
      }
      croissanceAero = croissanceInterieure(globale, tBas[5] as bigint, tHaut[5] as bigint, tick, d.tickBas, d.tickHaut)
    }

    const racine = racinePrixX96(sqrtPriceX96)
    const [quantite0, quantite1] = quantitesLisibles(liquidite, racine, d.tickBas, d.tickHaut, j0.decimales, j1.decimales)
    return {
      ref: { ...d.ref, gauge: stakee ? gaugeDuPool : null },
      bloc,
      horodatage,
      jeton0: j0,
      jeton1: j1,
      feeOuEspacement: d.feeOuEspacement,
      tickBas: d.tickBas,
      tickHaut: d.tickHaut,
      liquidite,
      pool: pools[i],
      poolId: null,
      gaugeDuPool: gaugeDuPool && BigInt(gaugeDuPool) !== 0n ? gaugeDuPool : null,
      sqrtPriceX96,
      tick,
      dansLaFourchette: tick >= d.tickBas && tick < d.tickHaut,
      prix: prixLisible(racine, j0.decimales, j1.decimales),
      prixBas: prixLisible(racinePrixDuTick(d.tickBas), j0.decimales, j1.decimales),
      prixHaut: prixLisible(racinePrixDuTick(d.tickHaut), j0.decimales, j1.decimales),
      quantite0,
      quantite1,
      feesEnAttente0,
      feesEnAttente1,
      aeroEnAttente: lp.gagne >= 0 ? valeur<bigint>(r[lp.gagne]) ?? 0n : 0n,
      croissanceFees0,
      croissanceFees1,
      croissanceAero,
      liquiditeActive: valeur<bigint>(r[lpool.active]) ?? null,
      fraisPool: r[lpool.frais].ok ? Number(valeur<number>(r[lpool.frais])) : null,
      reserve0: solde(r[lpool.solde0], j0.decimales),
      reserve1: solde(r[lpool.solde1], j1.decimales),
    }
  })
}

// ── Uniswap v4 ──────────────────────────────────────────────────────────────────────────────────────────
// Un seul contrat, le PoolManager, porte tous les pools : un pool n'a plus d'adresse mais un identifiant
// (keccak de sa clé). La position vit dans le PoolManager au nom du contrat des positions, avec le numéro
// du NFT comme « sel ». Pas de compteur de fees « dues » : chaque modification de la position les verse.

const ZERO: Address = '0x0000000000000000000000000000000000000000'

/** Le sel d'une position v4 : son numéro de NFT sur 32 octets. */
export const selV4 = (id: bigint): Hex => pad(toHex(id), { size: 32 })

interface CleDePool {
  currency0: Address
  currency1: Address
  fee: number
  tickSpacing: number
  hooks: Address
}

/** Identifiant du pool : keccak256(abi.encode(PoolKey)). */
export function idDuPool(cle: CleDePool): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
      [cle.currency0, cle.currency1, cle.fee, cle.tickSpacing, cle.hooks],
    ),
  )
}

/** PositionInfo : | 200 bits poolId | 24 bits tickUpper | 24 bits tickLower | 8 bits hasSubscriber |. */
const int24 = (x: bigint): number => {
  const v = Number(x & 0xffffffn)
  return v >= 0x800000 ? v - 0x1000000 : v
}
export const ticksDeLaPosition = (info: bigint): [number, number] => [int24(info >> 8n), int24(info >> 32n)]

/** Frais « dynamiques » : un hook les fixe à chaque swap, la clé du pool porte alors ce drapeau. */
const FRAIS_DYNAMIQUES = 0x800000

async function etatsV4(chaine: IdChaine, refs: RefPosition[]): Promise<EtatPosition[]> {
  const client = CHAINES[chaine].etat
  const bloc = (await client.getBlockNumber()) - CHAINES[chaine].marge

  // 1. Clé du pool, ticks et liquidité de chaque position.
  const a = await lireTout(
    client,
    refs.flatMap((r) => [
      { address: r.gestionnaire, abi: abiPositionsV4, functionName: 'getPoolAndPositionInfo', args: [r.id] },
      { address: r.gestionnaire, abi: abiPositionsV4, functionName: 'getPositionLiquidity', args: [r.id] },
    ]),
    bloc,
  )
  const definitions = refs.map((r, i) => {
    const res = valeur<readonly [CleDePool, bigint]>(a[2 * i])
    const liquidite = valeur<bigint>(a[2 * i + 1])
    if (!res || liquidite === undefined) throw new Error(`position v4 #${r.id} illisible`)
    const [cle, info] = res
    const [tickBas, tickHaut] = ticksDeLaPosition(info)
    return { ref: r, cle, poolId: idDuPool(cle), tickBas, tickHaut, liquidite, v4: v4De(r.gestionnaire)! }
  })

  // 2. La photo : pools (prix, liquidité active), croissances et relevés de chaque position, jetons.
  const appels: Appel[] = []
  const ajouter = (appel: Appel): number => appels.push(appel) - 1
  const iHeure = ajouter({ address: MULTICALL3, abi: abiMulticall3, functionName: 'getCurrentBlockTimestamp' })
  const lecturesPool = new Map<Hex, { slot0: number; active: number }>()
  for (const d of definitions) {
    if (lecturesPool.has(d.poolId)) continue
    lecturesPool.set(d.poolId, {
      slot0: ajouter({ address: d.v4.stateView, abi: abiStateView, functionName: 'getSlot0', args: [d.poolId] }),
      active: ajouter({ address: d.v4.stateView, abi: abiStateView, functionName: 'getLiquidity', args: [d.poolId] }),
    })
  }
  const lecturesPosition = definitions.map((d) => ({
    croissance: ajouter({ address: d.v4.stateView, abi: abiStateView, functionName: 'getFeeGrowthInside', args: [d.poolId, d.tickBas, d.tickHaut] }),
    releve: ajouter({
      address: d.v4.stateView,
      abi: abiStateView,
      functionName: 'getPositionInfo',
      args: [d.poolId, d.ref.gestionnaire, d.tickBas, d.tickHaut, selV4(d.ref.id)],
    }),
  }))
  const jetons = unique(definitions.flatMap((d) => [d.cle.currency0, d.cle.currency1])).filter((j) => j.toLowerCase() !== ZERO)
  const lecturesJeton = new Map(
    jetons.map((j) => [
      j,
      {
        symbole: ajouter({ address: j, abi: abiJeton, functionName: 'symbol' }),
        decimales: ajouter({ address: j, abi: abiJeton, functionName: 'decimals' }),
      },
    ]),
  )
  const r = await lireTout(client, appels, bloc)
  const horodatage = Number(valeur<bigint>(r[iHeure]) ?? 0n)
  if (!horodatage) throw new Error(`photo ${CHAINES[chaine].nom} illisible`)

  const aRelire = jetons.filter((j) => !r[lecturesJeton.get(j)!.symbole].ok)
  const relus = await lireTout(client, aRelire.map((j) => ({ address: j, abi: abiJetonBytes32, functionName: 'symbol' })))
  const infoJeton = (j: Address): Jeton => {
    // L'adresse zéro est la monnaie native de la chaîne : de l'ETH sur les trois.
    if (j.toLowerCase() === ZERO) return { adresse: ZERO, symbole: 'ETH', decimales: 18 }
    const l = lecturesJeton.get(j)!
    let symbole = valeur<string>(r[l.symbole])
    if (symbole === undefined) {
      const brut = valeur<string>(relus[aRelire.indexOf(j)])
      symbole = brut ? hexToString(brut as Hex, { size: 32 }) : undefined
    }
    return { adresse: j, symbole: symbole || `${j.slice(0, 6)}…`, decimales: Number(valeur<number>(r[l.decimales]) ?? 18) }
  }

  return definitions.map((d, i) => {
    const lp = lecturesPosition[i]
    const lpool = lecturesPool.get(d.poolId)!
    const slot0 = valeur<readonly [bigint, number, number, number]>(r[lpool.slot0])
    const croissance = valeur<readonly [bigint, bigint]>(r[lp.croissance])
    const releve = valeur<readonly [bigint, bigint, bigint]>(r[lp.releve])
    if (!slot0 || !croissance || !releve) throw new Error(`pool de la position v4 #${d.ref.id} illisible`)
    const [sqrtPriceX96, tickBrut, , fraisLp] = slot0
    const tick = Number(tickBrut)
    const j0 = infoJeton(d.cle.currency0)
    const j1 = infoJeton(d.cle.currency1)
    const racine = racinePrixX96(sqrtPriceX96)
    const [quantite0, quantite1] = quantitesLisibles(d.liquidite, racine, d.tickBas, d.tickHaut, j0.decimales, j1.decimales)
    return {
      ref: d.ref,
      bloc,
      horodatage,
      jeton0: j0,
      jeton1: j1,
      feeOuEspacement: d.cle.fee === FRAIS_DYNAMIQUES ? Number(fraisLp) : d.cle.fee,
      tickBas: d.tickBas,
      tickHaut: d.tickHaut,
      liquidite: d.liquidite,
      pool: d.v4.poolManager,
      poolId: d.poolId,
      gaugeDuPool: null,
      sqrtPriceX96,
      tick,
      dansLaFourchette: tick >= d.tickBas && tick < d.tickHaut,
      prix: prixLisible(racine, j0.decimales, j1.decimales),
      prixBas: prixLisible(racinePrixDuTick(d.tickBas), j0.decimales, j1.decimales),
      prixHaut: prixLisible(racinePrixDuTick(d.tickHaut), j0.decimales, j1.decimales),
      quantite0,
      quantite1,
      // Ce qu'une modification verserait maintenant (Position.update) : liquidité × croissance depuis le relevé.
      feesEnAttente0: gainEntre(croissance[0], releve[1], releve[0]),
      feesEnAttente1: gainEntre(croissance[1], releve[2], releve[0]),
      aeroEnAttente: 0n,
      croissanceFees0: croissance[0],
      croissanceFees1: croissance[1],
      croissanceAero: 0n,
      liquiditeActive: valeur<bigint>(r[lpool.active]) ?? null,
      fraisPool: Number(fraisLp),
      // Les jetons de tous les pools dorment ensemble dans le PoolManager : pas de réserve par pool.
      reserve0: null,
      reserve1: null,
    }
  })
}

export async function lireEtats(refs: RefPosition[], wallet: Address): Promise<EtatPosition[]> {
  const lots: Promise<EtatPosition[]>[] = []
  for (const chaine of Object.keys(CHAINES) as IdChaine[]) {
    const v3 = refs.filter((r) => r.chaine === chaine && r.protocole !== 'uniswap-v4')
    const v4 = refs.filter((r) => r.chaine === chaine && r.protocole === 'uniswap-v4')
    if (v3.length) lots.push(etatsDeLaChaine(chaine, v3, wallet))
    if (v4.length) lots.push(etatsV4(chaine, v4))
  }
  const lus = (await Promise.all(lots)).flat()
  // Dans l'ordre de la liste demandée.
  const cle = (r: RefPosition) => `${r.gestionnaire.toLowerCase()}:${r.id}`
  const rang = new Map(refs.map((r, i) => [cle(r), i]))
  return lus.sort((x, y) => rang.get(cle(x.ref))! - rang.get(cle(y.ref))!)
}
