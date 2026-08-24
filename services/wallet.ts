/**
 * WalletService - Creates and manages non-custodial Polygon wallets
 * Private keys are stored locally in SecureStore, never sent to any server
 */
import { ethers } from 'ethers';
import * as SecureStore from '@/services/secure-storage';
import { getRandomBytes } from 'expo-crypto';
import {
  POLYGON_RPC_URLS,
  POLYGON_CHAIN_ID,
  NETWORK_NAME,
  ERC20_ABI,
  TOKENS,
} from '@/constants/tokens';
import { recordWalletCreated, recordWalletImported } from '@/services/security/instrument';
import type { SupportedToken, TokenBalance } from '@/types';

const ACTIVE_USER_KEY = 'globalpay_active_wallet_user';
const walletKeyForUser = (userId: string) => `globalpay_wallet_pk_${userId}`;

/**
 * Build a provider that survives a dead RPC endpoint.
 *
 * Two things are going on here, and they fix two different failures:
 *
 * 1. **The network is declared, not discovered.** By default ethers probes the
 *    endpoint for its chain id before it will do anything, and if that probe
 *    fails it retries forever — the symptom is an endless
 *    "failed to detect network and cannot start up" loop, with every balance
 *    and transfer silently dead behind it. We already know we are on chain
 *    80002, so we say so. `staticNetwork` also removes a round-trip from every
 *    cold start.
 *
 * 2. **No single endpoint is trusted.** FallbackProvider races the configured
 *    endpoints and, with `quorum: 1`, accepts the first good answer instead of
 *    waiting for agreement — appropriate here because these are all views onto
 *    the same public chain, not independent authorities. A stalled endpoint is
 *    abandoned after `stallTimeout` and the next one takes over, so one dead
 *    public RPC degrades latency rather than breaking the app.
 */
function buildProvider(): ethers.AbstractProvider {
  const network = new ethers.Network(NETWORK_NAME, POLYGON_CHAIN_ID);

  const configs = POLYGON_RPC_URLS.map((url, index) => ({
    provider: new ethers.JsonRpcProvider(url, network, { staticNetwork: network }),
    // Lower priority number is preferred, so list order is honoured.
    priority: index + 1,
    weight: 1,
    stallTimeout: 2500,
  }));

  if (configs.length === 0) {
    throw new Error('[GlobalPay] No RPC endpoints configured — blockchain features cannot start.');
  }

  // FallbackProvider needs at least two backends to have anything to fall back
  // to; with one configured endpoint it would add overhead and no resilience.
  if (configs.length === 1) return configs[0].provider;

  return new ethers.FallbackProvider(configs, network, { quorum: 1 });
}

class WalletService {
  private provider: ethers.AbstractProvider;

  constructor() {
    this.provider = buildProvider();
  }

  /**
   * Expose the provider for external use (e.g. reading tx receipts)
   */
  getProvider(): ethers.AbstractProvider {
    return this.provider;
  }

  /**
   * Set the currently active user so send/signer methods can resolve the right key.
   */
  async setActiveUser(userId: string): Promise<void> {
    await SecureStore.setItemAsync(ACTIVE_USER_KEY, userId);
  }

  /**
   * Clear active user marker on sign-out while keeping per-user wallet keys intact.
   */
  async clearActiveUser(): Promise<void> {
    await SecureStore.deleteItemAsync(ACTIVE_USER_KEY);
  }

  private async resolveUserId(userId?: string): Promise<string | null> {
    if (userId) return userId;
    return SecureStore.getItemAsync(ACTIVE_USER_KEY);
  }

  private async getPrivateKey(userId?: string): Promise<string | null> {
    const resolvedUserId = await this.resolveUserId(userId);
    if (!resolvedUserId) return null;
    return SecureStore.getItemAsync(walletKeyForUser(resolvedUserId));
  }

  /**
   * Create a new wallet and store the private key securely.
   * Uses expo-crypto for entropy to bypass ethers' missing crypto.getRandomValues on RN.
   */
  async createWallet(userId: string): Promise<{ address: string; mnemonic: string }> {
    // Generate 16 bytes of secure entropy using expo-crypto (→ 12-word mnemonic)
    const entropy = getRandomBytes(16);
    const mnemonic = ethers.Mnemonic.fromEntropy(entropy);
    const wallet = ethers.HDNodeWallet.fromMnemonic(mnemonic);

    await SecureStore.setItemAsync(walletKeyForUser(userId), wallet.privateKey);
    await this.setActiveUser(userId);

    // Instrumented here rather than at the four call sites in auth-service, so
    // no future sign-up path can silently create a wallet without a record.
    recordWalletCreated(userId);

    return {
      address: wallet.address,
      mnemonic: mnemonic.phrase,
    };
  }

