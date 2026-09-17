// Trouve des wallets réels (pas des contrats) qui ont des positions Uniswap v3 ouvertes sur une chaîne.
// Usage : npx tsx outils/trouver-wallet.ts robinhood
import './env'
import { parseAbi, type Address } from 'viem'
import { CHAINES, UNISWAP_V3 } from '../src/moteur/chaines'
import { lireTout, valeur } from '../src/moteur/lecture'
import type { IdChaine } from '../src/moteur/types'

const id = (process.argv[2] ?? 'robinhood') as IdChaine
const chaine = CHAINES[id]
const gestionnaire = UNISWAP_V3.find((u) => u.chaine === id)!.gestionnaire
const abi = parseAbi([
  'function totalSupply() view returns (uint256)',
  'function tokenByIndex(uint256 index) view returns (uint256)',
  'function positions(uint256 tokenId) view returns (uint96, address, address, address, uint24, int24, int24, uint128, uint256, uint256, uint128, uint128)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function balanceOf(address owner) view returns (uint256)',
])

const total = await chaine.etat.readContract({ address: gestionnaire, abi, functionName: 'totalSupply' })
console.log(`${chaine.nom} : ${total} NFT de positions Uniswap v3`)
const indices = Array.from({ length: 80 }, (_, i) => (total * BigInt(i + 1)) / 81n)
const ids = (await lireTout(chaine.etat, indices.map((i) => ({ address: gestionnaire, abi, functionName: 'tokenByIndex', args: [i] }))))
  .map((r) => valeur<bigint>(r))
  .filter((x): x is bigint => x !== undefined)
const lus = await lireTout(
  chaine.etat,
  ids.flatMap((tokenId) => [
    { address: gestionnaire, abi, functionName: 'positions', args: [tokenId] },
    { address: gestionnaire, abi, functionName: 'ownerOf', args: [tokenId] },
  ]),
)
const proprios = new Map<Address, bigint[]>()
ids.forEach((tokenId, i) => {
  const p = valeur<readonly unknown[]>(lus[2 * i])
  const proprio = valeur<Address>(lus[2 * i + 1])
  if (p && proprio && (p[7] as bigint) > 0n) proprios.set(proprio, [...(proprios.get(proprio) ?? []), tokenId])
})
let trouves = 0
for (const [proprio, positions] of proprios) {
  const code = await chaine.etat.getCode({ address: proprio })
  if (code && code !== '0x') continue
  const nft = await chaine.etat.readContract({ address: gestionnaire, abi, functionName: 'balanceOf', args: [proprio] })
  console.log(`  wallet ${proprio} : positions ouvertes échantillonnées ${positions.map((x) => '#' + x).join(', ')} · ${nft} NFT au total`)
  if (++trouves >= 6) break
}
