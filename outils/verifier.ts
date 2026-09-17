// Contrôle le moteur sur les positions d'un wallet, avec des vérités indépendantes du calcul :
// - fees en attente : collect() simulé depuis le propriétaire, au bloc de la photo ;
// - AERO d'une période stakée terminée : ClaimRewards versés au wallet par ce gauge pendant la période.
// Usage : npm run verifier -- 0xAdresse
import './env'
import { decodeFunctionResult, encodeFunctionData, getAddress, isAddress, pad, parseAbi, toEventSelector, toHex } from 'viem'
import { CHAINES } from '../src/moteur/chaines'
import { lireEtats } from '../src/moteur/etat'
import { reconstruireHistorique } from '../src/moteur/historique'
import { listerPositions } from '../src/moteur/lister'
import { lisible } from '../src/moteur/maths'
import * as F from '../src/ui/format'

const abi = parseAbi([
  'function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) returns (uint256 amount0, uint256 amount1)',
  'function ownerOf(uint256 tokenId) view returns (address)',
])
const MAX128 = 2n ** 128n - 1n
const T_CLAIM = toEventSelector('ClaimRewards(address,uint256)')

const saisie = process.argv[2]
if (!saisie || !isAddress(saisie)) {
  console.error('usage : npm run verifier -- 0xAdresseDuWallet')
  process.exit(1)
}
const wallet = getAddress(saisie)
const { positions, erreurs } = await listerPositions(wallet)
for (const e of erreurs) console.log(`! ${e}`)
if (!positions.length) console.log('aucune position ouverte lue')
const etats = await lireEtats(positions, wallet)

for (const etat of etats) {
  const chaine = CHAINES[etat.ref.chaine]
  const d0 = etat.jeton0.decimales
  const d1 = etat.jeton1.decimales
  const s0 = etat.jeton0.symbole
  const s1 = etat.jeton1.symbole
  console.log(`\n── ${s0}/${s1} #${etat.ref.id} (${chaine.nom})`)

  // Fees en attente.
  const proprio = await chaine.archive.readContract({ address: etat.ref.gestionnaire, abi, functionName: 'ownerOf', args: [etat.ref.id], blockNumber: etat.bloc })
  const brut = await chaine.archive.call({
    account: proprio,
    to: etat.ref.gestionnaire,
    data: encodeFunctionData({ abi, functionName: 'collect', args: [{ tokenId: etat.ref.id, recipient: proprio, amount0Max: MAX128, amount1Max: MAX128 }] }),
    blockNumber: etat.bloc,
  })
  const [v0, v1] = decodeFunctionResult({ abi, functionName: 'collect', data: brut.data! })
  const ok = v0 === etat.feesEnAttente0 && v1 === etat.feesEnAttente1
  console.log(`  fees en attente : moteur ${lisible(etat.feesEnAttente0, d0)} ${s0} | ${lisible(etat.feesEnAttente1, d1)} ${s1}`)
  console.log(`                    collect  ${lisible(v0, d0)} ${s0} | ${lisible(v1, d1)} ${s1}  → ${ok ? 'IDENTIQUE' : `ÉCART ${v0 - etat.feesEnAttente0} / ${v1 - etat.feesEnAttente1}`}`)

  const h = await reconstruireHistorique(etat)
  // Les retraits de fees (capital déduit) + ce qui attend doivent redonner le total des fees.
  const recompose0 = h.reclamations.reduce((s, r) => s + r.fees0, 0) + lisible(etat.feesEnAttente0, d0)
  const recompose1 = h.reclamations.reduce((s, r) => s + r.fees1, 0) + lisible(etat.feesEnAttente1, d1)
  const ecart0 = Math.abs(recompose0 - lisible(h.fees0, d0)) / Math.max(lisible(h.fees0, d0), 1e-18)
  const ecart1 = Math.abs(recompose1 - lisible(h.fees1, d1)) / Math.max(lisible(h.fees1, d1), 1e-18)
  console.log(`  retraits de fees : ${h.reclamations.length} · retraits + en attente = total ? écarts ${(ecart0 * 100).toExponential(1)} % | ${(ecart1 * 100).toExponential(1)} %`)
  console.log('  mouvements :')
  for (const m of h.mouvements) {
    console.log(`    ${F.date(m.horodatage)} ${m.type === 'depot' ? 'dépôt  ' : 'retrait'} ${F.nombre(m.quantite0)} ${s0} + ${F.nombre(m.quantite1)} ${s1}  (1 ${s0} = ${F.nombre(m.prix)} ${s1}) bloc ${m.bloc}`)
  }

  // AERO des périodes stakées terminées.
  for (const p of h.periodesStakees) {
    console.log(`  période stakée du ${F.date(p.debut)} au ${p.fin ? F.date(p.fin) : "aujourd'hui"} : moteur ${lisible(p.aero, 18)} AERO`)
    if (p.fin === null || !chaine.journal) continue
    const [debut, fin] = await Promise.all(
      [p.debut, p.fin].map(async (horodatage) => {
        // Bloc à partir de l'horodatage : on le retrouve dans les mouvements/transferts via une recherche simple.
        let bas = 0n
        let haut = etat.bloc
        while (haut - bas > 1n) {
          const m = (bas + haut) / 2n
          const b = await chaine.archive.getBlock({ blockNumber: m })
          if (Number(b.timestamp) >= horodatage) haut = m
          else bas = m
        }
        return haut
      }),
    )
    const logs = (await chaine.journal.request({
      method: 'eth_getLogs',
      params: [{ address: p.gauge, topics: [T_CLAIM, pad(wallet, { size: 32 })], fromBlock: toHex(debut), toBlock: toHex(fin) }],
    })) as { data: `0x${string}` }[]
    const verses = logs.reduce((s, l) => s + BigInt(l.data), 0n)
    console.log(`    AERO versés au wallet par ce gauge sur la période : ${lisible(verses, 18)} (${logs.length} versement(s)), pénalités ${lisible(h.penalites, 18)}`)
    const rel = verses > 0n ? Math.abs(Number(p.aero - h.penalites - verses)) / Number(verses) : NaN
    console.log(`    écart : ${Number.isFinite(rel) ? (rel * 100).toFixed(6) + ' %' : '—'}`)
  }
}
