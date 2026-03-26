/**
 * Home Screen - Dashboard with balance, quick actions, recent activity
 * Dark theme with colorful accent cards
 */
import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  StyleSheet,
  Platform,
  Alert,
  Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useAuth } from '@/context/auth-context';
import { walletService } from '@/services/wallet';
import { priceService } from '@/services/price';
import { supabase } from '@/supabase';
import { GP } from '@/constants/colors';
import { NETWORK_MODE } from '@/constants/tokens';
import { BalanceCardSkeleton, TokenListSkeleton } from '@/components/skeleton';
import MyQRModal from '@/components/my-qr-modal';
import type { TokenBalance, TokenPrice } from '@/types';

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning,';
  if (h < 17) return 'Good afternoon,';
  return 'Good evening,';
}

function formatUsd(price: number): string {
  if (price >= 1000) return price.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(2);
  return price.toFixed(4);
}

export default function HomeScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [prices, setPrices] = useState<TokenPrice[]>([]);
  const [totalUsd, setTotalUsd] = useState('0.00');
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [showQRModal, setShowQRModal] = useState(false);

  const loadData = useCallback(async () => {
    if (!user?.walletAddress) return;

    try {
      const [tokenBalances, tokenPrices] = await Promise.all([
        walletService.getAllBalances(user.walletAddress),
        priceService.getAllPrices(),
      ]);

      let total = 0;
      const enriched = tokenBalances.map((b) => {
        const price = tokenPrices.find((p) => p.token === b.token);
        const usdVal = parseFloat(b.balance) * (price?.priceUsd ?? 0);
        total += usdVal;
        return { ...b, balanceUsd: usdVal.toFixed(2) };
      });

      setBalances(enriched);
      setPrices(tokenPrices);
      setTotalUsd(total.toFixed(2));
    } catch (e) {
      console.warn('Failed to load balances:', e);
    } finally {
      setInitialLoading(false);
    }
  }, [user?.walletAddress]);

  useEffect(() => {
    loadData();
    // Refresh balances & prices every 30 seconds
    const interval = setInterval(loadData, 30_000);
    return () => clearInterval(interval);
  }, [loadData]);

  // ── Realtime: auto-refresh when new transactions involve this wallet ──
  useEffect(() => {
    if (!user?.walletAddress) return;

    const channel = supabase
      .channel('home-transactions')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'transactions',
        },
        (payload) => {
          const row = payload.new as any;
          if (row.from_address === user.walletAddress || row.to_address === user.walletAddress) {
            __DEV__ && console.log('[Realtime] Balance refresh triggered');
            loadData();
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.walletAddress, loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
    {/* My QR Modal */}
    <MyQRModal visible={showQRModal} onClose={() => setShowQRModal(false)} />

    <ScrollView
      style={{ flex: 1, backgroundColor: GP.background }}
      contentContainerStyle={{ paddingTop: 16, paddingBottom: insets.bottom + 20 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GP.primary} />}>
      {/* Testnet Banner */}
      {NETWORK_MODE === 'testnet' && (
        <TouchableOpacity 
          style={styles.testnetBanner}
          onPress={() => {
            Alert.alert(
              '🧪 Get Test Tokens',
              'You need test POL (gas) to send transactions.\n\nYour wallet address has been copied. Paste it in the faucet to receive free test POL.',
              [
                { text: 'Cancel', style: 'cancel' },
                { 
                  text: 'Open Faucet', 
                  onPress: async () => {
                    if (user?.walletAddress) {
                      await Clipboard.setStringAsync(user.walletAddress);
                    }
                    Linking.openURL('https://faucets.chain.link/polygon-amoy');
                  }
                },
              ]
            );
          }}
          activeOpacity={0.7}
        >
          <Ionicons name="flask-outline" size={14} color={GP.textOnYellow} />
          <Text style={styles.testnetText}>Testnet Mode • Tap for Free Tokens</Text>
        </TouchableOpacity>
      )}

      {/* Greeting */}
      <View style={styles.header} accessibilityRole="header" accessibilityLabel={`${getGreeting()} ${user?.displayName ?? 'User'}`}>
        <View>
          <Text style={styles.greeting}>{getGreeting()}</Text>
          <Text style={styles.name}>{user?.displayName ?? 'User'} 👋</Text>
        </View>
        <TouchableOpacity style={styles.avatarCircle} onPress={() => router.push('/(tabs)/profile')} activeOpacity={0.7}>
          <Text style={styles.avatarLetter}>
            {user?.displayName?.charAt(0)?.toUpperCase() ?? '?'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* GlobalPay ID badge */}
      <TouchableOpacity
        style={styles.idBadge}
        onPress={async () => {
          await Clipboard.setStringAsync(user?.globalPayId ?? '');
          Alert.alert('Copied!', 'GlobalPay ID copied to clipboard');
        }}
        activeOpacity={0.7}>
        <Text style={styles.idIcon}>⚡</Text>
        <Text style={styles.idText}>{user?.globalPayId ?? ''}</Text>
        <Ionicons name="copy-outline" size={13} color={GP.textMuted} />
      </TouchableOpacity>

      {/* Balance Card */}
      {initialLoading ? (
        <BalanceCardSkeleton />
      ) : (
      <LinearGradient
        colors={['#2A1B4E', '#1B2D5E', '#1A2845']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.balanceCard}
      >
        <View style={styles.balanceGlow} />
        {/* My QR Button */}
        <TouchableOpacity
          style={styles.myQrButton}
          onPress={() => setShowQRModal(true)}
          accessibilityRole="button"
          accessibilityLabel="Show my QR code"
        >
          <Ionicons name="qr-code" size={20} color={GP.textOnYellow} />
        </TouchableOpacity>
        <Text style={styles.balanceLabel}>Total Balance</Text>
        <Text style={styles.balanceAmount}>${totalUsd}</Text>
        <Text style={styles.walletHint}>
          {user?.walletAddress
            ? `${user.walletAddress.slice(0, 6)}...${user.walletAddress.slice(-4)}`
            : ''}
        </Text>
      </LinearGradient>
      )}

      {/* Quick Actions */}
      <View style={styles.actionsRow}>
        <QuickAction icon="arrow-up" label="Send" color={GP.cardYellow} onPress={() => router.push('/send')} />
        <QuickAction icon="arrow-down" label="Receive" color={GP.cardGreen} onPress={() => router.push('/receive')} />
        <QuickAction icon="scan" label="Scan" color={GP.cardCoral} onPress={() => router.push('/scan')} />
        {NETWORK_MODE === 'testnet' ? (
          <QuickAction 
            icon="water-outline" 
            label="Faucet" 
            color="#9B59B6" 
            onPress={async () => {
              if (user?.walletAddress) {
                await Clipboard.setStringAsync(user.walletAddress);
                Alert.alert(
                  '💧 Wallet Address Copied!',
                  'Opening Chainlink Faucet...\n\nPaste your address to get free test POL.',
                  [{ text: 'OK', onPress: () => Linking.openURL('https://faucets.chain.link/polygon-amoy') }]
                );
              }
            }} 
          />
        ) : (
          <QuickAction icon="cash-outline" label="Request" color={GP.cardOrange} onPress={() => router.push('/request')} />
        )}
      </View>

      {/* Token Balances */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Your Assets</Text>
        {initialLoading ? (
          <TokenListSkeleton count={3} />
        ) : balances.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>📦</Text>
            <Text style={styles.emptyText}>No assets yet</Text>
            <Text style={styles.emptySubtext}>
              Receive crypto to your wallet address or GlobalPay ID to get started
            </Text>
          </View>
        ) : (
          balances.map((b) => (
            <View key={b.token} style={styles.tokenRow}>
              <View style={styles.tokenIconWrap}>
                <Text style={styles.tokenIcon}>{b.iconUrl}</Text>
              </View>
              <View style={styles.tokenInfo}>
                <Text style={styles.tokenName}>{b.name}</Text>
                <Text style={styles.tokenSymbol}>{b.symbol}</Text>
              </View>
              <View style={styles.tokenAmounts}>
                <Text style={styles.tokenBalance}>{b.balanceFormatted}</Text>
                <Text style={styles.tokenUsd}>${b.balanceUsd}</Text>
              </View>
            </View>
          ))
        )}
      </View>

      {/* Live market rates */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Live Market Rates</Text>
        {prices.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>Rates unavailable</Text>
            <Text style={styles.emptySubtext}>Pull to refresh and try again.</Text>
          </View>
        ) : (
          prices.map((p) => {
            const changePositive = p.change24h >= 0;
            return (
              <View key={`rate_${p.token}`} style={styles.rateRow}>
                <View>
                  <Text style={styles.rateToken}>{p.token}</Text>
                  <Text style={styles.rateUsd}>${formatUsd(p.priceUsd)}</Text>
                </View>
                <View style={[styles.rateChangeChip, changePositive ? styles.rateUp : styles.rateDown]}>
                  <Text style={styles.rateChangeText}>
                    {changePositive ? '+' : ''}{p.change24h.toFixed(2)}%
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
    </View>
  );
}

function QuickAction({
  icon,
  label,
  color,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.actionButton}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}`}
      accessibilityHint={`Navigate to ${label} screen`}>
      <View style={[styles.actionIcon, { backgroundColor: color, shadowColor: color }]}>
        <Ionicons name={icon} size={26} color={GP.textOnYellow} />
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GP.background,
  },
  testnetBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GP.warning,
    paddingVertical: 6,
    marginHorizontal: 20,
    marginBottom: 8,
    borderRadius: 8,
    gap: 6,
  },
  testnetText: {
    fontSize: 12,
    fontWeight: '700',
    color: GP.textOnYellow,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  greeting: {
    fontSize: 14,
    color: GP.textSecondary,
  },
  name: {
    fontSize: 26,
    fontWeight: '800',
    color: GP.textPrimary,
    letterSpacing: -0.3,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: GP.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: GP.primary,
  },
  avatarLetter: {
    fontSize: 18,
    fontWeight: '700',
    color: GP.primary,
  },
  idBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: GP.surface,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginLeft: 20,
    marginTop: 4,
    marginBottom: 8,
    gap: 6,
    borderWidth: 1,
    borderColor: GP.border,
  },
  idIcon: {
    fontSize: 14,
  },
  idText: {
    fontSize: 13,
    fontWeight: '700',
    color: GP.primary,
  },
  balanceCard: {
    borderRadius: 22,
    marginHorizontal: 20,
    marginTop: 12,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(242, 201, 76, 0.15)',
    overflow: 'hidden',
    position: 'relative',
  },
  myQrButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(242, 201, 76, 0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  balanceGlow: {
    position: 'absolute',
    top: -30,
    right: -30,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(242, 201, 76, 0.08)',
  },
  balanceLabel: {
    color: GP.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  balanceAmount: {
    color: GP.textPrimary,
    fontSize: 42,
    fontWeight: '800',
    marginTop: 4,
    letterSpacing: -1,
  },
  walletHint: {
    color: GP.textMuted,
    fontSize: 12,
    marginTop: 8,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 16,
    marginTop: 24,
  },
  actionButton: {
    alignItems: 'center',
    gap: 8,
  },
  actionIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  actionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: GP.textSecondary,
  },
  section: {
    marginTop: 28,
    paddingHorizontal: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: GP.textPrimary,
    marginBottom: 12,
    letterSpacing: -0.3,
  },
  emptyCard: {
    backgroundColor: GP.card,
    borderRadius: 18,
    padding: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: GP.border,
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '700',
    color: GP.textPrimary,
  },
  emptySubtext: {
    fontSize: 13,
    color: GP.textSecondary,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 18,
  },
  tokenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: GP.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: GP.border,
  },
  tokenIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: GP.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  tokenIcon: {
    fontSize: 22,
  },
  tokenInfo: {
    flex: 1,
  },
  tokenName: {
    fontSize: 15,
    fontWeight: '700',
    color: GP.textPrimary,
  },
  tokenSymbol: {
    fontSize: 13,
    color: GP.textSecondary,
    marginTop: 1,
  },
  tokenAmounts: {
    alignItems: 'flex-end',
  },
  tokenBalance: {
    fontSize: 15,
    fontWeight: '700',
    color: GP.textPrimary,
  },
  tokenUsd: {
    fontSize: 13,
    color: GP.textSecondary,
    marginTop: 1,
  },
  rateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: GP.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: GP.border,
  },
  rateToken: {
    fontSize: 14,
    fontWeight: '800',
    color: GP.textPrimary,
  },
  rateUsd: {
    fontSize: 13,
    color: GP.textSecondary,
    marginTop: 2,
  },
  rateChangeChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  rateUp: {
    backgroundColor: GP.successLight,
  },
  rateDown: {
    backgroundColor: GP.errorLight,
  },
  rateChangeText: {
    fontSize: 12,
    fontWeight: '800',
    color: GP.textPrimary,
  },
});
