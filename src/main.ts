// Polices embarquées dans le site : aucune requête vers Google Fonts, donc aucune IP de visiteur transmise.
import '@fontsource/orbitron/700.css'
import '@fontsource/orbitron/800.css'
import '@fontsource/orbitron/900.css'
import '@fontsource/exo-2/400.css'
import '@fontsource/exo-2/500.css'
import '@fontsource/exo-2/600.css'
import { getAddress, isAddress, type Address } from 'viem'
import { analyser, horodatagesUtiles, type Analyse } from './moteur/analyse'
import { AERODROME, cleConfiguree, verifierCle } from './moteur/chaines'
import { lireEtats } from './moteur/etat'
import { reconstruireHistorique, type Historique } from './moteur/historique'
import { listerPositions, message } from './moteur/lister'
import { cleDePrix, prixActuels, prixHistoriquesGroupes, type Prix } from './moteur/prix'
import type { RefPosition } from './moteur/types'
import { secondes } from './ui/format'
import { html, poser } from './ui/html'
import { carte, resume } from './ui/rendu'

const formulaire = document.querySelector<HTMLFormElement>('#formulaire')!
const champ = document.querySelector<HTMLInputElement>('#wallet')!
const statut = document.querySelector<HTMLElement>('#statut')!
const zoneResume = document.querySelector<HTMLElement>('#resume')!
const zonePositions = document.querySelector<HTMLElement>('#positions')!
const zoneFermees = document.querySelector<HTMLElement>('#fermees')!
const zoneCle = document.querySelector<HTMLElement>('#zone-cle')!
const champCle = document.querySelector<HTMLInputElement>('#cle')!
const boutonAutreCle = document.querySelector<HTMLButtonElement>('#autre-cle')!

// Sans .env.local (dossier copié chez quelqu'un d'autre), chacun colle sa propre clé.
// Avec un fichier présent mais une clé qui ne passe pas, le lien permet d'en essayer une autre.
zoneCle.hidden = cleConfiguree()
boutonAutreCle.hidden = !cleConfiguree()
boutonAutreCle.addEventListener('click', () => {
  zoneCle.hidden = false
  boutonAutreCle.hidden = true
  champCle.focus()
})

let analyseEnCours = 0

function dire(texte: string, erreur = false) {
  statut.textContent = texte
  statut.classList.toggle('erreur', erreur)
}

/** Analyse un lot de positions : l'état s'affiche tout de suite, l'histoire de chacune arrive ensuite. */
async function analyserLot(
  refs: RefPosition[],
  wallet: Address,
  conteneur: HTMLElement,
  abandonnee: () => boolean,
): Promise<Analyse[]> {
  const etats = await lireEtats(refs, wallet)
  const prixDuJour = await prixActuels([
    ...etats.flatMap((e) => [cleDePrix(e.ref.chaine, e.jeton0.adresse), cleDePrix(e.ref.chaine, e.jeton1.adresse)]),
    cleDePrix('base', AERODROME.aero),
  ]).catch(() => new Map() as Prix)
  if (abandonnee()) return []

  const emplacements = etats.map(() => document.createElement('div'))
  conteneur.replaceChildren(...emplacements)
  etats.forEach((etat, i) => poser(emplacements[i], carte(analyser(etat, null, prixDuJour, new Map()), null)))

  return Promise.all(
    etats.map(async (etat, i) => {
      let historique: Historique | null = null
      let erreur: string | null = null
      try {
        historique = await reconstruireHistorique(etat)
      } catch (e) {
        erreur = message(e)
      }
      const cles = [cleDePrix(etat.ref.chaine, etat.jeton0.adresse), cleDePrix(etat.ref.chaine, etat.jeton1.adresse)]
      const passes = historique
        ? await prixHistoriquesGroupes(cles, horodatagesUtiles(historique)).catch(() => new Map<number, Prix>())
        : new Map<number, Prix>()
      const analyse = analyser(etat, historique, prixDuJour, passes)
      if (!abandonnee()) poser(emplacements[i], carte(analyse, erreur))
      return analyse
    }),
  )
}

