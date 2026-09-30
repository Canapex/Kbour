import { decodeEventLog, pad, parseAbi, toEventSelector, toHex, type Address, type Hex } from 'viem'
import { abiDuPool, abiGauge } from './abis'
import { AERODROME, CHAINES, PANCAKESWAP_V3, UNISWAP_V3, estSingleton, v4De, type Chaine } from './chaines'
import { appelReleve, appelSlot0, selV4 } from './etat'
import { lireTout, valeur } from './lecture'
import { gainEntre, montantsExacts, prixLisible, racinePrixDuTick, racinePrixX96 } from './maths'
import type { EtatPosition } from './types'

// Historique lu dans le journal de la chaîne (eth_getLogs via Alchemy) : montants exacts, quelques requêtes.
// Les AERO ne sont pas attribuables par position dans le journal (ClaimRewards est par wallet) :
// on les calcule avec le compteur du gauge au début et à la fin de chaque période stakée.

const abiJournal = parseAbi([
  'event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'event DecreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'event Collect(uint256 indexed tokenId, address recipient, uint256 amount0, uint256 amount1)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  'event EarlyWithdrawPenalty(address indexed from, uint256 indexed tokenId, uint256 penalty)',
])
const SUJET = {
  ajout: toEventSelector('IncreaseLiquidity(uint256,uint128,uint256,uint256)'),
  retrait: toEventSelector('DecreaseLiquidity(uint256,uint128,uint256,uint256)'),
  collect: toEventSelector('Collect(uint256,address,uint256,uint256)'),
  transfert: toEventSelector('Transfer(address,address,uint256)'),
  penalite: toEventSelector('EarlyWithdrawPenalty(address,uint256,uint256)'),
}

export interface Mouvement {
  type: 'depot' | 'retrait'
  bloc: bigint
  horodatage: number
  quantite0: number
  quantite1: number
  /** Prix du jeton0 en jeton1 au moment du mouvement. */
  prix: number
}

/** Un retrait de fees (Collect), part de capital déduite. */
export interface RetraitDeFees {
  bloc: bigint
  horodatage: number
  fees0: number
  fees1: number
}

export interface PeriodeStakee {
  gauge: Address
  debut: number
  /** null : encore stakée. */
  fin: number | null
  aero: bigint
}

export interface Historique {
  ouverture: { bloc: bigint; horodatage: number }
  mouvements: Mouvement[]
  periodesStakees: PeriodeStakee[]
  /** Retraits de fees dans l'ordre chronologique (sans les collects qui ne rapatrient que du capital). */
  reclamations: RetraitDeFees[]
  /** Fees gagnées depuis l'ouverture : déjà réclamées + en attente. */
  fees0: bigint
  fees1: bigint
  /** AERO gagnés sur toutes les périodes stakées, pénalités de sortie anticipée déduites. */
  aero: bigint
  penalites: bigint
  /** Une entrée par transaction de la position : ce qu'elle a coûté en gas, frais L1 compris. */
  transactions: { horodatage: number; gaz: bigint }[]
  /** Faux si un reçu n'a pas pu être lu : le total en gas serait sous-estimé. */
  gazConnu: boolean
  requetes: number
  secondes: number
}

interface LogBrut {
  address: Address
  transactionHash: Hex
  blockNumber: Hex
  logIndex: Hex
  data: Hex
  topics: [Hex, ...Hex[]]
  blockTimestamp?: Hex
}

function blocDeCreation(etat: EtatPosition): bigint {
  const gestionnaire = etat.ref.gestionnaire.toLowerCase()
  // PancakeSwap a la même adresse sur chaque chaîne : on cherche aussi par chaîne.
  const surLaChaine = (u: { chaine: string; gestionnaire: Address }) => u.chaine === etat.ref.chaine && u.gestionnaire.toLowerCase() === gestionnaire
  if (etat.ref.protocole === 'uniswap-v3') return UNISWAP_V3.find(surLaChaine)?.creation ?? 0n
  if (etat.ref.protocole === 'pancakeswap-v3') return PANCAKESWAP_V3.find(surLaChaine)?.creation ?? 0n
  return AERODROME.gestionnaires.find((g) => g.adresse.toLowerCase() === gestionnaire)?.creation ?? 0n
}

const TROP_D_EVENEMENTS = 'plus de 10 000 événements'

