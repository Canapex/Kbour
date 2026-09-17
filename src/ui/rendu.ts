import type { Analyse } from '../moteur/analyse'
import { CHAINES } from '../moteur/chaines'
import { lisible } from '../moteur/maths'
import type { EtatPosition } from '../moteur/types'
import * as F from './format'
import { html, type Fragment } from './html'

function badges(e: EtatPosition): Fragment {
  const protocole = e.ref.protocole === 'aerodrome' ? 'Aerodrome' : 'Uniswap v3'
  return html`
    <span class="badge">${protocole} · ${CHAINES[e.ref.chaine].nom}</span>
    <span class="badge discret">#${e.ref.id.toString()}</span>
    ${e.ref.gauge ? html`<span class="badge accent">Stakée</span>` : ''}
    <span class="badge ${e.dansLaFourchette ? 'vert' : 'rouge'}">${e.dansLaFourchette ? 'Dans la fourchette' : 'Hors fourchette'}</span>
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
      ${tuile(4, 'Projection annuelle', `${F.pourcent(a.aprPourcent)} / an`, `Moyenne sur ${F.duree(a.jours)} au rythme actuel`)}
      ${tuile(
        5,
        'Break-even face au HODL',
        html`<span class="${(a.avanceSurHodlUsd ?? 0) >= 0 ? 'vert' : 'rouge'}">${F.dollars(a.avanceSurHodlUsd, true)}</span> <small>aujourd'hui</small>`,
        zoneHodl(a),
      )}
      ${tuile(6, 'Alerte Telegram', 'À venir', 'Prévenir quand le prix approche d’une borne.', 'inactive')}
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

export function carte(a: Analyse, erreur: string | null): Fragment {
  const e = a.etat
  const attenteAero = e.ref.gauge ? html` · AERO ${F.nombre(lisible(e.aeroEnAttente, 18))} <small>(${F.dollars(a.aeroEnAttenteUsd)})</small>` : ''
  return html`
    <article class="carte">
      <div class="carte-haut">
        <h2>${e.jeton0.symbole} / ${e.jeton1.symbole}</h2>
        <div class="badges">${badges(e)}</div>
      </div>
      <div class="carte-milieu">
        ${fourchette(e)}
        <div class="valeur">
          <div class="valeur-titre">Valeur actuelle</div>
          <div class="valeur-montant">${F.dollars(a.valeurUsd)}</div>
          <div class="valeur-detail">${F.nombre(e.quantite0)} ${e.jeton0.symbole} + ${F.nombre(e.quantite1)} ${e.jeton1.symbole}</div>
          <div class="valeur-detail">En attente : fees ${F.dollars(a.feesEnAttenteUsd)}${attenteAero}</div>
        </div>
      </div>
      ${tuiles(a, erreur)}
      ${details(a)}
    </article>
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
