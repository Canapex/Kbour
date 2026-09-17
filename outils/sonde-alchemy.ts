// Mesure ce que la clé Alchemy permet (journal, archive, API NFT). N'affiche jamais la clé.
import { readFileSync } from 'node:fs'

const cle = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  .split(/\r?\n/)
  .find((l) => l.startsWith('VITE_ALCHEMY_KEY='))!
  .slice('VITE_ALCHEMY_KEY='.length)
  .trim()
const masquer = (s: string) => s.split(cle).join('***')
const ETH = `https://eth-mainnet.g.alchemy.com/v2/${cle}`
const BASE = `https://base-mainnet.g.alchemy.com/v2/${cle}`

async function rpc(url: string, method: string, params: unknown[]) {
  const t = Date.now()
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
    const texte = await r.text()
    let corps: { result?: unknown; error?: { message?: string; code?: number } } = {}
    try {
      corps = JSON.parse(texte)
    } catch {
      return { ok: false, detail: masquer(`HTTP ${r.status} ${texte.slice(0, 120)}`), ms: Date.now() - t, result: undefined as unknown }
    }
    if (corps.error) return { ok: false, detail: masquer(`HTTP ${r.status} ${corps.error.code} ${corps.error.message}`.slice(0, 220)), ms: Date.now() - t, result: undefined }
    return { ok: true, detail: `HTTP ${r.status}`, ms: Date.now() - t, result: corps.result }
  } catch (e) {
    return { ok: false, detail: masquer(String(e)).slice(0, 160), ms: Date.now() - t, result: undefined }
  }
}

const hex = (n: bigint | number) => '0x' + BigInt(n).toString(16)
const mot = (n: bigint) => '0x' + n.toString(16).padStart(64, '0')
const T_AJOUT = '0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f'
const T_RETRAIT = '0x26f6a048ee9138f2c0ce266f322cb99228e8d619ae2bff30c67f8dcf9d2377b4'
const T_COLLECT = '0x40d0efd1a53d60ecbf40971b9daf7dc90178c3aadc7aab1765632738fa8b8f01'
const T_TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const UNI_V3 = '0xC36442b4a4522E871399CD717aBDD847Ab11FE88'
const UNI_V4 = '0xbd216513D74C8cf14cf4747E6AaA6420FF64Ee9e'
const AERO_1 = '0x827922686190790b37229fd06084350E74485b72'

console.log('== 1. La clé répond')
const sommets: Record<string, bigint> = {}
for (const [nom, url] of [['Ethereum', ETH], ['Base', BASE]] as const) {
  const r = await rpc(url, 'eth_blockNumber', [])
  console.log(`  ${nom} : ${r.ok ? 'OK bloc ' + BigInt(r.result as string) : 'KO ' + r.detail} (${r.ms} ms)`)
  if (r.ok) sommets[nom] = BigInt(r.result as string)
}

console.log('\n== 2. Lecture du passé (archive)')
for (const [nom, url, adresse, bloc] of [['Ethereum 2022', ETH, UNI_V3, 15_000_000n], ['Base 2024', BASE, AERO_1, 14_000_000n]] as const) {
  const r = await rpc(url, 'eth_call', [{ to: adresse, data: '0x18160ddd' }, hex(bloc)])
  console.log(`  ${nom} : ${r.ok ? 'OK' : 'KO ' + r.detail} (${r.ms} ms)`)
}

console.log("\n== 3. Journal d'UNE position, filtré par tokenId (3 types d'événements en une requête)")
for (const [nom, url, adresse, id, creation] of [
  ['Ethereum #1354578', ETH, UNI_V3, 1354578n, 12_369_651n],
  ['Base #76715356', BASE, AERO_1, 76715356n, 13_843_719n],
] as const) {
  const sommet = sommets[nom.split(' ')[0]]
  for (const [etiquette, depuis] of [["tout l'historique", creation], ['1 000 000 blocs', sommet - 1_000_000n], ['100 000 blocs', sommet - 100_000n], ['10 000 blocs', sommet - 10_000n], ['2 000 blocs', sommet - 2_000n], ['500 blocs', sommet - 500n], ['10 blocs', sommet - 10n]] as const) {
    const r = await rpc(url, 'eth_getLogs', [{ address: adresse, topics: [[T_AJOUT, T_RETRAIT, T_COLLECT], mot(id)], fromBlock: hex(depuis > creation ? depuis : creation), toBlock: hex(sommet) }])
    const logs = (r.result as { blockTimestamp?: string }[]) ?? []
    console.log(`  ${nom}, ${etiquette} : ${r.ok ? `ACCEPTÉ, ${logs.length} événements${logs[0]?.blockTimestamp ? ' (avec blockTimestamp)' : ''}` : 'refusé ' + r.detail} (${r.ms} ms)`)
    if (r.ok) break
  }
}

