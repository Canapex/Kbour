import type { Analyse } from '../moteur/analyse'
import { metriquesAvancees } from '../moteur/avance'
import { CHAINES } from '../moteur/chaines'
import { lisible } from '../moteur/maths'
import type { EtatPosition } from '../moteur/types'
import * as F from './format'
import { html, type Fragment } from './html'

function badges(e: EtatPosition, fermee: boolean): Fragment {
  const protocole = e.ref.protocole === 'aerodrome' ? 'Aerodrome' : 'Uniswap v3'
  return html`
    <span class="badge">${protocole} · ${CHAINES[e.ref.chaine].nom}</span>
    <span class="badge discret">#${e.ref.id.toString()}</span>
    ${e.ref.gauge ? html`<span class="badge accent">Stakée</span>` : ''}
    ${fermee
      ? html`<span class="badge discret">Fermée</span>`
      : html`<span class="badge ${e.dansLaFourchette ? 'vert' : 'rouge'}">${e.dansLaFourchette ? 'Dans la fourchette' : 'Hors fourchette'}</span>`}
  `
}

/** Barre de fourchette : bornes, prix actuel, distance aux bornes, en échelle logarithmique. */
function fourchette(e: EtatPosition): Fragment {
  const s = F.sens(e.jeton0.symbole, e.jeton1.symbole)
  const [bas, haut] = [s.prix(e.prixBas), s.prix(e.prixHaut)].sort((a, b) => a - b)
  const prix = s.prix(e.prix)
  const brut = (Math.log(prix) - Math.log(bas)) / (Math.log(haut) - Math.log(bas))
  const position = Math.min(1, Math.max(0, brut)) * 100
  const versBas = ((prix - bas) / prix) * 100
  const versHaut = ((haut - prix) / prix) * 100
  const alerte = (pct: number) => (pct < 0 ? 'rouge' : pct < 3 ? 'rouge' : pct < 8 ? 'jaune' : 'vert')
  return html`
    <div class="fourchette">
      <div class="prix-actuel">1 ${s.base} = <strong>${F.nombre(prix)}</strong> ${s.cotation}</div>
      <div class="barre" aria-hidden="true">
        <div class="barre-zone"></div>
        <div class="barre-curseur ${e.dansLaFourchette ? '' : 'dehors'}" style="left: ${position.toFixed(2)}%"></div>
      </div>
      <div class="bornes">
        <span>${F.nombre(bas)}<small class="${alerte(versBas)}">${e.dansLaFourchette ? `à ${F.pourcent(versBas)}` : ''}</small></span>
        <span>${F.nombre(haut)}<small class="${alerte(versHaut)}">${e.dansLaFourchette ? `à ${F.pourcent(versHaut)}` : ''}</small></span>
      </div>
    </div>
  `
}

function tuile(numero: number, titre: string, valeur: Fragment | string, detail: Fragment | string, classe = ''): Fragment {
  return html`
    <div class="tuile ${classe}">
      <div class="tuile-titre"><span class="numero">${numero}</span>${titre}</div>
      <div class="tuile-valeur">${valeur}</div>
      <div class="tuile-detail">${detail}</div>
    </div>
  `
}

function zoneHodl(a: Analyse): string {
  const e = a.etat
  const s = F.sens(e.jeton0.symbole, e.jeton1.symbole)
  const be = a.breakEven
  if (!be.existe) return 'Aucun prix où la position rattrape le HODL.'
  const [b, h] = [be.bas, be.haut].map((p) => (p === null ? null : s.prix(p)))
  const [bas, haut] = s.inverse ? [h, b] : [b, h]
  const zone =
    bas !== null && haut !== null
      ? `entre ${F.nombre(bas)} et ${F.nombre(haut)}`
      : bas !== null
        ? `au-dessus de ${F.nombre(bas)}`
        : `en dessous de ${F.nombre(haut)}`
  return be.enAvance
    ? `Bat le HODL tant que 1 ${s.base} reste ${zone} ${s.cotation}.`
    : `Repasserait devant si 1 ${s.base} allait ${zone} ${s.cotation}.`
}

