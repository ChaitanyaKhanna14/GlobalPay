/**
 * PriceService - Fetches real-time token prices from CoinGecko
 */
import { TOKENS } from '@/constants/tokens';
import type { SupportedToken, TokenPrice } from '@/types';

const COINGECKO_API = 'https://api.coingecko.com/api/v3';

class PriceService {
  private cache: Map<string, { price: number; change24h: number; timestamp: number }> = new Map();
  private CACHE_TTL = 30_000; // 30 seconds

  /**
   * Get price for a single token
   */
  async getPrice(token: SupportedToken): Promise<TokenPrice> {
    const cached = this.cache.get(token);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return { token, priceUsd: cached.price, change24h: cached.change24h };
    }

    try {
      const config = TOKENS[token];
      const res = await fetch(
        `${COINGECKO_API}/simple/price?ids=${config.coingeckoId}&vs_currencies=usd&include_24hr_change=true`
      );
      const data = await res.json();
      const priceUsd = data[config.coingeckoId]?.usd ?? 0;
      const change24h = data[config.coingeckoId]?.usd_24h_change ?? 0;

      this.cache.set(token, { price: priceUsd, change24h, timestamp: Date.now() });

      return { token, priceUsd, change24h };
    } catch {
      return { token, priceUsd: 0, change24h: 0 };
    }
  }

  /**
   * Get prices for all supported tokens
   */
  async getAllPrices(): Promise<TokenPrice[]> {
    try {
      const ids = Object.values(TOKENS)
        .map((t) => t.coingeckoId)
        .join(',');

      const res = await fetch(
        `${COINGECKO_API}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`
      );
      const data = await res.json();

      const prices: TokenPrice[] = [];
      for (const [symbol, config] of Object.entries(TOKENS)) {
        const priceUsd = data[config.coingeckoId]?.usd ?? 0;
        const change24h = data[config.coingeckoId]?.usd_24h_change ?? 0;

        this.cache.set(symbol, { price: priceUsd, change24h, timestamp: Date.now() });

        prices.push({
          token: symbol as SupportedToken,
          priceUsd,
          change24h,
        });
      }

      return prices;
    } catch {
      return Object.keys(TOKENS).map((token) => ({
        token: token as SupportedToken,
        priceUsd: 0,
        change24h: 0,
      }));
    }
  }

  /**
   * Convert amount between tokens using cached prices
   */
  async convert(
    fromToken: SupportedToken,
    toToken: SupportedToken,
    amount: number
  ): Promise<{ result: number; rate: number }> {
    const [fromPrice, toPrice] = await Promise.all([
      this.getPrice(fromToken),
      this.getPrice(toToken),
    ]);

    if (toPrice.priceUsd === 0) return { result: 0, rate: 0 };

    const rate = fromPrice.priceUsd / toPrice.priceUsd;
    return { result: amount * rate, rate };
  }
}

export const priceService = new PriceService();