console.log('\n== 4. Journal large sans filtre de position (pour connaître le plafond de réponse)')
for (const [etiquette, largeur] of [['2 000 blocs', 2_000n], ['20 000 blocs', 20_000n], ['200 000 blocs', 200_000n]] as const) {
  const r = await rpc(ETH, 'eth_getLogs', [{ address: UNI_V3, topics: [T_COLLECT], fromBlock: hex(sommets.Ethereum - largeur), toBlock: hex(sommets.Ethereum) }])
  console.log(`  Ethereum, Collect sur ${etiquette} : ${r.ok ? `ACCEPTÉ, ${(r.result as unknown[]).length} événements` : 'refusé ' + r.detail} (${r.ms} ms)`)
}

console.log('\n== 5. Transferts d\'un NFT (stake / unstake) sur toute la vie du contrat, filtré par tokenId')
{
  const r = await rpc(BASE, 'eth_getLogs', [{ address: AERO_1, topics: [T_TRANSFER, null, null, mot(76715356n)], fromBlock: hex(13_843_719n), toBlock: hex(sommets.Base) }])
  console.log(`  Base #76715356 : ${r.ok ? `ACCEPTÉ, ${(r.result as unknown[]).length} transferts` : 'refusé ' + r.detail} (${r.ms} ms)`)
}

console.log('\n== 6. API NFT : positions Uniswap v4 d\'un wallet (contrat non énumérable)')
{
  const suivant = await rpc(ETH, 'eth_call', [{ to: UNI_V4, data: '0x75794a3c' }, 'latest'])
  const dernier = BigInt(suivant.result as string) - 1n
  const proprio = await rpc(ETH, 'eth_call', [{ to: UNI_V4, data: '0x6352211e' + dernier.toString(16).padStart(64, '0') }, 'latest'])
  const wallet = '0x' + (proprio.result as string).slice(26)
  const solde = await rpc(ETH, 'eth_call', [{ to: UNI_V4, data: '0x70a08231' + wallet.slice(2).padStart(64, '0') }, 'latest'])
  const t = Date.now()
  const r = await fetch(`https://eth-mainnet.g.alchemy.com/nft/v3/${cle}/getNFTsForOwner?owner=${wallet}&contractAddresses[]=${UNI_V4}&withMetadata=false&pageSize=100`)
  const texte = await r.text()
  let resume = masquer(`HTTP ${r.status} ${texte.slice(0, 160)}`)
  try {
    const corps = JSON.parse(texte) as { ownedNfts?: unknown[]; totalCount?: number }
    if (corps.ownedNfts) resume = `OK, ${corps.ownedNfts.length} NFT listés (totalCount ${corps.totalCount})`
  } catch {}
  console.log(`  wallet ${wallet.slice(0, 6)}… : balanceOf on-chain = ${BigInt(solde.result as string)} | API NFT : ${resume} (${Date.now() - t} ms)`)
}

console.log('\n== 7. Débit : 25 lectures lancées en même temps')
{
  const t = Date.now()
  const rs = await Promise.all(Array.from({ length: 25 }, (_, i) => rpc(ETH, 'eth_call', [{ to: UNI_V3, data: '0x18160ddd' }, hex(sommets.Ethereum - BigInt(i * 1000))])))
  const refus = rs.filter((r) => !r.ok)
  console.log(`  ${rs.length - refus.length}/25 acceptées en ${Date.now() - t} ms${refus.length ? ' ; refus : ' + refus[0].detail : ''}`)
}
