// Mise en forme à la française, partagée par la page et les outils.

import { estStable } from '../moteur/jetons'

export { estStable }

const fr = (min: number, max: number) =>
  new Intl.NumberFormat('fr-FR', { minimumFractionDigits: min, maximumFractionDigits: max })

export function dollars(v: number | null, signe = false): string {
  if (v === null || !Number.isFinite(v)) return '—'
  const s = v < 0 ? '−' : signe && v > 0 ? '+' : ''
  return `${s}${fr(2, 2).format(Math.abs(v))} $`
}

/** Quantité ou prix : assez de chiffres pour être utile, jamais une bouillie de décimales. */
export function nombre(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  if (abs === 0) return '0'
  if (abs >= 1000) return fr(0, 0).format(v)
  if (abs >= 1) return fr(0, 4).format(v)
  const decimales = Math.min(12, Math.max(4, -Math.floor(Math.log10(abs)) + 3))
  return fr(0, decimales).format(v)
}

export function pourcent(v: number | null, signe = false): string {
  if (v === null || !Number.isFinite(v)) return '—'
  const s = v < 0 ? '−' : signe && v > 0 ? '+' : ''
  return `${s}${fr(1, 1).format(Math.abs(v))} %`
}

/** Dollars fins : sous un dollar, deux décimales cachent tout — le gas d'un rollup, un jeton à 0,0001 $. */
export function dollarsFins(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—'
  if (v === 0 || Math.abs(v) >= 1) return dollars(v)
  const decimales = Math.min(8, Math.max(4, -Math.floor(Math.log10(Math.abs(v))) + 3))
  return `${v < 0 ? '−' : ''}${fr(2, decimales).format(Math.abs(v))} $`
}

/** Taux fin : les frais d'un pool ou une part de liquidité se jouent sous le dixième de pourcent. */
export function taux(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—'
  return `${fr(0, Math.abs(v) >= 1 ? 2 : 4).format(v)} %`
}

export function date(horodatage: number): string {
  return new Date(horodatage * 1000).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export const secondes = (s: number): string => `${fr(1, 1).format(s)} s`

export function duree(jours: number | null): string {
  if (jours === null) return '—'
  if (jours < 1) return `${Math.max(1, Math.round(jours * 24))} h`
  return `${fr(0, 1).format(jours)} jour${jours >= 2 ? 's' : ''}`
}

export function dateHeure(horodatage: number): string {
  return new Date(horodatage * 1000).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Sens naturel d'affichage d'un prix : l'actif volatil exprimé dans le stable
 * (1 WETH = 2 900 USDC plutôt que 1 USDC = 0,000345 WETH).
 */
export function sens(symbole0: string, symbole1: string) {
  const inverse = estStable(symbole0) && !estStable(symbole1)
  return {
    inverse,
    base: inverse ? symbole1 : symbole0,
    cotation: inverse ? symbole0 : symbole1,
    /** Convertit un prix « jeton0 en jeton1 » dans le sens d'affichage. */
    prix: (p: number) => (inverse ? 1 / p : p),
  }
}