export async function lireJournal(
  chaine: Chaine,
  adresse: Address | Address[],
  topics: (Hex | Hex[] | null)[],
  depuis: bigint,
  jusqua: bigint,
): Promise<LogBrut[]> {
  const journal = chaine.journal
  if (!journal) throw new Error("pas de clé Alchemy : l'historique a besoin du journal de la chaîne")
  for (let essai = 0; ; essai++) {
    try {
      return (await chaine.limiterJournal(() =>
        journal.request({
          method: 'eth_getLogs',
          params: [{ address: adresse, topics, fromBlock: toHex(depuis), toBlock: toHex(jusqua) }],
        }),
      )) as unknown as LogBrut[]
    } catch (e) {
      const texte = `${(e as Error)?.message ?? e} ${(e as { details?: string })?.details ?? ''}`
      if (texte.includes('response size exceeded')) {
        throw new Error(`${TROP_D_EVENEMENTS} : position pilotée par un bot, historique non calculé`)
      }
      // Saturation passagère d'un RPC public : on réessaie en espaçant.
      if (essai >= 4 || !/timed out|too many requests|rate limit|\b429\b/i.test(texte)) throw e
      await new Promise((reprendre) => setTimeout(reprendre, 1_000 * 2 ** essai))
    }
  }
}

/**
 * Comme lireJournal, mais une plage qui dépasse 10 000 événements est coupée en deux, puis en deux encore :
 * le journal d'un pool v4 très actif (tous ses dépôts passent par le même PoolManager) ne tient pas d'un coup.
 */
export async function lireJournalDecoupe(
  chaine: Chaine,
  adresse: Address | Address[],
  topics: (Hex | Hex[] | null)[],
  depuis: bigint,
  jusqua: bigint,
): Promise<LogBrut[]> {
  try {
    return await lireJournal(chaine, adresse, topics, depuis, jusqua)
  } catch (e) {
    if (!String((e as Error)?.message).startsWith(TROP_D_EVENEMENTS) || jusqua <= depuis) throw e
    const milieu = (depuis + jusqua) / 2n
    const [a, b] = await Promise.all([
      lireJournalDecoupe(chaine, adresse, topics, depuis, milieu),
      lireJournalDecoupe(chaine, adresse, topics, milieu + 1n, jusqua),
    ])
    return [...a, ...b]
  }
}

