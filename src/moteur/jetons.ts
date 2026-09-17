/** Reconnaît un stablecoin à son symbole (USDC, USDT, USDG, DAI, EURC…). Sert à l'affichage et aux prix manquants. */
export const estStable = (symbole: string): boolean => /USD|DAI|EUR|GHO|FRAX/i.test(symbole)
