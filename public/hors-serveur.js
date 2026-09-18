// Ouvrir index.html comme un fichier (file://) ne marche pas : le navigateur ne lit ni la feuille
// de style ni le TypeScript. Dans ce cas, on masque la page et on explique quoi faire.
if (location.protocol === 'file:') {
  var avis = document.querySelector('.hors-serveur')
  var principal = document.querySelector('main')
  if (avis) avis.hidden = false
  if (principal) principal.hidden = true
}
