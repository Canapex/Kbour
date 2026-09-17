import { decodeEventLog, pad, parseAbi, toEventSelector, toHex, type Address, type Hex } from 'viem'
import { abiGauge, abiPoolAerodrome, abiPoolUniswap } from './abis'
import { AERODROME, CHAINES, UNISWAP_V3, type Chaine } from './chaines'
import { lireTout, valeur } from './lecture'
import { gainEntre, prixLisible, racinePrixDuTick, racinePrixX96 } from './maths'
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
  requetes: number
  secondes: number
}

interface LogBrut {
  address: Address
  blockNumber: Hex
  logIndex: Hex
  data: Hex
  topics: [Hex, ...Hex[]]
  blockTimestamp?: Hex
}

function blocDeCreation(etat: EtatPosition): bigint {
  const gestionnaire = etat.ref.gestionnaire.toLowerCase()
  if (etat.ref.protocole === 'uniswap-v3') return UNISWAP_V3.find((u) => u.gestionnaire.toLowerCase() === gestionnaire)?.creation ?? 0n
  return AERODROME.gestionnaires.find((g) => g.adresse.toLowerCase() === gestionnaire)?.creation ?? 0n
}

async function lireJournal(
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
        throw new Error('plus de 10 000 événements : position pilotée par un bot, historique non calculé')
      }
      // Saturation passagère d'un RPC public : on réessaie en espaçant.
      if (essai >= 4 || !/timed out|too many requests|rate limit|\b429\b/i.test(texte)) throw e
      await new Promise((reprendre) => setTimeout(reprendre, 1_000 * 2 ** essai))
    }
  }
}

export async function reconstruireHistorique(etat: EtatPosition): Promise<Historique> {
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
  const abiPool = aerodrome ? abiPoolAerodrome : abiPoolUniswap
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
    requetes,
    secondes: (Date.now() - chrono) / 1000,
  }
}
