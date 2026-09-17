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
import { secondes } from './ui/format'
import { html, poser } from './ui/html'
import { carte, resume } from './ui/rendu'

const formulaire = document.querySelector<HTMLFormElement>('#formulaire')!
const champ = document.querySelector<HTMLInputElement>('#wallet')!
const statut = document.querySelector<HTMLElement>('#statut')!
const zoneResume = document.querySelector<HTMLElement>('#resume')!
const zonePositions = document.querySelector<HTMLElement>('#positions')!
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

async function analyserWallet(wallet: Address) {
  const numero = ++analyseEnCours
  const abandonnee = () => numero !== analyseEnCours
  const chrono = Date.now()
  poser(zoneResume, html``)
  poser(zonePositions, html``)
  dire('Recherche des positions du wallet…')

  const inventaire = await listerPositions(wallet)
  if (abandonnee()) return
  if (!inventaire.positions.length) {
    dire(
      inventaire.erreurs.length
        ? `Lecture impossible : ${inventaire.erreurs.join(' ; ')}`
        : `Aucune position ouverte${inventaire.fermees ? ` (${inventaire.fermees} position${inventaire.fermees > 1 ? 's' : ''} vide${inventaire.fermees > 1 ? 's' : ''} ignorée${inventaire.fermees > 1 ? 's' : ''})` : ''}.`,
      inventaire.erreurs.length > 0,
    )
    return
  }

  dire(`${inventaire.positions.length} position${inventaire.positions.length > 1 ? 's' : ''} trouvée${inventaire.positions.length > 1 ? 's' : ''}, lecture de leur état…`)
  const etats = await lireEtats(inventaire.positions, wallet)
  const prixDuJour = await prixActuels([
    ...etats.flatMap((e) => [cleDePrix(e.ref.chaine, e.jeton0.adresse), cleDePrix(e.ref.chaine, e.jeton1.adresse)]),
    cleDePrix('base', AERODROME.aero),
  ]).catch(() => new Map() as Prix)
  if (abandonnee()) return

  // Première passe : l'état actuel s'affiche tout de suite, l'historique arrive ensuite.
  const emplacements = etats.map(() => document.createElement('div'))
  zonePositions.replaceChildren(...emplacements)
  etats.forEach((etat, i) => poser(emplacements[i], carte(analyser(etat, null, prixDuJour, new Map()), null)))
  dire('Lecture du journal de chaque position…')

  const analyses: Analyse[] = await Promise.all(
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
  if (abandonnee()) return
  poser(zoneResume, resume(analyses))
  const ignorees = inventaire.fermees ? ` · ${inventaire.fermees} position${inventaire.fermees > 1 ? 's' : ''} vide${inventaire.fermees > 1 ? 's' : ''} ignorée${inventaire.fermees > 1 ? 's' : ''}` : ''
  const erreurs = inventaire.erreurs.length ? ` · ${inventaire.erreurs.join(' ; ')}` : ''
  dire(`Analyse terminée en ${secondes((Date.now() - chrono) / 1000)}${ignorees}${erreurs}`, inventaire.erreurs.length > 0)
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
