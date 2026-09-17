// Mesure Robinhood Chain : Alchemy, contrats Uniswap, numéro de bloc, positions du wallet. N'affiche jamais la clé.
// Usage : npx tsx outils/sonde-robinhood.ts 0xWallet
import { readFileSync } from 'node:fs'

const cle = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  .split(/\r?\n/)
  .find((l) => l.startsWith('VITE_ALCHEMY_KEY='))!
  .slice('VITE_ALCHEMY_KEY='.length)
  .trim()
const masquer = (s: string) => s.split(cle).join('***')
const wallet = (process.argv[2] ?? '').toLowerCase()
const ALCHEMY_REEL = `https://robinhood-mainnet.g.alchemy.com/v2/${cle}`
const ALCHEMY = process.env.SONDE_PUBLIC ? "https://rpc.mainnet.chain.robinhood.com" : ALCHEMY_REEL
const PUBLIC = 'https://rpc.mainnet.chain.robinhood.com'

const C = {
  multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
  v3Factory: '0x1f7d7550b1b028f7571e69a784071f0205fd2efa',
  v3Npm: '0x73991a25c818bf1f1128deaab1492d45638de0d3',
  v4PoolManager: '0x8366a39cc670b4001a1121b8f6a443a643e40951',
  v4PositionManager: '0x58daec3116aae6d93017baaea7749052e8a04fa7',
  v4StateView: '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b',
}

async function rpc(url: string, method: string, params: unknown[]) {
  const t = Date.now()
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
    const texte = await r.text()
    try {
      const corps = JSON.parse(texte) as { result?: any; error?: { code?: number; message?: string } }
      if (corps.error) return { ok: false as const, detail: masquer(`${corps.error.code} ${corps.error.message}`).slice(0, 200), ms: Date.now() - t }
      return { ok: true as const, result: corps.result, ms: Date.now() - t }
    } catch {
      return { ok: false as const, detail: masquer(`HTTP ${r.status} ${texte.slice(0, 120)}`), ms: Date.now() - t }
    }
  } catch (e) {
    return { ok: false as const, detail: masquer(String(e)).slice(0, 160), ms: Date.now() - t }
  }
}
const appel = (url: string, to: string, data: string, bloc = 'latest') => rpc(url, 'eth_call', [{ to, data }, bloc])
const mot = (x: string | bigint) => (typeof x === 'bigint' ? x.toString(16) : x.replace(/^0x/, '')).padStart(64, '0')
const lireTexte = (hex: string) => {
  const h = hex.slice(2)
  const lon = parseInt(h.slice(64, 128), 16)
  return Buffer.from(h.slice(128, 128 + lon * 2), 'hex').toString('utf8')
}

console.log('== 1. Accès au réseau')
for (const [nom, url] of [['Alchemy', ALCHEMY], ['RPC public Robinhood', PUBLIC]] as const) {
  const id = await rpc(url, 'eth_chainId', [])
  const bloc = await rpc(url, 'eth_blockNumber', [])
  console.log(`  ${nom} : chainId ${id.ok ? parseInt(id.result, 16) : 'KO ' + id.detail} | bloc ${bloc.ok ? BigInt(bloc.result) : 'KO ' + bloc.detail} (${bloc.ms} ms)`)
}

console.log('\n== 2. Les contrats de la doc Uniswap existent-ils ?')
for (const [nom, adresse] of Object.entries(C)) {
  const code = await rpc(ALCHEMY, 'eth_getCode', [adresse, 'latest'])
  console.log(`  ${nom.padEnd(18)} ${adresse} : ${code.ok ? (code.result.length > 2 ? `code présent (${(code.result.length - 2) / 2} octets)` : 'AUCUN CODE') : 'KO ' + code.detail}`)
}
const nom = await appel(ALCHEMY, C.v3Npm, '0x06fdde03')
const usine = await appel(ALCHEMY, C.v3Npm, '0xc45a0155')
console.log(`  NFT v3 : nom « ${nom.ok ? lireTexte(nom.result) : '?'} », factory() = 0x${usine.ok ? usine.result.slice(26) : '?'} ${usine.ok && usine.result.slice(26) === C.v3Factory.slice(2) ? '(= doc)' : ''}`)

