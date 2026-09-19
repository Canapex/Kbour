import { parseAbi } from 'viem'

// Signatures relevées dans les sources vérifiées (Blockscout) le 17/09/2026.

/** Contrat NFT des positions. Le 5e champ est le tier de fee (Uniswap) ou l'espacement des ticks (Aerodrome). */
export const abiGestionnaire = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function factory() view returns (address)',
  'function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 feeOuEspacement, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)',
])

export const abiFactoryUniswap = parseAbi([
  'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)',
])

export const abiFactoryAerodrome = parseAbi([
  'function getPool(address tokenA, address tokenB, int24 tickSpacing) view returns (address)',
])

export const abiPoolUniswap = parseAbi([
  'function liquidity() view returns (uint128)',
  'function fee() view returns (uint24)',
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function feeGrowthGlobal0X128() view returns (uint256)',
  'function feeGrowthGlobal1X128() view returns (uint256)',
  'function ticks(int24 tick) view returns (uint128 liquidityGross, int128 liquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128, int56 tickCumulativeOutside, uint160 secondsPerLiquidityOutsideX128, uint32 secondsOutside, bool initialized)',
])

/** Aerodrome Slipstream : slot0 sans feeProtocol, ticks avec stakedLiquidityNet et rewardGrowthOutside. */
export const abiPoolAerodrome = parseAbi([
  'function liquidity() view returns (uint128)',
  'function fee() view returns (uint24)',
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, bool unlocked)',
  'function feeGrowthGlobal0X128() view returns (uint256)',
  'function feeGrowthGlobal1X128() view returns (uint256)',
  'function rewardGrowthGlobalX128() view returns (uint256)',
  'function rewardReserve() view returns (uint256)',
  'function lastUpdated() view returns (uint32)',
  'function stakedLiquidity() view returns (uint128)',
  'function gauge() view returns (address)',
  'function ticks(int24 tick) view returns (uint128 liquidityGross, int128 liquidityNet, int128 stakedLiquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128, uint256 rewardGrowthOutsideX128, int56 tickCumulativeOutside, uint160 secondsPerLiquidityOutsideX128, uint32 secondsOutside, bool initialized)',
])

export const abiGauge = parseAbi([
  'function nft() view returns (address)',
  'function rewardRate() view returns (uint256)',
  'function stakedLength(address depositor) view returns (uint256)',
  'function stakedValues(address depositor) view returns (uint256[])',
  'function earned(address account, uint256 tokenId) view returns (uint256)',
  'function rewardGrowthInside(uint256 tokenId) view returns (uint256)',
  'function lastUpdateTime(uint256 tokenId) view returns (uint256)',
  'function depositTimestamp(uint256 tokenId) view returns (uint256)',
])

export const abiVoter = parseAbi([
  'function length() view returns (uint256)',
  'function pools(uint256 index) view returns (address)',
  'function gauges(address pool) view returns (address)',
])

export const abiJeton = parseAbi([
  'function balanceOf(address compte) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
])

/** Quelques vieux jetons renvoient leur symbole en bytes32. */
export const abiJetonBytes32 = parseAbi(['function symbol() view returns (bytes32)'])

export const abiMulticall3 = parseAbi([
  'function getBlockNumber() view returns (uint256)',
  'function getCurrentBlockTimestamp() view returns (uint256)',
])
