// Uniswap v4 sur de vraies positions. Deux usages (n'affiche jamais la clé) :
//   npx tsx outils/essai-v4.ts trouver base         wallets (pas des contrats) actifs en v4 ces dernières heures
//   npx tsx outils/essai-v4.ts verifier base 12345  historique recalculé face aux jetons réellement transférés
import './env'
import { decodeEventLog, formatUnits, getAddress, parseAbi, toEventSelector, type Address, type Hex } from 'viem'
import { CHAINES, UNISWAP_V4 } from '../src/moteur/chaines'
import { lireEtats } from '../src/moteur/etat'
import { lireJournalDecoupe, reconstruireHistorique } from '../src/moteur/historique'
import { lireParPaquets, valeur } from '../src/moteur/lecture'
import type { IdChaine } from '../src/moteur/types'

const [mode, idChaine, idPosition] = process.argv.slice(2) as [string, IdChaine, string | undefined]
const chaine = CHAINES[idChaine]
const v4 = UNISWAP_V4.find((u) => u.chaine === idChaine)
if (!chaine || !v4 || (mode !== 'trouver' && mode !== 'verifier')) {
  console.error('usage : npx tsx outils/essai-v4.ts trouver|verifier <chaine> [idDeLaPosition]')
  process.exit(1)
}
const abi = parseAbi([
  'event ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'function ownerOf(uint256) view returns (address)',
  'function getPositionLiquidity(uint256) view returns (uint128)',
])
const MODIFICATION = toEventSelector('ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)')
const expediteur = `0x${v4.gestionnaire.slice(2).toLowerCase().padStart(64, '0')}` as Hex