export async function reconstruireHistorique(etat: EtatPosition): Promise<Historique> {
  if (estSingleton(etat.ref.protocole)) return historiqueV4(etat)
  const chaine = CHAINES[etat.ref.chaine]
  const chrono = Date.now()
  const aerodrome = etat.ref.protocole === 'aerodrome'
  const gestionnaire = etat.ref.gestionnaire.toLowerCase()
  const sujetId = pad(toHex(etat.ref.id), { size: 32 })
  const creation = blocDeCreation(etat)
  let requetes = 0

  // 1. Journal du NFT : dépôts, retraits, réclamations ; et ses transferts (entrées et sorties de gauge).
  const [brutsNft, brutsTransferts] = await Promise.all([
    lireJournal(chaine, etat.ref.gestionnaire, [[SUJET.ajout, SUJET.retrait, SUJET.collect], sujetId], creation, etat.bloc),
    aerodrome
      ? lireJournal(chaine, etat.ref.gestionnaire, [SUJET.transfert, null, null, sujetId], creation, etat.bloc)
      : Promise.resolve([]),
  ])
  requetes += aerodrome ? 2 : 1

  // Horodatages : Alchemy les joint aux événements ; le RPC public de Robinhood renvoie le champ à 0x0
  // (mesuré) : dans ce cas, lecture du bloc.
  const heures = new Map<bigint, number>()
  const sansHeure = new Set<bigint>()
  for (const log of [...brutsNft, ...brutsTransferts]) {
    const bloc = BigInt(log.blockNumber)
    const heure = log.blockTimestamp ? Number(BigInt(log.blockTimestamp)) : 0
    if (heure > 1_400_000_000) heures.set(bloc, heure)
    else sansHeure.add(bloc)
  }
  await Promise.all(
    [...sansHeure].filter((b) => !heures.has(b)).map(async (b) => {
      const bloc = await chaine.limiterArchive(() => chaine.archive.getBlock({ blockNumber: b }))
      heures.set(b, Number(bloc.timestamp))
      requetes++
    }),
  )

  // Coût en gas : un reçu par transaction de la position. Les rollups facturent en plus
  // la publication sur Ethereum (l1Fee), que le reçu porte quand la chaîne la sépare.
  const heureDeLaTransaction = new Map<Hex, number>()
  for (const log of [...brutsNft, ...brutsTransferts]) {
    heureDeLaTransaction.set(log.transactionHash, heures.get(BigInt(log.blockNumber))!)
  }
  let gazConnu = true
  const transactions = await Promise.all(
    [...heureDeLaTransaction].map(async ([hash, horodatage]) => {
      try {
        const recu = await chaine.limiterArchive(() => chaine.archive.getTransactionReceipt({ hash }))
        requetes++
        const l1 = (recu as { l1Fee?: bigint | null }).l1Fee ?? 0n
        return { horodatage, gaz: recu.gasUsed * recu.effectiveGasPrice + l1 }
      } catch {
        gazConnu = false
        return { horodatage, gaz: 0n }
      }
    }),
  )

  const evenements = [...brutsNft, ...brutsTransferts]
    .map((log) => ({
      bloc: BigInt(log.blockNumber),
      index: Number(BigInt(log.logIndex)),
      horodatage: heures.get(BigInt(log.blockNumber))!,
      ...decodeEventLog({ abi: abiJournal, data: log.data, topics: log.topics }),
    }))
    .sort((a, b) => (a.bloc === b.bloc ? a.index - b.index : a.bloc < b.bloc ? -1 : 1))

  // 2. Parmi les destinataires du NFT, lesquels sont des gauges de ce contrat.
  const gauges = new Set<string>()
  if (aerodrome) {
    const contreparties = [
      ...new Set(
        evenements
          .filter((e) => e.eventName === 'Transfer')
          .flatMap((e) => {
            const a = e.args as { from: Address; to: Address }
            return [a.from, a.to]
          })
          .filter((a) => BigInt(a) !== 0n)
          .map((a) => a.toLowerCase() as Address),
      ),
    ]
    const nfts = await lireTout(chaine.etat, contreparties.map((a) => ({ address: a, abi: abiGauge, functionName: 'nft' })))
    requetes++
    contreparties.forEach((a, i) => {
      if (valeur<Address>(nfts[i])?.toLowerCase() === gestionnaire) gauges.add(a)
    })
  }

  // 3. Parcours chronologique.
  const d0 = etat.jeton0.decimales
  const d1 = etat.jeton1.decimales
  const mouvements: (Mouvement & { liquidite: bigint; brut0: bigint; brut1: bigint })[] = []
  const periodes: { gauge: Address; debutBloc: bigint; debut: number; finBloc: bigint | null; fin: number | null; liquidite: bigint }[] = []
  let liquidite = 0n
  let collecte0 = 0n
  let collecte1 = 0n
  let retire0 = 0n
  let retire1 = 0n
  // Capital sorti de la position (DecreaseLiquidity) mais pas encore récupéré par un collect.
  let capitalDu0 = 0n
  let capitalDu1 = 0n
  const reclamations: RetraitDeFees[] = []
  let ouverture: { bloc: bigint; horodatage: number } | null = null
  let enCours: (typeof periodes)[number] | null = null

  for (const e of evenements) {
    if (e.eventName === 'IncreaseLiquidity' || e.eventName === 'DecreaseLiquidity') {
      const a = e.args as { liquidity: bigint; amount0: bigint; amount1: bigint }
      const depot = e.eventName === 'IncreaseLiquidity'
      liquidite += depot ? a.liquidity : -a.liquidity
      if (depot) ouverture ??= { bloc: e.bloc, horodatage: e.horodatage }
      else {
        retire0 += a.amount0
        retire1 += a.amount1
        capitalDu0 += a.amount0
        capitalDu1 += a.amount1
      }
      mouvements.push({
        type: depot ? 'depot' : 'retrait',
        bloc: e.bloc,
        horodatage: e.horodatage,
        quantite0: Number(a.amount0) / 10 ** d0,
        quantite1: Number(a.amount1) / 10 ** d1,
        prix: NaN,
        liquidite: a.liquidity,
        brut0: a.amount0,
        brut1: a.amount1,
      })
    } else if (e.eventName === 'Collect') {
      const a = e.args as { amount0: bigint; amount1: bigint }
      collecte0 += a.amount0
      collecte1 += a.amount1
      // Un collect rapatrie d'abord le capital retiré, le reste est des fees.
      const capital0 = a.amount0 < capitalDu0 ? a.amount0 : capitalDu0
      const capital1 = a.amount1 < capitalDu1 ? a.amount1 : capitalDu1
      capitalDu0 -= capital0
      capitalDu1 -= capital1
      const fees0 = a.amount0 - capital0
      const fees1 = a.amount1 - capital1
      if (fees0 > 0n || fees1 > 0n) {
        reclamations.push({ bloc: e.bloc, horodatage: e.horodatage, fees0: Number(fees0) / 10 ** d0, fees1: Number(fees1) / 10 ** d1 })
      }
    } else if (e.eventName === 'Transfer') {
      const a = e.args as { from: Address; to: Address }
      if (gauges.has(a.to.toLowerCase())) {
        enCours = { gauge: a.to, debutBloc: e.bloc, debut: e.horodatage, finBloc: null, fin: null, liquidite }
      } else if (enCours && a.from.toLowerCase() === enCours.gauge.toLowerCase()) {
        periodes.push({ ...enCours, finBloc: e.bloc, fin: e.horodatage })
        enCours = null
      }
    }
  }
  if (enCours) periodes.push(enCours)
  if (!ouverture) throw new Error("aucun dépôt dans le journal : position illisible")

  // 4. Prix de chaque mouvement : déduit des montants quand les deux jetons bougent,
  //    sinon (dépôt d'un seul côté) lu dans le pool à ce bloc.
  const sa = racinePrixDuTick(etat.tickBas)
  const abiPool = abiDuPool(etat.ref.protocole)
  await Promise.all(
    mouvements.map(async (m) => {
      if (m.brut0 > 0n && m.brut1 > 0n && m.liquidite > 0n) {
        m.prix = prixLisible(sa + Number(m.brut1) / Number(m.liquidite), d0, d1)
        return
      }
      const [slot0] = await chaine.limiterArchive(() =>
        lireTout(chaine.archive, [{ address: etat.pool, abi: abiPool, functionName: 'slot0' }], m.bloc, chaine.multicallDepuis),
      )
      requetes++
      const s = valeur<readonly unknown[]>(slot0)
      m.prix = s ? prixLisible(racinePrixX96(s[0] as bigint), d0, d1) : etat.prix
    }),
  )

  // 5. AERO par période stakée : compteur du gauge au stake, puis à l'unstake (ou maintenant).
  const periodesStakees: PeriodeStakee[] = await Promise.all(
    periodes.map(async (p) => {
      const lireCompteur = async (bloc: bigint) => {
        const [r] = await chaine.limiterArchive(() =>
          lireTout(chaine.archive, [{ address: p.gauge, abi: abiGauge, functionName: 'rewardGrowthInside', args: [etat.ref.id] }], bloc),
        )
        requetes++
        return valeur<bigint>(r) ?? 0n
      }
      const [debut, fin] = await Promise.all([
        lireCompteur(p.debutBloc),
        p.finBloc !== null ? lireCompteur(p.finBloc) : Promise.resolve(etat.croissanceAero),
      ])
      return { gauge: p.gauge, debut: p.debut, fin: p.fin, aero: gainEntre(fin, debut, p.liquidite) }
    }),
  )

  let penalites = 0n
  if (periodes.length) {
    const logs = await lireJournal(chaine, [...new Set(periodes.map((p) => p.gauge))], [SUJET.penalite, null, sujetId], periodes[0].debutBloc, etat.bloc)
    requetes++
    for (const log of logs) penalites += (decodeEventLog({ abi: abiJournal, data: log.data, topics: log.topics }).args as { penalty: bigint }).penalty
  }

  return {
    ouverture,
    mouvements: mouvements.map(({ liquidite: _l, brut0: _b0, brut1: _b1, ...m }) => m),
    periodesStakees,
    reclamations,
    // Les collects incluent le capital retiré : on le retranche, puis on ajoute ce qui attend d'être réclamé.
    fees0: collecte0 - retire0 + etat.feesEnAttente0,
    fees1: collecte1 - retire1 + etat.feesEnAttente1,
    aero: periodesStakees.reduce((s, p) => s + p.aero, 0n) - penalites,
    penalites,
    transactions,
    gazConnu,
    requetes,
    secondes: (Date.now() - chrono) / 1000,
  }
}

