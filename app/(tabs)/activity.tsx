/**
 * Activity Tab - Transaction history + payment requests (dark theme)
 */
import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Alert,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/supabase';
import { walletService } from '@/services/wallet';
import { priceService } from '@/services/price';
import { GP } from '@/constants/colors';
import { TransactionListSkeleton } from '@/components/skeleton';
import type { Transaction, PaymentRequest, SupportedToken } from '@/types';
import {
  isEnrolledWallet,
  UNENROLLED_RECIPIENT_TITLE,
  UNENROLLED_RECIPIENT_MESSAGE,
} from '@/services/security/recipient-guard';

const TX_COLORS = [GP.cardYellow, GP.cardGreen, GP.cardCoral, GP.cardOrange, GP.cardMint];

type Tab = 'transactions' | 'requests';

export default function ActivityScreen() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('transactions');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const loadTransactions = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .or(`from_address.eq.${user.walletAddress},to_address.eq.${user.walletAddress}`)
        .order('created_at', { ascending: false })
        .limit(50);

      if (!error && data) {
        setTransactions(
          data.map((tx: any) => ({
            id: tx.id,
            type: tx.from_address === user.walletAddress ? 'send' : 'receive',
            status: tx.status ?? 'confirmed',
            fromAddress: tx.from_address,
            toAddress: tx.to_address,
            fromGlobalPayId: tx.from_global_pay_id,
            toGlobalPayId: tx.to_global_pay_id,
            amount: tx.amount,
            token: tx.token,
            amountUsd: tx.amount_usd ?? '0',
            fee: tx.fee ?? '0',
            feeUsd: tx.fee_usd ?? '0',
            txHash: tx.tx_hash,
            note: tx.note,
            createdAt: tx.created_at,
            confirmedAt: tx.confirmed_at,
          })),
        );
      }
    } catch (e) {
      console.warn('Failed to load transactions:', e);
      setLoadError(true);
    }
  }, [user]);

  const loadRequests = useCallback(async () => {
    if (!user?.globalPayId) return;
    try {
      const { data, error } = await supabase
        .from('payment_requests')
        .select('*')
        .or(`from_global_pay_id.eq.${user.globalPayId},to_global_pay_id.eq.${user.globalPayId}`)
        .order('created_at', { ascending: false })
        .limit(50);

      if (!error && data) {
        setRequests(
          data.map((r: any) => ({
            id: r.id,
            fromGlobalPayId: r.from_global_pay_id,
            toGlobalPayId: r.to_global_pay_id,
            amount: r.amount,
            token: r.token,
            note: r.note,
            status: r.status,
            expiresAt: r.expires_at,
            createdAt: r.created_at,
          })),
        );
      }
    } catch (e) {
      console.warn('Failed to load requests:', e);
      setLoadError(true);
    }
  }, [user]);

  const loadData = useCallback(async () => {
    setLoadError(false);
    await Promise.all([loadTransactions(), loadRequests()]);
    setInitialLoading(false);
  }, [loadTransactions, loadRequests]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Supabase Realtime subscriptions ──
  useEffect(() => {
    if (!user?.walletAddress || !user?.globalPayId) return;

    // Subscribe to new transactions involving this user
    const txChannel = supabase
      .channel('activity-transactions')
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
            __DEV__ && console.log('[Realtime] New transaction detected');
            loadTransactions();
          }
        },
      )
      .subscribe();

    // Subscribe to payment request changes (new, status updates)
    const reqChannel = supabase
      .channel('activity-requests')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'payment_requests',
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as any;
          if (
            row?.from_global_pay_id === user.globalPayId ||
            row?.to_global_pay_id === user.globalPayId
          ) {
            __DEV__ && console.log('[Realtime] Payment request change detected');
            loadRequests();
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(txChannel);
      supabase.removeChannel(reqChannel);
    };
  }, [user?.walletAddress, user?.globalPayId, loadTransactions, loadRequests]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleDeclineRequest = async (requestId: string) => {
    Alert.alert('Decline Request', 'Are you sure you want to decline this request?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Decline',
        style: 'destructive',
        onPress: async () => {
          try {
            const { error } = await supabase
              .from('payment_requests')
              .update({ status: 'declined' })
              .eq('id', requestId);

            if (error) {
              Alert.alert('Error', error.message);
            } else {
              Alert.alert('Declined', 'Payment request declined.');
              loadRequests();
            }
          } catch (e: any) {
            Alert.alert('Error', e.message ?? 'Failed to decline request. Check your connection.');
          }
        },
      },
    ]);
  };

  const [paying, setPaying] = useState<string | null>(null);

  const handlePayRequest = async (request: PaymentRequest) => {
    if (!user) {
      Alert.alert('Error', 'You are not signed in.');
      return;
    }

    try {
    // Resolve the requester's wallet address from their GP ID
    const { data: requesterData, error: lookupErr } = await supabase
      .from('users')
      .select('wallet_address, global_pay_id')
      .eq('global_pay_id', request.fromGlobalPayId)
      .single();

    if (lookupErr || !requesterData) {
      Alert.alert('Error', 'Could not find the requester\'s wallet. They may have deleted their account.');
      return;
    }

    // Same guard as the send screen: a profile can exist before its owner has
    // enrolled a device, and its placeholder wallet must never receive funds.
    if (!isEnrolledWallet(requesterData.wallet_address)) {
      Alert.alert(UNENROLLED_RECIPIENT_TITLE, UNENROLLED_RECIPIENT_MESSAGE);
      return;
    }

    // Check balance before paying
    try {
      const bal = await walletService.getTokenBalance(request.token as SupportedToken, user!.walletAddress);
      const available = parseFloat(bal);
      const needed = parseFloat(request.amount);
      if (needed > available) {
        Alert.alert(
          'Insufficient Balance',
          `You have ${available.toFixed(6)} ${request.token} but the request is for ${request.amount} ${request.token}.`,
        );
        return;
      }
    } catch {
      // Balance check failed — warn but allow
      const proceed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          'Balance Unavailable',
          'Could not verify your balance. The transaction may fail. Continue anyway?',
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Continue', onPress: () => resolve(true) },
          ],
        );
      });
      if (!proceed) return;
    }

    // Get current price for USD tracking
    let amountUsd = '0';
    try {
      const price = await priceService.getPrice(request.token as SupportedToken);
      amountUsd = (parseFloat(request.amount) * price.priceUsd).toFixed(2);
    } catch {}

    Alert.alert(
      'Pay Request',
      `Send ${request.amount} ${request.token} to ${request.fromGlobalPayId}?${request.note ? `\n\nNote: ${request.note}` : ''}${amountUsd !== '0' ? `\n\nValue: ~$${amountUsd}` : ''}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Pay Now',
          onPress: async () => {
            setPaying(request.id);
            try {
              // Send on-chain
              const txHash = await walletService.sendToken(
                request.token as SupportedToken,
                requesterData.wallet_address,
                request.amount,
              );

              // Record the transaction
              try {
                await supabase.from('transactions').insert({
                  from_address: user?.walletAddress,
                  to_address: requesterData.wallet_address,
                  from_global_pay_id: user?.globalPayId,
                  to_global_pay_id: request.fromGlobalPayId,
                  amount: request.amount,
                  token: request.token,
                  amount_usd: amountUsd !== '0' ? amountUsd : null,
                  tx_hash: txHash,
                  note: request.note || `Payment for request`,
                  status: 'confirmed',
                });
              } catch (dbErr) {
                console.warn('[Pay] Failed to record transaction:', dbErr);
              }

              // Update request status to paid
              try {
                await supabase
                  .from('payment_requests')
                  .update({ status: 'paid' })
                  .eq('id', request.id);
              } catch (dbErr) {
                console.warn('[Pay] Failed to update request status:', dbErr);
              }

              Alert.alert('Paid! ✅', `Sent ${request.amount} ${request.token} to ${request.fromGlobalPayId}\nTx: ${txHash.slice(0, 12)}...`);
              loadData();
            } catch (e: any) {
              Alert.alert('Payment Failed', e.message ?? 'Unknown error during payment');
            } finally {
              setPaying(null);
            }
          },
        },
      ],
    );
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Something went wrong. Check your connection and try again.');
    }
  };

  const renderTxItem = ({ item, index }: { item: Transaction; index: number }) => {
    const isSend = item.type === 'send';
    const counterpartyId = isSend ? item.toGlobalPayId : item.fromGlobalPayId;
    const counterpartyAddr = isSend ? item.toAddress : item.fromAddress;
    const displayName = counterpartyId || `${counterpartyAddr?.slice(0, 6)}...${counterpartyAddr?.slice(-4)}`;
    const cardColor = TX_COLORS[index % TX_COLORS.length];

    return (
      <View style={[styles.txCard, { backgroundColor: cardColor }]}>
        <View style={styles.txHeader}>
          <View style={styles.txDirectionBadge}>
            <Text style={styles.txArrow}>{isSend ? '↗' : '↙'}</Text>
          </View>
          <Text style={styles.txName} numberOfLines={1}>{displayName}</Text>
        </View>
        <View style={styles.txBottom}>
          <Text style={styles.txDate}>
            {new Date(item.createdAt).toLocaleDateString()} · {item.token}
            {item.note ? ` · ${item.note}` : ''}
          </Text>
          <Text style={styles.txAmount}>
            {isSend ? '-' : '+'}{item.amount} {item.token}
          </Text>
        </View>
      </View>
    );
  };

  const renderRequestItem = ({ item, index }: { item: PaymentRequest; index: number }) => {
    const isIncoming = item.toGlobalPayId === user?.globalPayId;
    const counterparty = isIncoming ? item.fromGlobalPayId : item.toGlobalPayId;
    const cardColor = TX_COLORS[index % TX_COLORS.length];
    const isPending = item.status === 'pending';

    return (
      <View style={[styles.txCard, { backgroundColor: cardColor }]}>
        <View style={styles.txHeader}>
          <View style={styles.txDirectionBadge}>
            <Text style={styles.txArrow}>{isIncoming ? '🔔' : '📤'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.txName} numberOfLines={1}>
              {isIncoming ? `From ${counterparty}` : `To ${counterparty}`}
            </Text>
            <Text style={[styles.txDate, { marginTop: 2 }]}>
              {item.amount} {item.token} · {item.status}
              {item.note ? ` · ${item.note}` : ''}
            </Text>
          </View>
        </View>
        {isIncoming && isPending && (
          <View style={styles.requestActions}>
            <TouchableOpacity
              style={styles.declineBtn}
              onPress={() => handleDeclineRequest(item.id)}>
              <Text style={styles.declineBtnText}>Decline</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.payBtn, paying === item.id && { opacity: 0.5 }]}
              onPress={() => handlePayRequest(item)}
              disabled={paying === item.id}>
              <Text style={styles.payBtnText}>
                {paying === item.id ? 'Paying...' : 'Pay'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const activeData = tab === 'transactions' ? transactions : requests;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <Text style={styles.title}>Activity</Text>

      {/* Tab Switcher */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'transactions' && styles.tabBtnActive]}
          onPress={() => setTab('transactions')}>
          <Text style={[styles.tabText, tab === 'transactions' && styles.tabTextActive]}>
            Transactions
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'requests' && styles.tabBtnActive]}
          onPress={() => setTab('requests')}>
          <Text style={[styles.tabText, tab === 'requests' && styles.tabTextActive]}>
            Requests{requests.filter(r => r.status === 'pending').length > 0
              ? ` (${requests.filter(r => r.status === 'pending').length})`
              : ''}
          </Text>
        </TouchableOpacity>
      </View>

      {initialLoading ? (
        <View style={styles.listContent}>
          <TransactionListSkeleton count={5} />
        </View>
      ) : (
      <FlatList
        data={activeData as any[]}
        keyExtractor={(item) => item.id}
        renderItem={tab === 'transactions' ? renderTxItem : renderRequestItem as any}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GP.primary} />
        }
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>{loadError ? '⚠️' : tab === 'transactions' ? '📋' : '🔔'}</Text>
            <Text style={styles.emptyTitle}>
              {loadError
                ? 'Failed to load'
                : tab === 'transactions' ? 'No transactions yet' : 'No requests yet'}
            </Text>
            <Text style={styles.emptySubtitle}>
              {loadError
                ? 'Check your internet connection and pull down to refresh'
                : tab === 'transactions'
                  ? 'Your payments and transfers will appear here'
                  : 'Payment requests will appear here'}
            </Text>
          </View>
        }
      />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GP.background,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: GP.textPrimary,
    paddingHorizontal: 20,
    paddingBottom: 16,
    letterSpacing: -0.3,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  txCard: {
    borderRadius: 18,
    padding: 18,
    marginBottom: 10,
  },
  txHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  txDirectionBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  txArrow: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1A1A1A',
  },
  txName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1A1A',
    flex: 1,
  },
  txBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  txDate: {
    fontSize: 12,
    color: 'rgba(0,0,0,0.5)',
    flex: 1,
  },
  txAmount: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1A1A1A',
  },
  empty: {
    alignItems: 'center',
    paddingTop: 80,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: GP.textPrimary,
  },
  emptySubtitle: {
    fontSize: 14,
    color: GP.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },
  tabRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 16,
    backgroundColor: GP.surface,
    borderRadius: 14,
    padding: 4,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  tabBtnActive: {
    backgroundColor: GP.primary,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '700',
    color: GP.textSecondary,
  },
  tabTextActive: {
    color: GP.textOnYellow,
  },
  requestActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 10,
    gap: 8,
  },
  declineBtn: {
    backgroundColor: 'rgba(0,0,0,0.15)',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  declineBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  payBtn: {
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 10,
    paddingHorizontal: 24,
    paddingVertical: 8,
  },
  payBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});