if (mode === 'trouver') {
  const haut = await chaine.etat.getBlockNumber()
  const logs = await lireJournalDecoupe(chaine, v4.poolManager, [MODIFICATION, null, expediteur], haut - 3_000n, haut)
  const mods = logs.map((l) => ({ hash: l.transactionHash, ...(decodeEventLog({ abi, data: l.data, topics: l.topics }).args as { id: Hex; liquidityDelta: bigint; salt: Hex }) }))
  const parTx = new Map<Hex, number>()
  for (const m of mods) parTx.set(m.hash, (parTx.get(m.hash) ?? 0) + 1)
  const ids = [...new Set(mods.map((m) => BigInt(m.salt)))].slice(0, 400)
  const lus = await lireParPaquets(
    chaine.etat,
    ids.flatMap((id) => [
      { address: v4.gestionnaire, abi, functionName: 'ownerOf', args: [id] },
      { address: v4.gestionnaire, abi, functionName: 'getPositionLiquidity', args: [id] },
    ]),
  )
  const proprietaires = new Map<string, { ids: bigint[]; collectes: number }>()
  ids.forEach((id, i) => {
    const p = valeur<Address>(lus[2 * i])
    if (!p || !valeur<bigint>(lus[2 * i + 1])) return
    const e = proprietaires.get(p) ?? { ids: [], collectes: 0 }
    e.ids.push(id)
    // Une modification à zéro, seule dans sa transaction : une réclamation de fees nette, comparable aux transferts.
    e.collectes += mods.filter((m) => BigInt(m.salt) === id && m.liquidityDelta === 0n && parTx.get(m.hash) === 1).length
    proprietaires.set(p, e)
  })
  console.log(`${chaine.nom} : ${mods.length} modifications v4 sur 3 000 blocs, ${ids.length} positions, ${proprietaires.size} détenteurs`)
  let montres = 0
  for (const [p, e] of [...proprietaires].sort((a, b) => b[1].collectes - a[1].collectes)) {
    const code = await chaine.etat.getCode({ address: p as Address })
    if (code && code !== '0x' && !code.startsWith('0xef0100')) continue
    console.log(`  ${p}  ${e.ids.length} position(s) ouverte(s) [${e.ids.slice(0, 5).join(', ')}]  collectes seules : ${e.collectes}`)
    if (++montres >= 12) break
  }
} else {
  const id = BigInt(idPosition!)
  const proprietaire = await chaine.etat.readContract({ address: v4.gestionnaire, abi, functionName: 'ownerOf', args: [id] })
  const [etat] = await lireEtats([{ chaine: idChaine, protocole: 'uniswap-v4', gestionnaire: v4.gestionnaire, id, gauge: null }], proprietaire)
  const [j0, j1] = [etat.jeton0, etat.jeton1]
  console.log(`#${id} ${j0.symbole}/${j1.symbole}  ticks ${etat.tickBas}..${etat.tickHaut}  L ${etat.liquidite}  fees en attente ${formatUnits(etat.feesEnAttente0, j0.decimales)} / ${formatUnits(etat.feesEnAttente1, j1.decimales)}`)
  const h = await reconstruireHistorique(etat)
  console.log(`historique : ${h.mouvements.length} mouvements, ${h.reclamations.length} réclamations, ${h.requetes} requêtes, ${h.secondes.toFixed(1)} s`)

  // Chaque transaction de la position : ce que le PoolManager a réellement envoyé (+) ou reçu (−), jeton par jeton.
  const logs = await lireJournalDecoupe(chaine, v4.poolManager, [MODIFICATION, etat.poolId!, expediteur], h.ouverture.bloc, etat.bloc)
  const pm = v4.poolManager.toLowerCase()
  for (const l of logs) {
    const m = decodeEventLog({ abi, data: l.data, topics: l.topics }).args as { liquidityDelta: bigint; salt: Hex }
    if (BigInt(m.salt) !== id) continue
    const bloc = BigInt(l.blockNumber)
    const recu = await chaine.archive.getTransactionReceipt({ hash: l.transactionHash })
    const autres = recu.logs.filter((x) => x.topics[0] === MODIFICATION).length
    const net = (jeton: Address) => {
      let s = 0n
      for (const x of recu.logs) {
        if (x.address.toLowerCase() !== jeton.toLowerCase() || x.topics[0] !== toEventSelector('Transfer(address,address,uint256)') || x.topics.length !== 3) continue
        const t = decodeEventLog({ abi, data: x.data, topics: x.topics }).args as { from: Address; to: Address; value: bigint }
        if (t.from.toLowerCase() === pm) s += t.value
        if (t.to.toLowerCase() === pm) s -= t.value
      }
      return s
    }
    const natif = (a: Address) => BigInt(a) === 0n
    const reel = [natif(j0.adresse) ? null : net(j0.adresse), natif(j1.adresse) ? null : net(j1.adresse)]
    const r = h.reclamations.find((x) => x.bloc === bloc)
    const mv = h.mouvements.filter((x) => x.bloc === bloc)
    const signe = (x: { type: string }) => (x.type === 'retrait' ? 1 : -1)
    const calcule = [
      (r?.fees0 ?? 0) + mv.reduce((s, x) => s + signe(x) * x.quantite0, 0),
      (r?.fees1 ?? 0) + mv.reduce((s, x) => s + signe(x) * x.quantite1, 0),
    ]
    const lisible = (v: bigint | null, d: number) => (v === null ? 'natif, non visible' : Number(formatUnits(v, d)).toPrecision(8))
    console.log(
      `  bloc ${bloc}  ΔL ${m.liquidityDelta}${autres > 1 ? `  (${autres} modifications dans la tx)` : ''}\n` +
        `     calculé ${calcule[0].toPrecision(8)} ${j0.symbole} / ${calcule[1].toPrecision(8)} ${j1.symbole}   (fees ${r ? `${r.fees0.toPrecision(6)} / ${r.fees1.toPrecision(6)}` : '0'})\n` +
        `     réel    ${lisible(reel[0], j0.decimales)} ${j0.symbole} / ${lisible(reel[1], j1.decimales)} ${j1.symbole}`,
    )
  }
  console.log(`détenteur ${getAddress(proprietaire).slice(0, 8)}…`)
}
