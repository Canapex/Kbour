import { defineConfig } from 'vite'

export default defineConfig({
  // Chemins relatifs : la page marche aussi bien à la racine d'un domaine que dans un sous-dossier (GitHub Pages).
  base: './',
  server: {
    // Pas de rechargement automatique : l'adresse dans l'URL relancerait une analyse à chaque modification du code.
    hmr: false,
  },
})