console.log('\n== 3. Numéro de bloc vu par un contrat (piège Arbitrum)')
{
  const rpcBloc = await rpc(ALCHEMY, 'eth_blockNumber', [])
  const contratBloc = await appel(ALCHEMY, C.multicall3, '0x42cbb15c') // getBlockNumber()
  const heure = await appel(ALCHEMY, C.multicall3, '0x0f28c97d') // getCurrentBlockTimestamp()
  console.log(`  eth_blockNumber = ${rpcBloc.ok ? BigInt(rpcBloc.result) : '?'} | Multicall3.getBlockNumber() = ${contratBloc.ok ? BigInt(contratBloc.result) : 'KO ' + contratBloc.detail} | horodatage ${heure.ok ? new Date(Number(BigInt(heure.result)) * 1000).toISOString() : '?'}`)
}

if (wallet) {
  console.log('\n== 4. Positions du wallet sur Robinhood Chain')
  const v3 = await appel(ALCHEMY, C.v3Npm, '0x70a08231' + mot(wallet))
  const v4 = await appel(ALCHEMY, C.v4PositionManager, '0x70a08231' + mot(wallet))
  const n3 = v3.ok ? BigInt(v3.result) : -1n
  const n4 = v4.ok ? BigInt(v4.result) : -1n
  console.log(`  Uniswap v3 : ${n3} NFT | Uniswap v4 : ${n4} NFT`)
  for (let i = 0n; i < n3 && i < 20n; i++) {
    const id = await appel(ALCHEMY, C.v3Npm, '0x2f745c59' + mot(wallet) + mot(i))
    const tokenId = BigInt(id.result)
    const p = await appel(ALCHEMY, C.v3Npm, '0x99fbab88' + mot(tokenId))
    const h = p.result.slice(2)
    const liq = BigInt('0x' + h.slice(64 * 7, 64 * 8))
    console.log(`    v3 #${tokenId} : jetons 0x${h.slice(64 * 2 + 24, 64 * 3)} / 0x${h.slice(64 * 3 + 24, 64 * 4)} | fee ${parseInt(h.slice(64 * 4, 64 * 5), 16)} | liquidité ${liq > 0n ? 'OUVERTE' : 'vide'}`)
  }
  if (n4 > 0n) {
    const t = Date.now()
    const r = await fetch(`https://robinhood-mainnet.g.alchemy.com/nft/v3/${cle}/getNFTsForOwner?owner=${wallet}&contractAddresses[]=${C.v4PositionManager}&withMetadata=false&pageSize=100`)
    const texte = await r.text()
    let resume = masquer(`HTTP ${r.status} ${texte.slice(0, 160)}`)
    try {
      const corps = JSON.parse(texte) as { ownedNfts?: { tokenId: string }[] }
      if (corps.ownedNfts) resume = `OK : ${corps.ownedNfts.map((n) => '#' + n.tokenId).join(', ')}`
    } catch {}
    console.log(`  API NFT Alchemy (v4) : ${resume} (${Date.now() - t} ms)`)
  }
}

console.log('\n== 5. Journal : plage complète acceptée ? horodatages joints ?')
{
  const bloc = await rpc(ALCHEMY, 'eth_blockNumber', [])
  const sommet = BigInt(bloc.result)
  const r = await rpc(ALCHEMY, 'eth_getLogs', [{ address: C.v3Npm, topics: ['0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f', '0x' + mot(1n)], fromBlock: '0x0', toBlock: '0x' + sommet.toString(16) }])
  console.log(`  dépôts de la position v3 #1 depuis le bloc 0 : ${r.ok ? `ACCEPTÉ, ${r.result.length} événement(s)${r.result[0]?.blockTimestamp ? ', avec blockTimestamp' : ', SANS blockTimestamp'}` : 'refusé ' + r.detail} (${r.ms} ms)`)
}

console.log('\n== 6. Prix DefiLlama sur cette chaîne')
{
  const r = await fetch('https://api.llama.fi/v2/chains')
  const chaines = (await r.json()) as { name: string; chainId: number | null }[]
  const trouvee = chaines.find((c) => c.chainId === 4663 || /robinhood/i.test(c.name))
  console.log(`  chaîne DefiLlama : ${trouvee ? `« ${trouvee.name} » (chainId ${trouvee.chainId})` : 'introuvable'}`)
}
