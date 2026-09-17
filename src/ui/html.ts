// Gabarits HTML qui échappent tout par défaut : les symboles de jetons viennent de la chaîne,
// n'importe qui peut en créer un qui s'appelle « <img onerror=…> ».

const BRUT = Symbol('brut')
export interface Fragment {
  [BRUT]: string
}

const echapper = (texte: string): string =>
  texte.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function rendre(v: unknown): string {
  if (v === null || v === undefined || v === false) return ''
  if (Array.isArray(v)) return v.map(rendre).join('')
  if (typeof v === 'object' && BRUT in v) return (v as Fragment)[BRUT]
  return echapper(String(v))
}

export function html(morceaux: TemplateStringsArray, ...valeurs: unknown[]): Fragment {
  let texte = morceaux[0]
  valeurs.forEach((v, i) => {
    texte += rendre(v) + morceaux[i + 1]
  })
  return { [BRUT]: texte }
}

export function poser(element: Element, fragment: Fragment): void {
  element.innerHTML = fragment[BRUT]
}