// ── Uniswap v4 et PancakeSwap Infinity ─────────────────────────────────────────────────────────────────
// Le contrat des positions n'émet ni dépôt, ni retrait, ni collect : tout se lit dans le PoolManager, qui émet
// ModifyLiquidity (pool, contrat appelant, ticks, variation de liquidité, sel = numéro du NFT). Les montants
// n'y figurent pas : ils se recalculent au wei près avec la variation de liquidité et le prix du pool à cet
// instant (montantsExacts) : celui du dernier échange du même bloc qui la précède, à défaut celui du bloc
// d'avant. Les fees sont versées à chaque modification, sans événement : c'est la croissance relevée dans la
// position juste après, moins celle d'avant, fois la liquidité d'avant (Position.update). PancakeSwap émet le
// même ModifyLiquidity ; ses Swap et Initialize ont d'autres champs, donc d'autres signatures.

const abiPoolManager = parseAbi([
  'event ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)',
  'event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)',
  'event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)',
  'event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee, uint16 protocolFee)',
  'event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, address hooks, uint24 fee, bytes32 parameters, uint160 sqrtPriceX96, int24 tick)',
])
const MODIFICATION = toEventSelector('ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)')
/** Ce qui fixe le prix d'un pool v4 : un échange, ou sa création (souvent dans la même transaction que le premier dépôt). */
const PRIX_FIXE = [
  toEventSelector('Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)'),
  toEventSelector('Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)'),
  toEventSelector('Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24,uint16)'),
  toEventSelector('Initialize(bytes32,address,address,address,uint24,bytes32,uint160,int24)'),
]