  /**
   * Import a wallet from a private key or mnemonic
   */
  async importWallet(userId: string, keyOrMnemonic: string): Promise<string> {
    let wallet: ethers.Wallet | ethers.HDNodeWallet;

    if (keyOrMnemonic.includes(' ')) {
      // Mnemonic phrase
      wallet = ethers.Wallet.fromPhrase(keyOrMnemonic);
    } else {
      // Private key
      wallet = new ethers.Wallet(keyOrMnemonic);
    }

    await SecureStore.setItemAsync(walletKeyForUser(userId), wallet.privateKey);
    await this.setActiveUser(userId);
    recordWalletImported(userId);
    return wallet.address;
  }

  /**
   * Get the stored wallet address (without exposing private key)
   */
  async getWalletAddress(userId?: string): Promise<string | null> {
    const pk = await this.getPrivateKey(userId);
    if (!pk) return null;

    const wallet = new ethers.Wallet(pk);
    return wallet.address;
  }

  /**
   * Get the signer (wallet connected to provider) for transactions
   */
  async getSigner(userId?: string): Promise<ethers.Wallet | null> {
    const pk = await this.getPrivateKey(userId);
    if (!pk) return null;

    return new ethers.Wallet(pk, this.provider);
  }

  /**
   * Check if a wallet exists locally
   */
  async hasWallet(userId?: string): Promise<boolean> {
    const pk = await this.getPrivateKey(userId);
    return !!pk;
  }

  /**
   * Read private key for backup/export flows after user authentication.
   */
  async getPrivateKeyForExport(userId?: string): Promise<string | null> {
    return this.getPrivateKey(userId);
  }

  /**
   * Get MATIC (native token) balance
   */
  async getMaticBalance(address: string): Promise<string> {
    try {
      const balance = await this.provider.getBalance(address);
      return ethers.formatEther(balance);
    } catch {
      return '0.0';
    }
  }

  /**
   * Get ERC-20 token balance
   */
  async getTokenBalance(
    tokenSymbol: SupportedToken,
    walletAddress: string,
  ): Promise<string> {
    try {
      const config = TOKENS[tokenSymbol];
      if (tokenSymbol === 'MATIC') {
        return this.getMaticBalance(walletAddress);
      }

      const contract = new ethers.Contract(
        config.contractAddress,
        ERC20_ABI,
        this.provider,
      );
      const balance = await contract.balanceOf(walletAddress);
      return ethers.formatUnits(balance, config.decimals);
    } catch {
      return '0.0';
    }
  }

  /**
   * Get all token balances
   */
  async getAllBalances(walletAddress: string): Promise<TokenBalance[]> {
    const tokens = Object.values(TOKENS);
    const balances: TokenBalance[] = [];

    for (const token of tokens) {
      const balance = await this.getTokenBalance(token.symbol, walletAddress);
      balances.push({
        token: token.symbol,
        symbol: token.symbol,
        name: token.name,
        balance,
        balanceFormatted: parseFloat(balance).toFixed(
          token.symbol === 'ETH' || token.symbol === 'MATIC' ? 4 : 2,
        ),
        balanceUsd: '0.00', // will be computed with price feed
        decimals: token.decimals,
        iconUrl: token.iconEmoji,
      });
    }

    return balances;
  }

  /**
   * Send ERC-20 token (with 60s timeout on confirmation)
   */
  async sendToken(
    tokenSymbol: SupportedToken,
    toAddress: string,
    amount: string,
    userId?: string,
  ): Promise<string> {
    const signer = await this.getSigner(userId);
    if (!signer) throw new Error('No wallet found');

    const config = TOKENS[tokenSymbol];
    const TX_TIMEOUT_MS = 60_000; // 60 seconds

    const waitWithTimeout = async (tx: ethers.TransactionResponse): Promise<string> => {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(
          `Transaction submitted (${tx.hash.slice(0, 12)}...) but confirmation timed out after 60s. ` +
          `It may still confirm — check the Activity tab or PolygonScan.`
        )), TX_TIMEOUT_MS),
      );
      await Promise.race([tx.wait(), timeout]);
      return tx.hash;
    };

    if (tokenSymbol === 'MATIC') {
      // Native MATIC transfer
      const tx = await signer.sendTransaction({
        to: toAddress,
        value: ethers.parseEther(amount),
      });
      return waitWithTimeout(tx);
    }

    // ERC-20 transfer
    const contract = new ethers.Contract(
      config.contractAddress,
      ERC20_ABI,
      signer,
    );
    const parsedAmount = ethers.parseUnits(amount, config.decimals);
    const tx = await contract.transfer(toAddress, parsedAmount);
    return waitWithTimeout(tx);
  }

  /**
   * Delete local wallet (logout)
   */
  async deleteWallet(userId?: string): Promise<void> {
    const resolvedUserId = await this.resolveUserId(userId);
    if (!resolvedUserId) return;
    await SecureStore.deleteItemAsync(walletKeyForUser(resolvedUserId));
  }
}

export const walletService = new WalletService();
