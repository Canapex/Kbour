# Kbour — suivi de positions LP

Suivre ses positions de liquidité **sans Krystal**, directement sur la chaîne.

- **Uniswap v3** sur Ethereum et sur Robinhood Chain
- **Aerodrome (Slipstream)** sur Base, positions stakées comprises

On entre une adresse de wallet, la page lit tout sur la chaîne et affiche, pour chaque position :

1. le **montant investi**, dépôt par dépôt ;
2. le **prix à l'entrée** ;
3. le **rendement depuis le début** : fees et AERO, avec la valeur de chaque retrait de fees au prix de sa date ;
4. la **projection annuelle** ;
5. le **break-even face au HODL** : la zone de prix où la position bat le fait d'avoir simplement gardé ses jetons ;
6. l'**alerte Telegram** (à venir).

## Rien n'est enregistré

Pas de base de données, pas de serveur, pas de cookie, pas de stockage dans le navigateur. Tout est relu à chaque analyse et disparaît à la fermeture de l'onglet. L'adresse analysée apparaît dans l'URL, après le `#`, qui n'est jamais envoyé à un serveur.

Pendant une analyse, votre navigateur interroge directement Alchemy (les positions et leur historique) et DefiLlama (les prix en dollars, jamais l'adresse du wallet).

**Cette page ne demande jamais de connecter un wallet, ni de signer quoi que ce soit.** Si une page qui prétend être celle-ci vous le demande, c'est un piège.

Les chiffres sont indicatifs et ne constituent pas un conseil financier.

## Il faut une clé Alchemy, gratuite

Le journal de la chaîne, indispensable à l'historique, n'est pas servi par les RPC publics. Chacun utilise **sa** clé :

1. créer un compte sur [dashboard.alchemy.com](https://dashboard.alchemy.com/) et une application ;
2. y activer les réseaux **Ethereum Mainnet**, **Base Mainnet** et **Robinhood Chain Mainnet** ;
3. coller la clé dans le champ prévu sur la page.

Elle reste en mémoire le temps de la visite et n'est écrite nulle part.

Sans clé, l'état actuel des positions s'affiche quand même, mais pas l'historique.

## Lancer la page chez soi

```bash
npm install
npm run dev
```

Puis ouvrir http://localhost:5180.

Pour ne pas coller la clé à chaque fois, créer un fichier `.env.local` à côté de `package.json` :

```
VITE_ALCHEMY_KEY=votre_clé
```

Attention : le Bloc-notes de Windows enregistre souvent `.env.local.txt`, que Vite ne lit pas. Et le fichier n'est lu qu'au démarrage : relancer `npm run dev` après l'avoir créé.

En cas de doute :

```bash
npm run diagnostic
```

Ce script vérifie le nom du fichier, le nom de la variable, puis essaie la clé sur les trois réseaux.

### L'avertissement npm sur les scripts d'installation

Les versions récentes de npm bloquent les scripts d'installation des dépendances et l'annoncent (`esbuild … install scripts not yet covered by allowScripts`). C'est une protection, et tout fonctionne sans : le binaire esbuild est livré par son propre paquet. Il n'y a rien à approuver.

## Outils en ligne de commande

```bash
npm run rapport -- 0xAdresse     # les six chiffres, position par position
npm run verifier -- 0xAdresse    # recoupe les fees et les AERO avec des sources indépendantes
npm run diagnostic               # pourquoi l'historique est indisponible
```

Les adresses ne sont écrites dans aucun fichier.

## Comment les chiffres sont obtenus

- **État actuel** : lecture directe des contrats, regroupée en une requête par chaîne (Multicall3).
- **Historique** : journal de la chaîne (`eth_getLogs`), donc les montants exacts des dépôts, retraits et réclamations.
- **Fees en attente** : même calcul que le contrat ; vérifié identique à une réclamation simulée.
- **AERO d'une position stakée** : compteur du gauge au moment du stake et de l'unstake ; vérifié égal aux AERO réellement versés.
- **Prix en dollars** : DefiLlama, avec le prix du jour de chaque mouvement pour l'historique.

## Pas encore fait

- Uniswap v4
- L'alerte Telegram