async function historiqueV4(etat: EtatPosition): Promise<Historique> {
  const chaine = CHAINES[etat.ref.chaine]
  const chrono = Date.now()
  const v4 = v4De(etat.ref.chaine, etat.ref.gestionnaire)!
  const sel = selV4(etat.ref.id)
  let requetes = 0

  // 1. Naissance du NFT, puis ses modifications, filtrées par pool, par contrat des positions et par sel.
  const naissances = await lireJournal(chaine, etat.ref.gestionnaire, [SUJET.transfert, null, null, sel], v4.creation, etat.bloc)
  requetes++
  if (!naissances.length) throw new Error('aucune trace du NFT dans le journal : position illisible')
  const depuis = naissances.map((l) => BigInt(l.blockNumber)).reduce((a, b) => (a < b ? a : b))
  const bruts = await lireJournalDecoupe(chaine, v4.poolManager, [MODIFICATION, etat.poolId!, pad(etat.ref.gestionnaire, { size: 32 })], depuis, etat.bloc)
  requetes++
  const modifications = bruts
    .map((log) => ({
      bloc: BigInt(log.blockNumber),
      index: Number(BigInt(log.logIndex)),
      hash: log.transactionHash,
      heure: log.blockTimestamp ? Number(BigInt(log.blockTimestamp)) : 0,
      ...(decodeEventLog({ abi: abiPoolManager, data: log.data, topics: log.topics }).args as {
        tickLower: number
        tickUpper: number
        liquidityDelta: bigint
        salt: Hex
      }),
    }))
    .filter((m) => m.salt.toLowerCase() === sel.toLowerCase() && m.tickLower === etat.tickBas && m.tickUpper === etat.tickHaut)
    .sort((a, b) => (a.bloc === b.bloc ? a.index - b.index : a.bloc < b.bloc ? -1 : 1))
  if (!modifications.length) throw new Error('aucun dépôt dans le journal : position illisible')

  // Horodatages : joints par Alchemy ; sinon, lecture du bloc (RPC public de Robinhood).
  const heures = new Map<bigint, number>()
  for (const m of modifications) if (m.heure > 1_400_000_000) heures.set(m.bloc, m.heure)
  await Promise.all(
    [...new Set(modifications.filter((m) => !heures.has(m.bloc)).map((m) => m.bloc))].map(async (b) => {
      const bloc = await chaine.limiterArchive(() => chaine.archive.getBlock({ blockNumber: b }))
      heures.set(b, Number(bloc.timestamp))
      requetes++
    }),
  )

  // 2. Pour chaque bloc touché : prix du pool et relevé de la position juste avant, relevé juste après.
  const releve = appelReleve(v4, etat.poolId!, etat.tickBas, etat.tickHaut, etat.ref.id)
  const slot0 = appelSlot0(v4, etat.poolId!)
  const blocs = [...new Set(modifications.map((m) => m.bloc))]
  const lectures = new Map(
    await Promise.all(
      blocs.map(async (b) => {
        const [avant, apres] = await Promise.all([
          chaine.limiterArchive(() => lireTout(chaine.archive, [slot0, releve], b - 1n, chaine.multicallDepuis)),
          chaine.limiterArchive(() => lireTout(chaine.archive, [releve], b, chaine.multicallDepuis)),
        ])
        requetes += 2
        const s = valeur<readonly [bigint, number]>(avant[0])
        const r0 = valeur<readonly [bigint, bigint, bigint]>(avant[1])
        const r1 = valeur<readonly [bigint, bigint, bigint]>(apres[0])
        if (!s || !r0 || !r1) throw new Error(`état du pool illisible au bloc ${b}`)
        return [b, { sqrtPriceX96: s[0], tick: Number(s[1]), avant: r0, apres: r1 }] as const
      }),
    ),
  )

  // Prix exact de chaque dépôt ou retrait : un échange placé avant lui dans le même bloc a déjà bougé le pool.
  const prixDuBloc = new Map(
    await Promise.all(
      [...new Set(modifications.filter((m) => m.liquidityDelta !== 0n).map((m) => m.bloc))].map(async (b) => {
        const logs = await lireJournal(chaine, v4.poolManager, [PRIX_FIXE, etat.poolId!], b, b)
        requetes++
        const fixes = logs
          .map((log) => ({
            index: Number(BigInt(log.logIndex)),
            ...(decodeEventLog({ abi: abiPoolManager, data: log.data, topics: log.topics }).args as { sqrtPriceX96: bigint; tick: number }),
          }))
          .sort((a, c) => a.index - c.index)
        return [b, fixes] as const
      }),
    ),
  )

  // 3. Parcours chronologique.
  const d0 = etat.jeton0.decimales
  const d1 = etat.jeton1.decimales
  const mouvements: Mouvement[] = []
  const reclamations: RetraitDeFees[] = []
  let verse0 = 0n
  let verse1 = 0n
  let ouverture: { bloc: bigint; horodatage: number } | null = null
  for (const b of blocs) {
    const l = lectures.get(b)!
    const horodatage = heures.get(b)!
    const fees0 = gainEntre(l.apres[1], l.avant[1], l.avant[0])
    const fees1 = gainEntre(l.apres[2], l.avant[2], l.avant[0])
    if (fees0 > 0n || fees1 > 0n) {
      verse0 += fees0
      verse1 += fees1
      reclamations.push({ bloc: b, horodatage, fees0: Number(fees0) / 10 ** d0, fees1: Number(fees1) / 10 ** d1 })
    }
    for (const m of modifications.filter((x) => x.bloc === b && x.liquidityDelta !== 0n)) {
      const fixe = prixDuBloc.get(b)!.filter((f) => f.index < m.index).at(-1) ?? l
      if (fixe.sqrtPriceX96 === 0n) throw new Error(`prix du pool introuvable au bloc ${b}`)
      const depot = m.liquidityDelta > 0n
      const [brut0, brut1] = montantsExacts(depot ? m.liquidityDelta : -m.liquidityDelta, fixe.sqrtPriceX96, Number(fixe.tick), etat.tickBas, etat.tickHaut, depot)
      if (depot) ouverture ??= { bloc: b, horodatage }
      const prix = prixLisible(racinePrixX96(fixe.sqrtPriceX96), d0, d1)
      mouvements.push({ type: depot ? 'depot' : 'retrait', bloc: b, horodatage, quantite0: Number(brut0) / 10 ** d0, quantite1: Number(brut1) / 10 ** d1, prix })
    }
  }
  if (!ouverture) throw new Error('aucun dépôt dans le journal : position illisible')

  // 4. Gas : un reçu par transaction qui a touché la position.
  let gazConnu = true
  const transactions = await Promise.all(
    [...new Map(modifications.map((m) => [m.hash, heures.get(m.bloc)!]))].map(async ([hash, horodatage]) => {
      try {
        const recu = await chaine.limiterArchive(() => chaine.archive.getTransactionReceipt({ hash }))
        requetes++
        const l1 = (recu as { l1Fee?: bigint | null }).l1Fee ?? 0n
        return { horodatage, gaz: recu.gasUsed * recu.effectiveGasPrice + l1 }
      } catch {
        gazConnu = false
        return { horodatage, gaz: 0n }
      }
    }),
  )

  return {
    ouverture,
    mouvements,
    periodesStakees: [],
    reclamations,
    fees0: verse0 + etat.feesEnAttente0,
    fees1: verse1 + etat.feesEnAttente1,
    aero: 0n,
    penalites: 0n,
    transactions,
    gazConnu,
    requetes,
    secondes: (Date.now() - chrono) / 1000,
  }
}
