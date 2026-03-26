/**
 * Supported token configurations for Polygon network
 * Currently configured for AMOY TESTNET (for development/testing)
 * Change NETWORK_MODE to 'mainnet' for production
 */
import { SupportedToken } from '@/types';

// ═══════════════════════════════════════════════════════════════════
// NETWORK CONFIGURATION - Change this to switch between testnet/mainnet
// ═══════════════════════════════════════════════════════════════════
type NetworkMode = 'testnet' | 'mainnet';
export const NETWORK_MODE: NetworkMode = 'testnet' as NetworkMode;

export interface TokenConfig {
  symbol: SupportedToken;
  name: string;
  decimals: number;
  contractAddress: string;
  iconEmoji: string;
  coingeckoId: string;
}

// Polygon Amoy Testnet contract addresses
const TESTNET_TOKENS: Record<SupportedToken, TokenConfig> = {
  USDC: {
    symbol: 'USDC',
    name: 'USD Coin (Test)',
    decimals: 6,
    contractAddress: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582', // Amoy USDC
    iconEmoji: '💵',
    coingeckoId: 'usd-coin',
  },
  USDT: {
    symbol: 'USDT',
    name: 'Tether USD (Test)',
    decimals: 6,
    contractAddress: '0x1616d425Cd540B256475cBfb604586C8598eC0FB', // Amoy USDT
    iconEmoji: '💴',
    coingeckoId: 'tether',
  },
  ETH: {
    symbol: 'ETH',
    name: 'Ethereum (Test)',
    decimals: 18,
    contractAddress: '0x0000000000000000000000000000000000000000', // Native or wrapped
    iconEmoji: '⟠',
    coingeckoId: 'ethereum',
  },
  MATIC: {
    symbol: 'MATIC',
    name: 'POL (Testnet)',
    decimals: 18,
    contractAddress: '0x0000000000000000000000000000000000000000', // Native token
    iconEmoji: '🟣',
    coingeckoId: 'matic-network',
  },
  WBTC: {
    symbol: 'WBTC',
    name: 'Wrapped Bitcoin (Test)',
    decimals: 8,
    contractAddress: '0x0000000000000000000000000000000000000000', // May not exist on testnet
    iconEmoji: '₿',
    coingeckoId: 'wrapped-bitcoin',
  },
};

// Polygon Mainnet contract addresses
const MAINNET_TOKENS: Record<SupportedToken, TokenConfig> = {
  USDC: {
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    contractAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    iconEmoji: '💵',
    coingeckoId: 'usd-coin',
  },
  USDT: {
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    contractAddress: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    iconEmoji: '💴',
    coingeckoId: 'tether',
  },
  ETH: {
    symbol: 'ETH',
    name: 'Ethereum',
    decimals: 18,
    contractAddress: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', // WETH on Polygon
    iconEmoji: '⟠',
    coingeckoId: 'ethereum',
  },
  MATIC: {
    symbol: 'MATIC',
    name: 'Polygon',
    decimals: 18,
    contractAddress: '0x0000000000000000000000000000000000000000', // native token
    iconEmoji: '🟣',
    coingeckoId: 'matic-network',
  },
  WBTC: {
    symbol: 'WBTC',
    name: 'Wrapped Bitcoin',
    decimals: 8,
    contractAddress: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6',
    iconEmoji: '₿',
    coingeckoId: 'wrapped-bitcoin',
  },
};

// Select tokens based on network mode
export const TOKENS = NETWORK_MODE === 'testnet' ? TESTNET_TOKENS : MAINNET_TOKENS;

export const DEFAULT_TOKEN: SupportedToken = 'USDC';

// Network-specific RPC URLs and chain IDs
const TESTNET_CONFIG = {
  rpcUrl: 'https://rpc-amoy.polygon.technology',
  chainId: 80002,
  explorerUrl: 'https://amoy.polygonscan.com',
  networkName: 'Polygon Amoy Testnet',
};

const MAINNET_CONFIG = {
  rpcUrl: process.env.EXPO_PUBLIC_POLYGON_RPC_URL ?? '',
  chainId: 137,
  explorerUrl: 'https://polygonscan.com',
  networkName: 'Polygon Mainnet',
};

const NETWORK_CONFIG = NETWORK_MODE === 'testnet' ? TESTNET_CONFIG : MAINNET_CONFIG;

// Polygon RPC
export const POLYGON_RPC_URL = NETWORK_CONFIG.rpcUrl;
export const POLYGON_CHAIN_ID = NETWORK_CONFIG.chainId;
export const POLYGONSCAN_URL = NETWORK_CONFIG.explorerUrl;
export const NETWORK_NAME = NETWORK_CONFIG.networkName;

// Warn if mainnet RPC is not set
if (NETWORK_MODE === 'mainnet' && !MAINNET_CONFIG.rpcUrl) {
  console.warn('[GlobalPay] EXPO_PUBLIC_POLYGON_RPC_URL is not set. Blockchain features will fail.');
}

// Log current network
console.log(`[GlobalPay] Network: ${NETWORK_NAME} (Chain ID: ${POLYGON_CHAIN_ID})`);

// ERC-20 ABI (minimal for transfers & balances)
export const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];
