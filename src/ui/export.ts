// Export des positions affichées en un classeur XML au format « XML Spreadsheet 2003 » :
// un vrai fichier XML, qu'Excel et LibreOffice ouvrent directement, une feuille par table.
// Tout est construit dans le navigateur : rien ne part vers un serveur.

import type { Address } from 'viem'
import type { Analyse } from '../moteur/analyse'
import { metriquesAvancees, type Avance } from '../moteur/avance'
import { CHAINES } from '../moteur/chaines'
import { lisible } from '../moteur/maths'
import { sens } from './format'

type Valeur = string | number | Date | null | undefined
type Style = 'usd' | 'pct'
interface Colonne<T> {
  titre: string
  /** Format d'affichage des nombres : fixe pour la colonne, ou choisi ligne par ligne. */
  style?: Style | ((x: T) => Style | undefined)
  valeur: (x: T) => Valeur
}

// Les symboles de jetons viennent de la chaîne : n'importe qui peut en créer un qui casserait le XML
// (caractères de contrôle interdits, chevrons, esperluettes).
/** Caractères admis par XML 1.0 : tabulation, retours à la ligne, et tout le reste hors contrôles et substituts isolés. */
const permis = (c: string): boolean => {
  const n = c.codePointAt(0)!
  return n === 0x9 || n === 0xa || n === 0xd || (n >= 0x20 && n <= 0xd7ff) || (n >= 0xe000 && n <= 0xfffd) || n >= 0x10000
}
const ENTITES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }
const echapper = (t: string): string => [...t].filter(permis).join('').replace(/[&<>"']/g, (c) => ENTITES[c])

/** Le format attend une heure locale, sans fuseau : celle que la page affiche. */
function dateLocale(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.000`
}

const date = (horodatage: number | null | undefined): Date | null => (horodatage ? new Date(horodatage * 1000) : null)

/** Jamais de notation scientifique (1.2e-7), et 15 chiffres significatifs comme String() : les très petites quantités s'écrivent en entier. */
function nombre(v: number): string {
  if (v === 0 || Math.abs(v) >= 1e-6) return String(v)
  const texte = v.toFixed(Math.min(100, 14 - Math.floor(Math.log10(Math.abs(v)))))
  let fin = texte.length
  while (texte[fin - 1] === '0') fin--
  return texte.slice(0, fin)
}

function cellule(v: Valeur, style?: Style): string {
  if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return '<Cell/>'
  if (v instanceof Date) return `<Cell ss:StyleID="date"><Data ss:Type="DateTime">${dateLocale(v)}</Data></Cell>`
  if (typeof v === 'number') return `<Cell${style ? ` ss:StyleID="${style}"` : ''}><Data ss:Type="Number">${nombre(v)}</Data></Cell>`
  return `<Cell><Data ss:Type="String">${echapper(v)}</Data></Cell>`
}

function feuille<T>(nom: string, colonnes: Colonne<T>[], lignes: T[]): string {
  const entete = colonnes.map((c) => `<Cell ss:StyleID="titre"><Data ss:Type="String">${echapper(c.titre)}</Data></Cell>`).join('')
  const format = (c: Colonne<T>, l: T) => (typeof c.style === 'function' ? c.style(l) : c.style)
  const corps = lignes.map((l) => `<Row>${colonnes.map((c) => cellule(c.valeur(l), format(c, l))).join('')}</Row>`).join('\n')
  // La première ligne reste figée quand on fait défiler.
  return `<Worksheet ss:Name="${echapper(nom)}">
<Table>
<Row>${entete}</Row>
${corps}
</Table>
<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane><ActivePane>2</ActivePane></WorksheetOptions>
</Worksheet>`
}

// Colonnes communes à toutes les feuilles : de quelle position parle la ligne.
const protocole = (a: Analyse) => (a.etat.ref.protocole === 'aerodrome' ? 'Aerodrome' : 'Uniswap v3')
function identite<T>(position: (x: T) => Analyse): Colonne<T>[] {
  return [
    { titre: 'Chaîne', valeur: (x) => CHAINES[position(x).etat.ref.chaine].nom },
    { titre: 'Protocole', valeur: (x) => protocole(position(x)) },
    { titre: 'N°', valeur: (x) => position(x).etat.ref.id.toString() },
    { titre: 'Jeton 0', valeur: (x) => position(x).etat.jeton0.symbole },
    { titre: 'Jeton 1', valeur: (x) => position(x).etat.jeton1.symbole },
  ]
}

/** Prix « jeton0 en jeton1 » dans le sens de lecture de la page (1 WETH = … USDC). */
const prixLu = (a: Analyse, p: number) => sens(a.etat.jeton0.symbole, a.etat.jeton1.symbole).prix(p)
const unite = (a: Analyse) => {
  const s = sens(a.etat.jeton0.symbole, a.etat.jeton1.symbole)
  return `${s.cotation} par ${s.base}`
}

type Ligne = { a: Analyse; m: Avance }
const COLONNES_POSITIONS: Colonne<Ligne>[] = [
  ...identite<Ligne>((x) => x.a),
  { titre: 'Statut', valeur: ({ a }) => (a.fermee ? 'Fermée' : a.etat.dansLaFourchette ? 'Dans la fourchette' : 'Hors fourchette') },
  { titre: 'Stakée', valeur: ({ a }) => (a.etat.ref.gauge ? 'oui' : 'non') },
  { titre: 'Ouverte le', valeur: ({ a }) => date(a.historique?.ouverture.horodatage) },
  { titre: 'Fermée le', valeur: ({ a }) => (a.fermee ? date(a.cloture?.horodatage) : null) },
  { titre: 'Jours de vie', valeur: ({ a }) => a.jours },
  { titre: 'Unité de prix', valeur: ({ a }) => unite(a) },
  { titre: 'Borne basse', valeur: ({ a }) => Math.min(prixLu(a, a.etat.prixBas), prixLu(a, a.etat.prixHaut)) },
  { titre: 'Borne haute', valeur: ({ a }) => Math.max(prixLu(a, a.etat.prixBas), prixLu(a, a.etat.prixHaut)) },
  { titre: 'Prix du pool', valeur: ({ a }) => prixLu(a, a.etat.prix) },
  { titre: 'Largeur de fourchette (%)', style: 'pct', valeur: ({ m }) => m.largeurPourcent },
  { titre: 'Quantité jeton 0', valeur: ({ a }) => a.etat.quantite0 },
  { titre: 'Quantité jeton 1', valeur: ({ a }) => a.etat.quantite1 },
  { titre: 'Valeur actuelle ($)', style: 'usd', valeur: ({ a }) => a.valeurUsd },
  { titre: 'Montant investi ($)', style: 'usd', valeur: ({ a }) => a.investiUsd },
  { titre: 'Capital retiré ($)', style: 'usd', valeur: ({ a }) => (a.historique ? a.retireUsd : null) },
  { titre: 'Capital moyen engagé ($)', style: 'usd', valeur: ({ a }) => a.capitalMoyenUsd },
  { titre: 'Fees jeton 0', valeur: ({ a }) => (a.historique ? a.fees0 : null) },
  { titre: 'Fees jeton 1', valeur: ({ a }) => (a.historique ? a.fees1 : null) },
  { titre: 'AERO', valeur: ({ a }) => (a.aero > 0 ? a.aero : null) },
  { titre: 'Fees générées ($)', style: 'usd', valeur: ({ m }) => m.feesTotalUsd },
  { titre: 'Fees encaissées ($)', style: 'usd', valeur: ({ m }) => m.feesEncaisseesUsd },
  { titre: 'Fees en attente ($)', style: 'usd', valeur: ({ m }) => m.feesAttenteUsd },
  { titre: 'Gas ($)', valeur: ({ m }) => m.gazUsd },
  { titre: 'Transactions', valeur: ({ a }) => (a.historique ? a.transactions : null) },
  { titre: 'Résultat net ($)', style: 'usd', valeur: ({ m }) => m.pnlUsd },
  { titre: 'ROI (%)', style: 'pct', valeur: ({ m }) => m.roiPourcent },
  { titre: 'ROI annualisé (%)', style: 'pct', valeur: ({ m }) => m.roiAnnualisePourcent },
  { titre: 'Rendement annualisé des fees (%)', style: 'pct', valeur: ({ a }) => a.aprPourcent },
  { titre: 'Rythme récent (%/an)', style: 'pct', valeur: ({ m }) => m.aprRecentPourcent },
  { titre: 'Face au HODL ($)', style: 'usd', valeur: ({ m }) => m.ecartHodlUsd },
  { titre: 'Impermanent loss ($)', style: 'usd', valeur: ({ m }) => m.divergenceUsd },
  { titre: 'Rétention des fees (%)', style: 'pct', valeur: ({ m }) => m.retentionPourcent },
  { titre: 'Entrée moyenne jeton 0 ($)', valeur: ({ m }) => m.entree0 },
  { titre: 'Entrée moyenne jeton 1 ($)', valeur: ({ m }) => m.entree1 },
  { titre: 'Sortie moyenne jeton 0 ($)', valeur: ({ m }) => m.sortie0 },
  { titre: 'Sortie moyenne jeton 1 ($)', valeur: ({ m }) => m.sortie1 },
  { titre: "Prix jeton 0 aujourd'hui ($)", valeur: ({ a }) => a.usd0 },
  { titre: "Prix jeton 1 aujourd'hui ($)", valeur: ({ a }) => a.usd1 },
  { titre: 'Contrat du pool', valeur: ({ a }) => a.etat.pool },
]

type LigneMouvement = { a: Analyse; i: number }
const COLONNES_MOUVEMENTS: Colonne<LigneMouvement>[] = [
  ...identite<LigneMouvement>((x) => x.a),
  { titre: 'Date', valeur: ({ a, i }) => date(a.mouvementsUsd[i].horodatage) },
  { titre: 'Mouvement', valeur: ({ a, i }) => (a.mouvementsUsd[i].type === 'depot' ? 'Dépôt' : 'Retrait') },
  { titre: 'Quantité jeton 0', valeur: ({ a, i }) => a.mouvementsUsd[i].quantite0 },
  { titre: 'Quantité jeton 1', valeur: ({ a, i }) => a.mouvementsUsd[i].quantite1 },
  { titre: 'Prix du pool', valeur: ({ a, i }) => prixLu(a, a.historique!.mouvements[i].prix) },
  { titre: 'Unité de prix', valeur: ({ a }) => unite(a) },
  { titre: 'Prix jeton 0 ($)', valeur: ({ a, i }) => a.mouvementsUsd[i].usd0 },
  { titre: 'Prix jeton 1 ($)', valeur: ({ a, i }) => a.mouvementsUsd[i].usd1 },
  { titre: 'Valeur à la date ($)', style: 'usd', valeur: ({ a, i }) => a.mouvementsUsd[i].usd },
]

type LigneFees = { a: Analyse; r: Analyse['retraitsDeFees'][number] }
const COLONNES_FEES: Colonne<LigneFees>[] = [
  ...identite<LigneFees>((x) => x.a),
  { titre: 'Date', valeur: ({ r }) => date(r.horodatage) },
  { titre: 'Fees jeton 0', valeur: ({ r }) => r.fees0 },
  { titre: 'Fees jeton 1', valeur: ({ r }) => r.fees1 },
  { titre: 'Valeur à la date ($)', style: 'usd', valeur: ({ r }) => r.usd },
  { titre: 'Valorisé au prix du jour (pas de cotation à la date)', valeur: ({ r }) => (r.prixDuJour ? 'oui' : 'non') },
]

type LigneStake = { a: Analyse; p: NonNullable<Analyse['historique']>['periodesStakees'][number] }
const COLONNES_STAKE: Colonne<LigneStake>[] = [
  ...identite<LigneStake>((x) => x.a),
  { titre: 'Stakée le', valeur: ({ p }) => date(p.debut) },
  { titre: 'Retirée du gauge le', valeur: ({ p }) => date(p.fin) },
  { titre: 'AERO gagnés', valeur: ({ p }) => lisible(p.aero, 18) },
  { titre: 'Gauge', valeur: ({ p }) => p.gauge },
]

/** Le classeur complet : un résumé, puis une feuille par table. */
export function classeurXml(analyses: Analyse[], wallet: Address, fermeesNonChargees: number): string {
  const lignes = analyses.map((a) => ({ a, m: metriquesAvancees(a) }))
  const somme = (f: (l: Ligne) => number | null) =>
    lignes.reduce<number | null>((s, l) => {
      const v = f(l)
      return s === null || v === null ? null : s + v
    }, 0)
  const resume: [string, Valeur, Style?][] = [
    ['Wallet', wallet],
    ['Exporté le', new Date()],
    ['Positions ouvertes', analyses.filter((a) => !a.fermee).length],
    ['Positions fermées incluses', analyses.filter((a) => a.fermee).length],
    ['Positions fermées non chargées (à charger dans la page pour les inclure)', fermeesNonChargees],
    ['Valeur actuelle totale ($)', somme((l) => l.a.valeurUsd), 'usd'],
    ['Fees générées ($)', somme((l) => l.m.feesTotalUsd), 'usd'],
    ['Résultat net ($)', somme((l) => l.m.pnlUsd), 'usd'],
    ['Impermanent loss ($)', somme((l) => l.m.divergenceUsd), 'usd'],
    ['Gas ($)', somme((l) => l.m.gazUsd)],
    ['Source', 'Kbour : état et journal lus sur la chaîne, prix en dollars de DefiLlama à la date de chaque opération'],
  ]
  const feuilleResume = feuille<[string, Valeur, Style?]>(
    'Résumé',
    [
      { titre: 'Élément', valeur: (x) => x[0] },
      { titre: 'Valeur', style: (x) => x[2], valeur: (x) => x[1] },
    ],
    resume,
  )
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
<Style ss:ID="titre"><Font ss:Bold="1"/><Interior ss:Color="#EDE3FF" ss:Pattern="Solid"/></Style>
<Style ss:ID="date"><NumberFormat ss:Format="dd/mm/yyyy hh:mm"/></Style>
<Style ss:ID="usd"><NumberFormat ss:Format="#,##0.00"/></Style>
<Style ss:ID="pct"><NumberFormat ss:Format="0.00"/></Style>
</Styles>
${feuilleResume}
${feuille('Positions', COLONNES_POSITIONS, lignes)}
${feuille(
  'Mouvements',
  COLONNES_MOUVEMENTS,
  analyses.flatMap((a) => a.mouvementsUsd.map((_, i) => ({ a, i }))),
)}
${feuille(
  'Retraits de fees',
  COLONNES_FEES,
  analyses.flatMap((a) => a.retraitsDeFees.map((r) => ({ a, r }))),
)}
${feuille(
  'Périodes stakées',
  COLONNES_STAKE,
  analyses.flatMap((a) => (a.historique?.periodesStakees ?? []).map((p) => ({ a, p }))),
)}
</Workbook>
`
}

/** kbour-0x2996-283B-2026-09-22.xml : le wallet en abrégé, la date du jour. */
export function nomDuFichier(wallet: Address): string {
  const d = new Date()
  const jour = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return `kbour-${wallet.slice(0, 6)}-${wallet.slice(-4)}-${jour}.xml`
}