/** Les positions vidées ne sont lues que si on les demande : leur histoire coûte quelques requêtes chacune. */
function proposerFermees(refs: RefPosition[], wallet: Address, abandonnee: () => boolean) {
  if (!refs.length) return
  const pluriel = refs.length > 1 ? 's' : ''
  poser(
    zoneFermees,
    html`
      <button type="button" id="voir-fermees" class="bouton-secondaire">
        Voir les ${refs.length} position${pluriel} fermée${pluriel}
      </button>
      <div id="liste-fermees" class="positions"></div>
    `,
  )
  const bouton = document.querySelector<HTMLButtonElement>('#voir-fermees')!
  const liste = document.querySelector<HTMLElement>('#liste-fermees')!
  bouton.addEventListener('click', async () => {
    bouton.disabled = true
    bouton.textContent = 'Lecture de leur histoire…'
    try {
      await analyserLot(refs, wallet, liste, abandonnee)
      bouton.remove()
    } catch (e) {
      bouton.disabled = false
      bouton.textContent = `Échec : ${message(e)} — réessayer`
    }
  })
}

async function analyserWallet(wallet: Address) {
  const numero = ++analyseEnCours
  const abandonnee = () => numero !== analyseEnCours
  const chrono = Date.now()
  poser(zoneResume, html``)
  poser(zonePositions, html``)
  poser(zoneFermees, html``)
  dire('Recherche des positions du wallet…')

  const inventaire = await listerPositions(wallet)
  if (abandonnee()) return
  if (!inventaire.positions.length && !inventaire.fermees.length) {
    dire(
      inventaire.erreurs.length ? `Lecture impossible : ${inventaire.erreurs.join(' ; ')}` : 'Aucune position trouvée pour ce wallet.',
      inventaire.erreurs.length > 0,
    )
    return
  }

  if (inventaire.positions.length) {
    const pluriel = inventaire.positions.length > 1 ? 's' : ''
    dire(`${inventaire.positions.length} position${pluriel} ouverte${pluriel}, lecture de leur état…`)
    const analyses = await analyserLot(inventaire.positions, wallet, zonePositions, abandonnee)
    if (abandonnee()) return
    poser(zoneResume, resume(analyses))
  } else {
    poser(zonePositions, html`<p class="statut">Aucune position ouverte pour ce wallet.</p>`)
  }

  proposerFermees(inventaire.fermees, wallet, abandonnee)
  const erreurs = inventaire.erreurs.length ? ` · ${inventaire.erreurs.join(' ; ')}` : ''
  dire(`Analyse terminée en ${secondes((Date.now() - chrono) / 1000)}${erreurs}`, inventaire.erreurs.length > 0)
}

function lancer(saisie: string) {
  const texte = saisie.trim()
  if (!isAddress(texte)) {
    dire("Ce n'est pas une adresse de wallet valide (0x suivi de 40 caractères).", true)
    return
  }
  const wallet = getAddress(texte)
  // Le fragment (#…) n'est jamais envoyé au serveur : lien partageable, rien d'enregistré.
  history.replaceState(null, '', `#${wallet}`)
  champ.value = wallet
  analyserWallet(wallet).catch((e) => dire(`Erreur : ${message(e)}`, true))
}

formulaire.addEventListener('submit', async (evenement) => {
  evenement.preventDefault()
  if (!zoneCle.hidden && champCle.value.trim()) {
    dire('Vérification de la clé Alchemy…')
    const essai = await verifierCle(champCle.value)
    if (!essai.ok) {
      dire(
        `Clé Alchemy refusée (${essai.detail ?? 'sans détail'}). Vérifie la clé, et que les réseaux Ethereum, Base et Robinhood Chain sont activés dans l'application Alchemy.`,
        true,
      )
      return
    }
  }
  lancer(champ.value)
})

const depuisLien = decodeURIComponent(location.hash.slice(1))
if (depuisLien) lancer(depuisLien)
