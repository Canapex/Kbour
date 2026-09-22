// Export des positions affichées en classeur Excel (.xlsx), construit dans le navigateur :
// chaque feuille est écrite en XML (format Office Open XML), puis le tout est zippé.
// Excel, LibreOffice, OpenOffice, Numbers et Google Sheets le lisent. Rien ne part vers un serveur.

import { strToU8, zipSync } from 'fflate'
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
  /** Largeur en caractères ; sinon celle du titre. */
  largeur?: number
  valeur: (x: T) => Valeur
}

/** Caractères admis par XML 1.0 : tabulation, retours à la ligne, et tout le reste hors contrôles et substituts isolés. */
const permis = (c: string): boolean => {
  const n = c.codePointAt(0)!
  return n === 0x9 || n === 0xa || n === 0xd || (n >= 0x20 && n <= 0xd7ff) || (n >= 0xe000 && n <= 0xfffd) || n >= 0x10000
}
const ENTITES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }
// Les symboles de jetons viennent de la chaîne : n'importe qui peut en créer un qui casserait le XML.
const echapper = (t: string): string => [...t].filter(permis).join('').replace(/[&<>"']/g, (c) => ENTITES[c])

// Index des styles dans styles.xml : 0 normal, 1 en-tête, 2 dollars, 3 pourcentages, 4 dates.
const STYLE = { titre: 1, usd: 2, pct: 3, date: 4 } as const

/** Date Excel : jours écoulés depuis le 30/12/1899, à l'heure locale — celle que la page affiche. */
function dateExcel(d: Date): number {
  const localeCommeUtc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds())
  return localeCommeUtc / 86_400_000 + 25_569
}

const date = (horodatage: number | null | undefined): Date | null => (horodatage ? new Date(horodatage * 1000) : null)

/** Colonnes A, B, …, Z, AA, AB… */
function lettre(colonne: number): string {
  let n = colonne + 1
  let s = ''
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** Jamais de notation scientifique (1.2e-7), et 15 chiffres significatifs comme String(). */
function nombre(v: number): string {
  if (v === 0 || Math.abs(v) >= 1e-6) return String(v)
  const texte = v.toFixed(Math.min(100, 14 - Math.floor(Math.log10(Math.abs(v)))))
  let fin = texte.length
  while (texte[fin - 1] === '0') fin--
  return texte.slice(0, fin)
}

function cellule(ref: string, v: Valeur, style?: number): string {
  if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return ''
  if (v instanceof Date) return `<c r="${ref}" s="${STYLE.date}"><v>${dateExcel(v)}</v></c>`
  const s = style ? ` s="${style}"` : ''
  if (typeof v === 'number') return `<c r="${ref}"${s}><v>${nombre(v)}</v></c>`
  return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${echapper(v)}</t></is></c>`
}

function feuille<T>(colonnes: Colonne<T>[], lignes: T[]): string {
  const format = (c: Colonne<T>, l: T) => (typeof c.style === 'function' ? c.style(l) : c.style)
  const entete = colonnes.map((c, j) => cellule(`${lettre(j)}1`, c.titre, STYLE.titre)).join('')
  const corps = lignes
    .map((l, i) => {
      const r = i + 2
      const cellules = colonnes.map((c, j) => {
        const st = format(c, l)
        return cellule(`${lettre(j)}${r}`, c.valeur(l), st ? STYLE[st] : undefined)
      })
      return `<row r="${r}">${cellules.join('')}</row>`
    })
    .join('')
  const largeurs = colonnes
    .map((c, j) => `<col min="${j + 1}" max="${j + 1}" width="${c.largeur ?? Math.min(40, Math.max(11, c.titre.length + 3))}" customWidth="1"/>`)
    .join('')
  // La première ligne reste figée quand on fait défiler.
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${largeurs}</cols>` +
    `<sheetData><row r="1">${entete}</row>${corps}</sheetData>` +
    '</worksheet>'
  )
}

// Colonnes communes à toutes les feuilles : de quelle position parle la ligne.
const protocole = (a: Analyse) => (a.etat.ref.protocole === 'aerodrome' ? 'Aerodrome' : 'Uniswap v3')
function identite<T>(position: (x: T) => Analyse): Colonne<T>[] {
  return [
    { titre: 'Chaîne', largeur: 16, valeur: (x) => CHAINES[position(x).etat.ref.chaine].nom },
    { titre: 'Protocole', largeur: 13, valeur: (x) => protocole(position(x)) },
    { titre: 'N°', largeur: 11, valeur: (x) => position(x).etat.ref.id.toString() },
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
  { titre: 'Statut', largeur: 18, valeur: ({ a }) => (a.fermee ? 'Fermée' : a.etat.dansLaFourchette ? 'Dans la fourchette' : 'Hors fourchette') },
  { titre: 'Stakée', valeur: ({ a }) => (a.etat.ref.gauge ? 'oui' : 'non') },
  { titre: 'Ouverte le', largeur: 17, valeur: ({ a }) => date(a.historique?.ouverture.horodatage) },
  { titre: 'Fermée le', largeur: 17, valeur: ({ a }) => (a.fermee ? date(a.cloture?.horodatage) : null) },
  { titre: 'Jours de vie', valeur: ({ a }) => a.jours },
  { titre: 'Unité de prix', largeur: 16, valeur: ({ a }) => unite(a) },
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
  { titre: 'Contrat du pool', largeur: 44, valeur: ({ a }) => a.etat.pool },
]

type LigneMouvement = { a: Analyse; i: number }
const COLONNES_MOUVEMENTS: Colonne<LigneMouvement>[] = [
  ...identite<LigneMouvement>((x) => x.a),
  { titre: 'Date', largeur: 17, valeur: ({ a, i }) => date(a.mouvementsUsd[i].horodatage) },
  { titre: 'Mouvement', valeur: ({ a, i }) => (a.mouvementsUsd[i].type === 'depot' ? 'Dépôt' : 'Retrait') },
  { titre: 'Quantité jeton 0', valeur: ({ a, i }) => a.mouvementsUsd[i].quantite0 },
  { titre: 'Quantité jeton 1', valeur: ({ a, i }) => a.mouvementsUsd[i].quantite1 },
  { titre: 'Prix du pool', valeur: ({ a, i }) => prixLu(a, a.historique!.mouvements[i].prix) },
  { titre: 'Unité de prix', largeur: 16, valeur: ({ a }) => unite(a) },
  { titre: 'Prix jeton 0 ($)', valeur: ({ a, i }) => a.mouvementsUsd[i].usd0 },
  { titre: 'Prix jeton 1 ($)', valeur: ({ a, i }) => a.mouvementsUsd[i].usd1 },
  { titre: 'Valeur à la date ($)', style: 'usd', valeur: ({ a, i }) => a.mouvementsUsd[i].usd },
]

type LigneFees = { a: Analyse; r: Analyse['retraitsDeFees'][number] }
const COLONNES_FEES: Colonne<LigneFees>[] = [
  ...identite<LigneFees>((x) => x.a),
  { titre: 'Date', largeur: 17, valeur: ({ r }) => date(r.horodatage) },
  { titre: 'Fees jeton 0', valeur: ({ r }) => r.fees0 },
  { titre: 'Fees jeton 1', valeur: ({ r }) => r.fees1 },
  { titre: 'Valeur à la date ($)', style: 'usd', valeur: ({ r }) => r.usd },
  { titre: 'Valorisé au prix du jour (pas de cotation à la date)', largeur: 22, valeur: ({ r }) => (r.prixDuJour ? 'oui' : 'non') },
]

type LigneStake = { a: Analyse; p: NonNullable<Analyse['historique']>['periodesStakees'][number] }
const COLONNES_STAKE: Colonne<LigneStake>[] = [
  ...identite<LigneStake>((x) => x.a),
  { titre: 'Stakée le', largeur: 17, valeur: ({ p }) => date(p.debut) },
  { titre: 'Retirée du gauge le', largeur: 17, valeur: ({ p }) => date(p.fin) },
  { titre: 'AERO gagnés', valeur: ({ p }) => lisible(p.aero, 18) },
  { titre: 'Gauge', largeur: 44, valeur: ({ p }) => p.gauge },
]

const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="0.00"/>' +
  '<numFmt numFmtId="166" formatCode="dd/mm/yyyy hh:mm"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFEDE3FF"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="5">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>'

const TYPE_FEUILLE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'
const RELATION = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const RELATIONS_PAQUET = 'http://schemas.openxmlformats.org/package/2006/relationships'

/** Le classeur complet, zippé : un résumé, puis une feuille par table. */
export function classeurXlsx(analyses: Analyse[], wallet: Address, fermeesNonChargees: number): Uint8Array {
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
  const feuilles: [string, string][] = [
    [
      'Résumé',
      feuille<[string, Valeur, Style?]>(
        [
          { titre: 'Élément', largeur: 66, valeur: (x) => x[0] },
          { titre: 'Valeur', largeur: 46, style: (x) => x[2], valeur: (x) => x[1] },
        ],
        resume,
      ),
    ],
    ['Positions', feuille(COLONNES_POSITIONS, lignes)],
    ['Mouvements', feuille(COLONNES_MOUVEMENTS, analyses.flatMap((a) => a.mouvementsUsd.map((_, i) => ({ a, i }))))],
    ['Retraits de fees', feuille(COLONNES_FEES, analyses.flatMap((a) => a.retraitsDeFees.map((r) => ({ a, r }))))],
    [
      'Périodes stakées',
      feuille(COLONNES_STAKE, analyses.flatMap((a) => (a.historique?.periodesStakees ?? []).map((p) => ({ a, p })))),
    ],
  ]

  const typesDeContenu =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    feuilles.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${TYPE_FEUILLE}"/>`).join('') +
    '</Types>'
  const relationsRacine =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<Relationships xmlns="${RELATIONS_PAQUET}">` +
    `<Relationship Id="rId1" Type="${RELATION}/officeDocument" Target="xl/workbook.xml"/>` +
    '</Relationships>'
  const classeur =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${RELATION}"><sheets>` +
    feuilles.map(([nom], i) => `<sheet name="${echapper(nom)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
    '</sheets></workbook>'
  const relationsClasseur =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<Relationships xmlns="${RELATIONS_PAQUET}">` +
    feuilles.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${RELATION}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    `<Relationship Id="rId${feuilles.length + 1}" Type="${RELATION}/styles" Target="styles.xml"/>` +
    '</Relationships>'

  const parties: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(typesDeContenu),
    '_rels/.rels': strToU8(relationsRacine),
    'xl/workbook.xml': strToU8(classeur),
    'xl/_rels/workbook.xml.rels': strToU8(relationsClasseur),
    'xl/styles.xml': strToU8(STYLES),
  }
  feuilles.forEach(([, xml], i) => {
    parties[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(xml)
  })
  return zipSync(parties, { level: 6 })
}

/** kbour-0x2996-283B-2026-09-22.xlsx : le wallet en abrégé, la date du jour. */
export function nomDuFichier(wallet: Address): string {
  const d = new Date()
  const jour = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return `kbour-${wallet.slice(0, 6)}-${wallet.slice(-4)}-${jour}.xlsx`
}
