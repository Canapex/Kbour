// Trouve sur Robinhood Chain des wallets (pas des contrats) dont une position encore ouverte a déjà retiré des fees.
// Usage : npx tsx outils/trouver-reclamations.ts
import './env'
import { parseAbi, parseAbiItem, type Address } from 'viem'
import { CHAINES, UNISWAP_V3 } from '../src/moteur/chaines'
import { lireTout, valeur } from '../src/moteur/lecture'

const chaine = CHAINES.robinhood
const gestionnaire = UNISWAP_V3.find((u) => u.chaine === 'robinhood')!.gestionnaire
const abi = parseAbi([
  'function positions(uint256 tokenId) view returns (uint96, address, address, address, uint24, int24, int24, uint128, uint256, uint256, uint128, uint128)',
  'function ownerOf(uint256 tokenId) view returns (address)',
])

const sommet = await chaine.etat.getBlockNumber()
const collects = await chaine.journal!.getLogs({
  address: gestionnaire,
  event: parseAbiItem('event Collect(uint256 indexed tokenId, address recipient, uint256 amount0, uint256 amount1)'),
  fromBlock: sommet - 40_000n,
  toBlock: sommet,
})
const ids = [...new Set(collects.map((l) => l.args.tokenId!))].slice(0, 150)
console.log(`${collects.length} collects sur les ~70 dernières minutes, ${ids.length} positions distinctes examinées`)

const lus = await lireTout(
  chaine.etat,
  ids.flatMap((id) => [
    { address: gestionnaire, abi, functionName: 'positions', args: [id] },
    { address: gestionnaire, abi, functionName: 'ownerOf', args: [id] },
  ]),
)
let trouves = 0
for (let i = 0; i < ids.length && trouves < 5; i++) {
  const p = valeur<readonly unknown[]>(lus[2 * i])
  const proprio = valeur<Address>(lus[2 * i + 1])
  if (!p || !proprio || (p[7] as bigint) === 0n) continue
  const code = await chaine.etat.getCode({ address: proprio })
  if (code && code !== '0x') continue
  console.log(`  wallet ${proprio} · position ouverte #${ids[i]} avec retrait récent`)
  trouves++
}
