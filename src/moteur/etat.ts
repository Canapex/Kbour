import { hexToString, type Address, type Hex } from 'viem'
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
} from './abis'
import { CHAINES, MULTICALL3 } from './chaines'
import { lireTout, valeur, type Appel } from './lecture'
import {
  Q128,
  croissanceInterieure,
  gainEntre,
  prixLisible,
  quantitesLisibles,
  racinePrixDuTick,
  racinePrixX96,
} from './maths'
import type { EtatPosition, IdChaine, Jeton, RefPosition } from './types'

type Tuple = readonly unknown[]

const unique = <T>(xs: T[]): T[] => [...new Set(xs)]

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
  const lecturesPool = new Map(
    poolsUniques.map((pool) => {
      const aero = protocoleDuPool.get(pool) === 'aerodrome'
      const abi = aero ? abiPoolAerodrome : abiPoolUniswap
      const lire = (functionName: string) => ajouter({ address: pool, abi, functionName })
      return [
        pool,
        {
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
    }
  })
}

export async function lireEtats(refs: RefPosition[], wallet: Address): Promise<EtatPosition[]> {
  const parChaine = (Object.keys(CHAINES) as IdChaine[]).map((c) => refs.filter((r) => r.chaine === c))
  const lus = await Promise.all(parChaine.map((liste) => (liste.length ? etatsDeLaChaine(liste[0].chaine, liste, wallet) : [])))
  return lus.flat()
}
