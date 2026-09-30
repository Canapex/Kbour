import { parseAbi } from 'viem'
import type { Protocole } from './types'

// Signatures relevées dans les sources vérifiées (Blockscout) le 17/09/2026.

/** Contrat NFT des positions. Le 5e champ est le tier de fee (Uniswap) ou l'espacement des ticks (Aerodrome). */
export const abiGestionnaire = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function factory() view returns (address)',
  'function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 feeOuEspacement, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)',
])

/** Uniswap v4 : contrat des positions. La clé du pool et les ticks sont rangés dans un uint256 (PositionInfo). */
export const abiPositionsV4 = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function getPoolAndPositionInfo(uint256 tokenId) view returns ((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, uint256 info)',
  'function getPositionLiquidity(uint256 tokenId) view returns (uint128 liquidity)',
])

/** Uniswap v4 : lecture de l'état des pools du PoolManager. */
export const abiStateView = parseAbi([
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)',
  'function getFeeGrowthInside(bytes32 poolId, int24 tickLower, int24 tickUpper) view returns (uint256 feeGrowthInside0X128, uint256 feeGrowthInside1X128)',
  'function getPositionInfo(bytes32 poolId, address owner, int24 tickLower, int24 tickUpper, bytes32 salt) view returns (uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128)',
])

/**
 * PancakeSwap Infinity : contrat des positions et PoolManager des pools concentrés (sources vérifiées, Blockscout
 * Base, 30/09/2026). Les structures renvoyées (position, tick) sont à plat : même encodage, lecture plus simple.
 */
export const abiPositionsInfinity = parseAbi([
  'function ownerOf(uint256 id) view returns (address)',
  'function positions(uint256 tokenId) view returns ((address currency0, address currency1, address hooks, address poolManager, uint24 fee, bytes32 parameters) poolKey, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, address _subscriber)',
  'function getPositionLiquidity(uint256 tokenId) view returns (uint128 liquidity)',
])
export const abiPoolManagerInfinity = parseAbi([
  'function getSlot0(bytes32 id) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function getLiquidity(bytes32 id) view returns (uint128 liquidity)',
  'function getFeeGrowthGlobals(bytes32 id) view returns (uint256 feeGrowthGlobal0x128, uint256 feeGrowthGlobal1x128)',
  'function getPoolTickInfo(bytes32 id, int24 tick) view returns (uint128 liquidityGross, int128 liquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128)',
  'function getPosition(bytes32 id, address owner, int24 tickLower, int24 tickUpper, bytes32 salt) view returns (uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128)',
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

/** PancakeSwap v3 : comme Uniswap v3, mais feeProtocol tient sur 32 bits. */
export const abiPoolPancake = parseAbi([
  'function liquidity() view returns (uint128)',
  'function fee() view returns (uint24)',
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint32 feeProtocol, bool unlocked)',
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

export const abiDuPool = (protocole: Protocole) =>
  protocole === 'aerodrome' ? abiPoolAerodrome : protocole === 'pancakeswap-v3' ? abiPoolPancake : abiPoolUniswap
