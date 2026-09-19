import type { Address } from 'viem'
import { CHAINES } from './chaines'
import type { IdChaine } from './types'

// Seule dépendance hors chaîne : la conversion en dollars (DefiLlama, gratuit, sans clé).
// Les quantités, les fees, les AERO et les prix de break-even n'en dépendent pas.

export type Prix = Map<string, number>

export const cleDePrix = (chaine: IdChaine, adresse: Address): string => `${CHAINES[chaine].llama}:${adresse.toLowerCase()}`

/** Le jeton qui paie le gas : de l'ETH sur les trois chaînes (Base et Robinhood sont des rollups Ethereum). */
export const CLE_GAZ = 'coingecko:ethereum'

async function interroger(chemin: string, cles: string[]): Promise<Prix> {
  const prix: Prix = new Map()
  const uniques = [...new Set(cles)]
  for (let i = 0; i < uniques.length; i += 50) {
    const reponse = await fetch(`https://coins.llama.fi/prices/${chemin}/${uniques.slice(i, i + 50).join(',')}`)
    if (!reponse.ok) throw new Error(`DefiLlama : HTTP ${reponse.status}`)
    const corps = (await reponse.json()) as { coins: Record<string, { price: number }> }
    for (const [cle, info] of Object.entries(corps.coins)) prix.set(cle.toLowerCase(), info.price)
  }
  return prix
}

export const prixActuels = (cles: string[]): Promise<Prix> => interroger('current', cles)

export const prixHistoriques = (horodatage: number, cles: string[]): Promise<Prix> =>
  interroger(`historical/${horodatage}`, cles)

/** Écart maximal toléré entre la date demandée et la cotation trouvée. */
const FENETRE = 3_600

/**
 * Prix de plusieurs jetons à plusieurs dates, groupés (DefiLlama batchHistorical) :
 * une requête par paquet de 40 dates au lieu d'une par date.
 */
export async function prixHistoriquesGroupes(cles: string[], horodatages: number[]): Promise<Map<number, Prix>> {
  const resultat = new Map<number, Prix>()
  const dates = [...new Set(horodatages)].sort((a, b) => a - b)
  const jetons = [...new Set(cles)]
  for (let i = 0; i < dates.length; i += 40) {
    const paquet = dates.slice(i, i + 40)
    const demande = Object.fromEntries(jetons.map((cle) => [cle, paquet]))
    const reponse = await fetch(
      `https://coins.llama.fi/batchHistorical?coins=${encodeURIComponent(JSON.stringify(demande))}&searchWidth=${FENETRE}`,
    )
    if (!reponse.ok) throw new Error(`DefiLlama : HTTP ${reponse.status}`)
    const corps = (await reponse.json()) as { coins: Record<string, { prices: { timestamp: number; price: number }[] }> }
    for (const [cle, info] of Object.entries(corps.coins)) {
      for (const date of paquet) {
        let proche: { timestamp: number; price: number } | undefined
        for (const cote of info.prices) {
          if (!proche || Math.abs(cote.timestamp - date) < Math.abs(proche.timestamp - date)) proche = cote
        }
        if (!proche || Math.abs(proche.timestamp - date) > FENETRE) continue
        if (!resultat.has(date)) resultat.set(date, new Map())
        resultat.get(date)!.set(cle.toLowerCase(), proche.price)
      }
    }
  }
  return resultat
}