function tuiles(a: Analyse, erreur: string | null): Fragment {
  const e = a.etat
  const h = a.historique
  const s = F.sens(e.jeton0.symbole, e.jeton1.symbole)
  if (!h) {
    return html`<div class="tuiles-attente">${erreur ? `Historique indisponible : ${erreur}` : 'Lecture du journal de la position…'}</div>`
  }
  const depots = h.mouvements.filter((m) => m.type === 'depot').length
  const retraits = h.mouvements.length - depots
  const pctRendement = a.rendementUsd !== null && a.investiUsd ? (a.rendementUsd / a.investiUsd) * 100 : null
  return html`
    <div class="tuiles">
      ${tuile(
        1,
        'Montant investi',
        F.dollars(a.investiUsd),
        `Ouverte le ${F.date(h.ouverture.horodatage)} · ${depots} dépôt${depots > 1 ? 's' : ''}${retraits ? ` · ${retraits} retrait${retraits > 1 ? 's' : ''}` : ''}`,
      )}
      ${tuile(
        2,
        "Prix à l'entrée",
        a.entree ? html`1 ${s.base} = ${F.nombre(s.prix(a.entree.prix))} <small>${s.cotation}</small>` : '—',
        a.entree ? `${e.jeton0.symbole} ${F.dollars(a.entree.usd0)} · ${e.jeton1.symbole} ${F.dollars(a.entree.usd1)}` : '',
      )}
      ${tuile(
        3,
        'Rendement depuis le début',
        html`${F.dollars(a.rendementUsd)} ${pctRendement !== null ? html`<small>${F.pourcent(pctRendement, true)}</small>` : ''}`,
        html`Fees ${F.nombre(a.fees0)} ${e.jeton0.symbole} + ${F.nombre(a.fees1)} ${e.jeton1.symbole}${a.aero > 0 ? ` · ${F.nombre(a.aero)} AERO` : ''}
          <span class="ligne-retrait">${
            h.reclamations.length
              ? `Valeur au retrait : ${F.dollars(a.feesRetireesUsd)} (${h.reclamations.length} retrait${h.reclamations.length > 1 ? 's' : ''}) · en attente ${F.dollars(a.feesEnAttenteUsd)}`
              : `Aucun retrait de fees · en attente ${F.dollars(a.feesEnAttenteUsd)}`
          }</span>`,
      )}
      ${a.fermee
        ? tuile(4, 'Rendement annualisé', `${F.pourcent(a.aprPourcent)} / an`, `Sur ${F.duree(a.jours)}, jusqu'à la fermeture`)
        : tuile(4, 'Projection annuelle', `${F.pourcent(a.aprPourcent)} / an`, `Moyenne sur ${F.duree(a.jours)} au rythme actuel`)}
      ${a.fermee
        ? tuile(
            5,
            'Résultat face au HODL',
            html`<span class="${(a.avanceClotureUsd ?? 0) >= 0 ? 'vert' : 'rouge'}">${F.dollars(a.avanceClotureUsd, true)}</span>`,
            a.cloture ? `Au prix du jour de la fermeture, le ${F.date(a.cloture.horodatage)}` : 'Position vidée',
          )
        : tuile(
            5,
            'Break-even face au HODL',
            html`<span class="${(a.avanceSurHodlUsd ?? 0) >= 0 ? 'vert' : 'rouge'}">${F.dollars(a.avanceSurHodlUsd, true)}</span> <small>aujourd'hui</small>`,
            zoneHodl(a),
          )}
      ${a.fermee
        ? tuile(
            6,
            'Capital retiré',
            F.dollars(a.retireUsd),
            `${F.nombre(a.retire0)} ${e.jeton0.symbole} + ${F.nombre(a.retire1)} ${e.jeton1.symbole}, au prix de chaque retrait`,
          )
        : tuile(6, 'Alerte Telegram', 'À venir', 'Prévenir quand le prix approche d’une borne.', 'inactive')}
    </div>
  `
}

function details(a: Analyse): Fragment {
  const e = a.etat
  const h = a.historique
  if (!h) return html``
  const s0 = e.jeton0.symbole
  const s1 = e.jeton1.symbole
  const sp = F.sens(s0, s1)
  const retraits = a.retraitsDeFees
  return html`
    <details class="details">
      <summary>Détail : ${h.mouvements.length} mouvement${h.mouvements.length > 1 ? 's' : ''}, ${retraits.length} retrait${retraits.length > 1 ? 's' : ''} de fees${h.periodesStakees.length ? `, ${h.periodesStakees.length} période${h.periodesStakees.length > 1 ? 's' : ''} stakée${h.periodesStakees.length > 1 ? 's' : ''}` : ''}</summary>
      <h3 class="details-titre">Dépôts et retraits de capital</h3>
      <table>
        <thead><tr><th>Date</th><th>Mouvement</th><th>${s0}</th><th>${s1}</th><th>Prix</th></tr></thead>
        <tbody>
          ${h.mouvements.map(
            (m) => html`<tr>
              <td>${F.date(m.horodatage)}</td>
              <td>${m.type === 'depot' ? 'Dépôt' : 'Retrait'}</td>
              <td>${F.nombre(m.quantite0)}</td>
              <td>${F.nombre(m.quantite1)}</td>
              <td>1 ${sp.base} = ${F.nombre(sp.prix(m.prix))} ${sp.cotation}</td>
            </tr>`,
          )}
        </tbody>
      </table>
      ${retraits.length
        ? html`
            <h3 class="details-titre">Retraits de fees</h3>
            <table>
              <thead><tr><th>Date</th><th>${s0}</th><th>${s1}</th><th>Valeur au retrait</th></tr></thead>
              <tbody>
                ${retraits.map(
                  (r) => html`<tr>
                    <td>${F.dateHeure(r.horodatage)}</td>
                    <td>${F.nombre(r.fees0)}</td>
                    <td>${F.nombre(r.fees1)}</td>
                    <td>${F.dollars(r.usd)}${r.prixDuJour ? html` <small>(prix du jour, pas de cotation à cette date)</small>` : ''}</td>
                  </tr>`,
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td>${F.nombre(retraits.reduce((s, r) => s + r.fees0, 0))}</td>
                  <td>${F.nombre(retraits.reduce((s, r) => s + r.fees1, 0))}</td>
                  <td>${F.dollars(a.feesRetireesUsd)}</td>
                </tr>
              </tfoot>
            </table>
          `
        : ''}
      ${h.periodesStakees.map(
        (p) =>
          html`<p class="ligne-stake">Stakée du ${F.date(p.debut)} ${p.fin ? `au ${F.date(p.fin)}` : "jusqu'à aujourd'hui"} : ${F.nombre(lisible(p.aero, 18))} AERO</p>`,
      )}
      <p class="ligne-technique">Journal lu en ${h.requetes} requête${h.requetes > 1 ? 's' : ''} (${F.secondes(h.secondes)}) · bloc ${e.bloc.toString()}</p>
    </details>
  `
}

/** Une mesure de l'onglet avancé : ce qu'elle vaut, et en une ligne ce qu'elle veut dire. */
function mesure(titre: string, valeur: Fragment | string, note: string): Fragment {
  return html`
    <div class="mesure">
      <div class="mesure-titre">${titre}</div>
      <div class="mesure-valeur">${valeur}</div>
      <div class="mesure-note">${note}</div>
    </div>
  `
}

const colorer = (v: number | null, texte: string): Fragment =>
  html`<span class="${v === null ? '' : v >= 0 ? 'vert' : 'rouge'}">${texte}</span>`

const groupe = (titre: string, mesures: Fragment[]): Fragment =>
  html`<section class="groupe">
    <h3 class="groupe-titre">${titre}</h3>
    <div class="mesures">${mesures}</div>
  </section>`

/** Onglet « Avancé » : tout ce que la photo et le journal permettent de déduire, sans une requête de plus. */
function panneauAvance(a: Analyse, erreur: string | null): Fragment {
  const m = metriquesAvancees(a)
  const e = a.etat
  const h = a.historique
  const s0 = e.jeton0.symbole
  const s1 = e.jeton1.symbole
  const aero = e.ref.protocole === 'aerodrome'
  const part0 = m.partJeton0Pourcent
  const lienPool = `${CHAINES[e.ref.chaine].explorateur}/address/${e.pool}`

  // Le pool se lit dans la photo : ce groupe s'affiche même quand le journal manque.
  const pool = groupe('Pool et fourchette', [
    mesure('Largeur de la fourchette', F.pourcent(m.largeurPourcent), 'Écart entre les deux bornes, rapporté à leur milieu.'),
    mesure(
      'Répartition actuelle',
      part0 === null ? '—' : html`${F.pourcent(part0)} <small>${s0}</small> · ${F.pourcent(100 - part0)} <small>${s1}</small>`,
      'Ce que vaut chaque jeton dans la position, au prix du jour.',
    ),
    mesure('TVL du pool', F.dollars(m.tvlPoolUsd), 'Ce que le contrat du pool détient, toutes fourchettes confondues.'),
    mesure(
      'Part de la liquidité active',
      F.taux(m.partLiquiditePourcent),
      e.dansLaFourchette
        ? 'La fraction des fees du pool qui te revient au prix actuel.'
        : 'Hors fourchette : la position ne touche rien pour l’instant.',
    ),
    mesure(
      'Frais du pool',
      F.taux(m.fraisPoolPourcent),
      aero
        ? `Prélevés sur chaque swap · espacement des ticks ${e.feeOuEspacement}.`
        : 'Prélevés par le pool sur chaque swap, quel que soit le prix.',
    ),
    mesure(
      'Pool',
      html`<a href="${lienPool}" target="_blank" rel="noopener noreferrer">${e.pool.slice(0, 8)}…${e.pool.slice(-6)}</a>`,
      `${s0} / ${s1} sur ${CHAINES[e.ref.chaine].nom}.`,
    ),
  ])

  if (!h) {
    return html`
      <div class="avance">
        <div class="tuiles-attente">
          ${erreur ? `Historique indisponible : ${erreur}` : 'Lecture du journal de la position…'}
        </div>
        ${pool}
      </div>
    `
  }
  return html`
    <div class="avance">
      ${groupe('Résultat', [
        mesure(
          'Résultat net',
          colorer(m.pnlUsd, F.dollars(m.pnlUsd, true)),
          'Ce qui est sorti plus ce qui reste, moins ce qui a été déposé.',
        ),
        mesure(
          'Retour sur investissement',
          colorer(m.roiPourcent, F.pourcent(m.roiPourcent, true)),
          'Le résultat net rapporté au montant investi.',
        ),
        mesure(
          'Gain sur les actifs',
          colorer(m.gainActifsUsd, F.dollars(m.gainActifsUsd, true)),
          'Le résultat net sans les fees : la part due au prix des jetons.',
        ),
        mesure(
          'Capital moyen engagé',
          F.dollars(m.capitalMoyenUsd),
          'Moyenne pondérée par le temps ; c’est la base du rendement annualisé.',
        ),
        mesure('Total sorti', F.dollars(m.sortiUsd), 'Capital retiré et fees encaissées, chacun au prix de sa date.'),
        mesure('Reste en position', F.dollars(m.resteUsd), 'Valeur actuelle plus ce qui n’a pas encore été réclamé.'),
      ])}
      ${groupe('Face au HODL', [
        mesure('Valeur si j’avais gardé', F.dollars(m.hodlUsd), `Les jetons déposés, au prix d’aujourd’hui.`),
        mesure(
          a.fermee ? 'Écart à la fermeture' : 'Écart vs HODL',
          colorer(m.ecartHodlUsd, F.dollars(m.ecartHodlUsd, true)),
          a.fermee ? 'Au prix du jour où la position a été vidée.' : 'La position, fees comprises, moins le HODL.',
        ),
        mesure(
          'Perte de divergence',
          colorer(m.divergenceUsd, F.dollars(m.divergenceUsd, true)),
          'Ce que le rééquilibrage du pool coûte, fees mises à part.',
        ),
        mesure(
          'Rétention des fees',
          colorer(m.retentionPourcent, F.pourcent(m.retentionPourcent, true)),
          'Part des fees qui reste une fois la divergence payée.',
        ),
        mesure(
          `vs tout en ${s0}`,
          colorer(m.vsTout0Pourcent, F.pourcent(m.vsTout0Pourcent, true)),
          `Écart avec un wallet qui aurait tout mis en ${s0} à l’entrée.`,
        ),
        mesure(
          `vs tout en ${s1}`,
          colorer(m.vsTout1Pourcent, F.pourcent(m.vsTout1Pourcent, true)),
          `Écart avec un wallet qui aurait tout mis en ${s1} à l’entrée.`,
        ),
      ])}
      ${groupe('Fees', [
        mesure(
          'Fees générées',
          F.dollars(m.feesTotalUsd),
          `${F.nombre(a.fees0)} ${s0} + ${F.nombre(a.fees1)} ${s1}${aero ? ` + ${F.nombre(a.aero)} AERO` : ''}`,
        ),
        mesure(
          'Encaissées',
          F.dollars(m.feesEncaisseesUsd),
          `${F.pourcent(m.partEncaisseePourcent)} du total, en ${h.reclamations.length} retrait${h.reclamations.length > 1 ? 's' : ''}.`,
        ),
        mesure('En attente', F.dollars(m.feesAttenteUsd), 'Réclamable maintenant, sans fermer la position.'),
        mesure('Fees par jour', F.dollars(m.feesParJourUsd), `Moyenne sur ${F.duree(a.jours)} de vie.`),
        mesure(
          'Rythme récent',
          html`${F.pourcent(m.aprRecentPourcent)} <small>/ an</small>`,
          a.fermee
            ? 'La position est fermée : plus rien ne s’y accumule.'
            : m.joursDepuisFees !== null
              ? `Les fees accumulées depuis le dernier retrait, il y a ${F.duree(m.joursDepuisFees)}.`
              : 'Les fees accumulées depuis l’ouverture, annualisées.',
        ),
        aero
          ? mesure(
              'AERO réclamés',
              html`${F.nombre(m.aeroReclames)} <small>(${F.dollars(m.aeroReclamesUsd)})</small>`,
              h.penalites > 0n
                ? `Pénalités de sortie anticipée déduites : ${F.nombre(lisible(h.penalites, 18))} AERO.`
                : 'Récompenses du gauge déjà sorties du contrat.',
            )
          : mesure('Récompenses', '—', 'Ce protocole ne distribue que les fees du pool.'),
      ])}
      ${groupe('Prix', [
        mesure(
          `Entrée moyenne ${s0}`,
          F.dollars(m.entree0),
          `Aujourd’hui ${F.dollars(a.usd0)} (${F.pourcent(m.variation0Pourcent, true)}).`,
        ),
        mesure(
          `Entrée moyenne ${s1}`,
          F.dollars(m.entree1),
          `Aujourd’hui ${F.dollars(a.usd1)} (${F.pourcent(m.variation1Pourcent, true)}).`,
        ),
        mesure(
          `Sortie moyenne ${s0}`,
          F.dollars(m.sortie0),
          m.sortie0 === null ? 'Aucun retrait de capital pour l’instant.' : `Prix moyen des ${F.nombre(a.retire0)} ${s0} retirés.`,
        ),
        mesure(
          `Sortie moyenne ${s1}`,
          F.dollars(m.sortie1),
          m.sortie1 === null ? 'Aucun retrait de capital pour l’instant.' : `Prix moyen des ${F.nombre(a.retire1)} ${s1} retirés.`,
        ),
      ])}
      ${pool}
      ${groupe('Chronologie', [
        mesure(
          'Ouverte le',
          F.dateHeure(h.ouverture.horodatage),
          a.fermee ? `${F.duree(a.jours)} de vie, jusqu’à la fermeture.` : `Il y a ${F.duree(a.jours)}.`,
        ),
        mesure(
          a.fermee ? 'Fermée le' : 'Dernier mouvement',
          m.fermeture !== null
            ? F.dateHeure(m.fermeture)
            : h.mouvements.length
              ? F.dateHeure(h.mouvements[h.mouvements.length - 1].horodatage)
              : '—',
          a.fermee ? 'Dernier retrait de capital.' : 'Dernier dépôt ou retrait de capital.',
        ),
        mesure(
          'Opérations',
          String(m.operations),
          `${h.mouvements.length} mouvement${h.mouvements.length > 1 ? 's' : ''} de capital, ${h.reclamations.length} retrait${h.reclamations.length > 1 ? 's' : ''} de fees.`,
        ),
        mesure(
          'Périodes stakées',
          String(h.periodesStakees.length),
          aero ? 'Une position stakée gagne des AERO mais plus de fees.' : 'Ce protocole n’a pas de gauge.',
        ),
        mesure(
          'Photo prise au bloc',
          e.bloc.toString(),
          `${F.dateHeure(e.horodatage)} · journal lu en ${h.requetes} requête${h.requetes > 1 ? 's' : ''}.`,
        ),
        mesure('Coût en gas', '—', 'Non lu : il faudrait le reçu de chacune des transactions.'),
      ])}
    </div>
  `
}

export function carte(a: Analyse, erreur: string | null): Fragment {
  const e = a.etat
  const attenteAero = e.ref.gauge ? html` · AERO ${F.nombre(lisible(e.aeroEnAttente, 18))} <small>(${F.dollars(a.aeroEnAttenteUsd)})</small>` : ''
  return html`
    <article class="carte">
      <div class="carte-haut">
        <h2>${e.jeton0.symbole} / ${e.jeton1.symbole}</h2>
        <div class="badges">${badges(e, a.fermee)}</div>
      </div>
      <div class="carte-milieu">
        ${fourchette(e)}
        ${a.fermee
          ? html`<div class="valeur">
              <div class="valeur-titre">Sortie de la position</div>
              <div class="valeur-montant">
                ${a.historique ? F.dollars((a.retireUsd ?? 0) + (a.feesRetireesUsd ?? 0)) : '—'}
              </div>
              <div class="valeur-detail">
                ${a.historique
                  ? `Capital ${F.dollars(a.retireUsd)} + fees ${F.dollars(a.feesRetireesUsd)}`
                  : 'Montants inconnus sans son histoire'}
              </div>
              <div class="valeur-detail">
                ${a.historique ? `Ouverte le ${F.date(a.historique.ouverture.horodatage)}` : ''}${a.cloture ? `, fermée le ${F.date(a.cloture.horodatage)}` : ''}
              </div>
            </div>`
          : html`<div class="valeur">
              <div class="valeur-titre">Valeur actuelle</div>
              <div class="valeur-montant">${F.dollars(a.valeurUsd)}</div>
              <div class="valeur-detail">${F.nombre(e.quantite0)} ${e.jeton0.symbole} + ${F.nombre(e.quantite1)} ${e.jeton1.symbole}</div>
              <div class="valeur-detail">En attente : fees ${F.dollars(a.feesEnAttenteUsd)}${attenteAero}</div>
            </div>`}
      </div>
      ${onglets(a, erreur)}
    </article>
  `
}

/**
 * Les deux vues d'une position, en CSS pur : deux boutons radio cachés commandent l'affichage.
 * Aucun script à rebrancher, donc une carte reste une simple chaîne de HTML.
 */
function onglets(a: Analyse, erreur: string | null): Fragment {
  // Le gestionnaire entre dans le nom : deux contrats NFT d'une même chaîne peuvent porter le même numéro.
  const nom = `vue-${a.etat.ref.chaine}-${a.etat.ref.gestionnaire.slice(2, 8)}-${a.etat.ref.id}`
  return html`
    <div class="onglets">
      <input type="radio" class="onglet-radio" name="${nom}" id="${nom}-resume" checked />
      <input type="radio" class="onglet-radio" name="${nom}" id="${nom}-avance" />
      <nav class="barre-onglets">
        <label for="${nom}-resume">Résumé</label>
        <label for="${nom}-avance">Avancé</label>
      </nav>
      <div class="panneau">${tuiles(a, erreur)} ${details(a)}</div>
      <div class="panneau">${panneauAvance(a, erreur)}</div>
    </div>
  `
}

export function resume(analyses: Analyse[]): Fragment {
  if (analyses.length < 2) return html``
  const somme = (f: (a: Analyse) => number | null) =>
    analyses.reduce<number | null>((s, a) => (s === null || f(a) === null ? null : s + (f(a) as number)), 0)
  const dansFourchette = analyses.filter((a) => a.etat.dansLaFourchette).length
  return html`
    <div class="resume-bloc"><span>Valeur totale</span><strong>${F.dollars(somme((a) => a.valeurUsd))}</strong></div>
    <div class="resume-bloc"><span>Rendement total</span><strong>${F.dollars(somme((a) => a.rendementUsd))}</strong></div>
    <div class="resume-bloc"><span>Dans la fourchette</span><strong>${dansFourchette} / ${analyses.length}</strong></div>
  `
}
