/**
 * Send Money Screen - Send crypto to a GlobalPay ID or wallet address (dark theme)
 * Enhanced with gas fee estimation and slow/normal/fast speed options
 */
import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/context/auth-context';
import { useAppLock } from '@/context/app-lock-context';
import { walletService } from '@/services/wallet';
import { priceService } from '@/services/price';
import { supabase } from '@/supabase';
import { GP } from '@/constants/colors';
import { TOKENS, DEFAULT_TOKEN } from '@/constants/tokens';
import type { SupportedToken, TokenPrice } from '@/types';

type GasSpeed = 'slow' | 'normal' | 'fast';

interface GasFeeEstimate {
  speed: GasSpeed;
  label: string;
  gasPrice: bigint;
  estimatedFee: string;
  estimatedFeeUsd: string;
  timeEstimate: string;
}

export default function SendScreen() {
  const { user } = useAuth();
  const { authenticateForAction, isLockEnabled } = useAppLock();
  const router = useRouter();
  const params = useLocalSearchParams<{ recipient?: string; amount?: string; token?: string }>();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [selectedToken, setSelectedToken] = useState<SupportedToken>(DEFAULT_TOKEN);
  const [loading, setLoading] = useState(false);
  const [balance, setBalance] = useState<string | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [prices, setPrices] = useState<TokenPrice[]>([]);

  // Gas fee state
  const [gasEstimates, setGasEstimates] = useState<GasFeeEstimate[]>([]);
  const [selectedGasSpeed, setSelectedGasSpeed] = useState<GasSpeed>('normal');
  const [loadingGas, setLoadingGas] = useState(false);

  const lastSendTime = useRef<number>(0);
  const SEND_COOLDOWN_MS = 15_000;
  const DAILY_MAX_TX = 20;
  const LARGE_AMOUNT_USD_THRESHOLD = 500;

  // Estimated gas units for different transaction types
  const GAS_LIMIT_NATIVE = 21000n; // Native transfer
  const GAS_LIMIT_ERC20 = 65000n; // ERC-20 transfer

  // Fetch balance when token changes
  useEffect(() => {
    if (!user?.walletAddress) return;
    let cancelled = false;
    setLoadingBalance(true);
    walletService.getTokenBalance(selectedToken, user.walletAddress).then((bal) => {
      if (!cancelled) {
        setBalance(bal);
        setLoadingBalance(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setBalance(null);
        setLoadingBalance(false);
      }
    });
    return () => { cancelled = true; };
  }, [selectedToken, user?.walletAddress]);

  // Fetch gas estimates
  useEffect(() => {
    let cancelled = false;

    const fetchGasEstimates = async () => {
      setLoadingGas(true);
      try {
        const provider = walletService.getProvider();
        const feeData = await provider.getFeeData();
        const maticPrice = await priceService.getPrice('MATIC');

        const gasLimit = selectedToken === 'MATIC' ? GAS_LIMIT_NATIVE : GAS_LIMIT_ERC20;

        // Calculate gas prices for different speeds
        const baseGasPrice = feeData.gasPrice ?? 30000000000n; // 30 gwei fallback
        const maxPriorityFee = feeData.maxPriorityFeePerGas ?? 30000000000n;

        const estimates: GasFeeEstimate[] = [
          {
            speed: 'slow',
            label: '🐢 Slow',
            gasPrice: baseGasPrice * 80n / 100n, // 80% of base
            estimatedFee: '0',
            estimatedFeeUsd: '0',
            timeEstimate: '~5 min',
          },
          {
            speed: 'normal',
            label: '⚡ Normal',
            gasPrice: baseGasPrice, // 100% of base
            estimatedFee: '0',
            estimatedFeeUsd: '0',
            timeEstimate: '~30 sec',
          },
          {
            speed: 'fast',
            label: '🚀 Fast',
            gasPrice: baseGasPrice * 150n / 100n, // 150% of base
            estimatedFee: '0',
            estimatedFeeUsd: '0',
            timeEstimate: '~10 sec',
          },
        ];

        // Calculate fees
        const { ethers } = await import('ethers');
        for (const estimate of estimates) {
          const feeWei = estimate.gasPrice * gasLimit;
          const feeMatic = ethers.formatEther(feeWei);
          const feeUsd = (parseFloat(feeMatic) * maticPrice.priceUsd).toFixed(4);
          estimate.estimatedFee = parseFloat(feeMatic).toFixed(6);
          estimate.estimatedFeeUsd = feeUsd;
        }

        if (!cancelled) {
          setGasEstimates(estimates);
        }
      } catch (e) {
        console.warn('[Send] Gas estimation failed:', e);
        if (!cancelled) {
          setGasEstimates([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingGas(false);
        }
      }
    };

    fetchGasEstimates();
    const interval = setInterval(fetchGasEstimates, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedToken]);

  // Keep live rates visible while user chooses amount/token
  useEffect(() => {
    let cancelled = false;

    const loadPrices = async () => {
      const next = await priceService.getAllPrices();
      if (!cancelled) setPrices(next);
    };

    loadPrices();
    const interval = setInterval(loadPrices, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Pre-fill from scan QR or deep link
  useEffect(() => {
    if (params.recipient) setRecipient(params.recipient);
    if (params.amount) setAmount(params.amount);
    if (params.token && params.token in TOKENS) setSelectedToken(params.token as SupportedToken);
  }, [params.recipient, params.amount, params.token]);

  // Calculate total cost
  const calculateTotalCost = (): { totalUsd: string; amountUsd: string; feeUsd: string } => {
    const selectedGasEstimate = gasEstimates.find(e => e.speed === selectedGasSpeed);
    const tokenPrice = prices.find(p => p.token === selectedToken);

    const amountValue = parseFloat(amount) || 0;
    const amountUsd = tokenPrice ? (amountValue * tokenPrice.priceUsd).toFixed(2) : '0.00';
    const feeUsd = selectedGasEstimate?.estimatedFeeUsd || '0.00';
    const totalUsd = (parseFloat(amountUsd) + parseFloat(feeUsd)).toFixed(2);

    return { totalUsd, amountUsd, feeUsd };
  };

  const resolveRecipient = async (): Promise<{ address: string; gpId?: string } | null> => {
    if (recipient.startsWith('0x') && recipient.length === 42) {
      const { data } = await supabase
        .from('users')
        .select('global_pay_id')
        .eq('wallet_address', recipient)
        .single();
      return { address: recipient, gpId: data?.global_pay_id };
    }

    const gpId = recipient.includes('@') ? recipient : `${recipient}@globalpay`;

    const { data, error } = await supabase
      .from('users')
      .select('wallet_address, global_pay_id')
      .eq('global_pay_id', gpId)
      .single();

    if (error || !data) {
      return null;
    }

    return { address: data.wallet_address, gpId: data.global_pay_id };
  };

  const handleSend = async () => {
    if (!user) {
      Alert.alert('Error', 'You are not signed in. Please sign in again.');
      return;
    }

    const now = Date.now();
    const elapsed = now - lastSendTime.current;
    if (elapsed < SEND_COOLDOWN_MS) {
      const remaining = Math.ceil((SEND_COOLDOWN_MS - elapsed) / 1000);
      Alert.alert('Please Wait', `For your security, please wait ${remaining} seconds before sending again.`);
      return;
    }

    if (!recipient || !amount) {
      Alert.alert('Error', 'Please enter recipient and amount');
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      Alert.alert('Error', 'Please enter a valid amount');
      return;
    }

    if (loadingBalance) {
      Alert.alert('Please Wait', 'Balance is still loading. Try again in a moment.');
      return;
    }
    if (balance !== null) {
      const availableBalance = parseFloat(balance);
      if (parsedAmount > availableBalance) {
        Alert.alert(
          'Insufficient Balance',
          `You have ${parseFloat(balance).toFixed(6)} ${selectedToken} but are trying to send ${amount} ${selectedToken}.`,
        );
        return;
      }
    } else {
      Alert.alert(
        'Balance Unavailable',
        'Could not verify your balance. The transaction may fail if you have insufficient funds. Continue anyway?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Continue', onPress: () => executeSend() },
        ],
      );
      return;
    }

    executeSend();
  };

  const checkDailyVelocity = async (): Promise<boolean> => {
    const key = `gp_daily_sends_${new Date().toISOString().slice(0, 10)}`;
    const raw = await AsyncStorage.getItem(key);
    const count = raw ? parseInt(raw, 10) : 0;
    if (count >= DAILY_MAX_TX) {
      Alert.alert('Daily Limit Reached', `For your security, you can only send ${DAILY_MAX_TX} transactions per day. Try again tomorrow.`);
      return false;
    }
    return true;
  };

  const incrementDailySendCount = async () => {
    const key = `gp_daily_sends_${new Date().toISOString().slice(0, 10)}`;
    const raw = await AsyncStorage.getItem(key);
    const count = raw ? parseInt(raw, 10) : 0;
    await AsyncStorage.setItem(key, String(count + 1));
  };

  const executeSend = async () => {
    if (isLockEnabled) {
      const authed = await authenticateForAction('Authenticate to send payment');
      if (!authed) {
        Alert.alert('Authentication Required', 'You must authenticate to send a transaction.');
        return;
      }
    }

    const allowed = await checkDailyVelocity();
    if (!allowed) return;

    setLoading(true);

    try {
      const resolved = await resolveRecipient();
      if (!resolved) {
        Alert.alert('Error', 'Could not find recipient. Check the GlobalPay ID or address.');
        setLoading(false);
        return;
      }

      const { totalUsd, amountUsd, feeUsd } = calculateTotalCost();
      const selectedGasEstimate = gasEstimates.find(e => e.speed === selectedGasSpeed);
      let maticPrice = 0;
      try {
        const maticPriceData = await priceService.getPrice('MATIC');
        maticPrice = maticPriceData.priceUsd;
      } catch {}

      const displayRecipient = resolved.gpId || resolved.address.slice(0, 10) + '...';
      const gasLine = selectedGasEstimate ? `\nGas fee: ~$${feeUsd} (${selectedGasEstimate.label})` : '';
      const totalLine = `\nTotal: ~$${totalUsd} USD`;

      const usdValue = parseFloat(amountUsd);
      if (usdValue > LARGE_AMOUNT_USD_THRESHOLD) {
        const confirmLarge = await new Promise<boolean>((resolve) => {
          Alert.alert(
            '⚠️ Large Transaction',
            `This transaction is worth ~$${amountUsd} USD, which exceeds $${LARGE_AMOUNT_USD_THRESHOLD}. Are you absolutely sure?`,
            [
              { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Proceed', style: 'destructive', onPress: () => resolve(true) },
            ],
          );
        });
        if (!confirmLarge) {
          setLoading(false);
          return;
        }
      }

      Alert.alert(
        'Confirm Send',
        `Send ${amount} ${selectedToken} to ${displayRecipient}?\n\nAmount: ~$${amountUsd}${gasLine}${totalLine}`,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => setLoading(false) },
          {
            text: 'Send',
            onPress: async () => {
              try {
                const txHash = await walletService.sendToken(
                  selectedToken,
                  resolved!.address,
                  amount,
                  user?.id,
                );

                let feeEth = '0';
                let actualFeeUsd = '0';
                try {
                  const provider = walletService.getProvider();
                  const receipt = await provider.getTransactionReceipt(txHash);
                  if (receipt) {
                    const gasUsed = receipt.gasUsed;
                    const gasPrice = receipt.gasPrice ?? receipt.gasPrice;
                    if (gasUsed && gasPrice) {
                      const { ethers } = await import('ethers');
                      feeEth = ethers.formatEther(gasUsed * gasPrice);
                      actualFeeUsd = (parseFloat(feeEth) * maticPrice).toFixed(4);
                    }
                  }
                } catch (feeErr) {
                  console.warn('[Send] Fee estimation failed:', feeErr);
                }

                try {
                  await supabase.from('transactions').insert({
                    from_address: user?.walletAddress,
                    to_address: resolved!.address,
                    from_global_pay_id: user?.globalPayId,
                    to_global_pay_id: resolved!.gpId ?? null,
                    amount,
                    token: selectedToken,
                    amount_usd: amountUsd !== '0' ? amountUsd : null,
                    fee: feeEth !== '0' ? feeEth : null,
                    fee_usd: actualFeeUsd !== '0' ? actualFeeUsd : null,
                    tx_hash: txHash,
                    note: note || null,
                    status: 'confirmed',
                  });
                } catch (dbErr) {
                  console.warn('[Send] Failed to record transaction:', dbErr);
                }

                const feeDisplay = actualFeeUsd !== '0' ? `\nFee: ~$${actualFeeUsd}` : '';
                lastSendTime.current = Date.now();
                await incrementDailySendCount();
                Alert.alert('Success! ✅', `Sent ${amount} ${selectedToken} (~$${amountUsd})${feeDisplay}\nTx: ${txHash.slice(0, 12)}...`, [
                  { text: 'Done', onPress: () => router.back() },
                ]);
              } catch (e: any) {
                Alert.alert('Transaction failed', e.message ?? 'Unknown error');
              } finally {
                setLoading(false);
              }
            },
          },
        ],
      );
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Unknown error');
      setLoading(false);
    }
  };

  const { totalUsd, amountUsd, feeUsd } = calculateTotalCost();

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Recipient */}
        <View style={styles.section}>
          <Text style={styles.label}>Send to</Text>
          <TextInput
            style={styles.input}
            placeholder="username@globalpay or 0x..."
            placeholderTextColor={GP.inputPlaceholder}
            autoCapitalize="none"
            autoCorrect={false}
            value={recipient}
            onChangeText={setRecipient}
            accessibilityLabel="Recipient"
            accessibilityRole="text"
            accessibilityHint="Enter a GlobalPay ID or wallet address"
          />
        </View>

        {/* Amount */}
        <View style={styles.section}>
          <Text style={styles.label}>Amount</Text>
          <View style={styles.amountRow}>
            <TextInput
              style={styles.amountInput}
              placeholder="0.00"
              placeholderTextColor={GP.inputPlaceholder}
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={setAmount}
              accessibilityLabel="Amount"
              accessibilityRole="text"
              accessibilityHint="Enter the amount of crypto to send"
            />
            <View style={styles.tokenBadge}>
              <Text style={styles.amountToken}>{selectedToken}</Text>
            </View>
          </View>
          <View style={styles.balanceRow}>
            <Text style={styles.balanceLabel}>Available:</Text>
            <Text
              style={[
                styles.balanceValue,
                amount && balance !== null && parseFloat(amount) > parseFloat(balance)
                  ? styles.balanceInsufficient
                  : null,
              ]}>
              {loadingBalance
                ? 'Loading...'
                : balance !== null
                  ? `${parseFloat(balance).toFixed(6)} ${selectedToken}`
                  : '—'}
            </Text>
          </View>
          {amount && balance !== null && parseFloat(amount) > parseFloat(balance) && (
            <Text style={styles.insufficientText}>Insufficient balance</Text>
          )}
        </View>

        {/* Token selector */}
        <View style={styles.section}>
          <Text style={styles.label}>Token</Text>
          <View style={styles.tokenGrid}>
            {Object.values(TOKENS).map((t) => (
              <TouchableOpacity
                key={t.symbol}
                style={[
                  styles.tokenChip,
                  selectedToken === t.symbol && styles.tokenChipActive,
                ]}
                onPress={() => setSelectedToken(t.symbol)}>
                <Text style={styles.tokenChipEmoji}>{t.iconEmoji}</Text>
                <Text
                  style={[
                    styles.tokenChipText,
                    selectedToken === t.symbol && styles.tokenChipTextActive,
                  ]}>
                  {t.symbol}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Gas Speed Selector */}
        <View style={styles.section}>
          <Text style={styles.label}>Transaction Speed</Text>
          {loadingGas ? (
            <View style={styles.gasLoadingContainer}>
              <ActivityIndicator size="small" color={GP.primary} />
              <Text style={styles.gasLoadingText}>Fetching gas prices...</Text>
            </View>
          ) : gasEstimates.length > 0 ? (
            <View style={styles.gasGrid}>
              {gasEstimates.map((estimate) => (
                <TouchableOpacity
                  key={estimate.speed}
                  style={[
                    styles.gasChip,
                    selectedGasSpeed === estimate.speed && styles.gasChipActive,
                  ]}
                  onPress={() => setSelectedGasSpeed(estimate.speed)}>
                  <Text style={styles.gasChipLabel}>{estimate.label}</Text>
                  <Text style={styles.gasChipFee}>${estimate.estimatedFeeUsd}</Text>
                  <Text style={styles.gasChipTime}>{estimate.timeEstimate}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <Text style={styles.gasUnavailable}>Gas estimation unavailable</Text>
          )}
        </View>

        {/* Cost Summary */}
        {amount && parseFloat(amount) > 0 && (
          <View style={styles.section}>
            <Text style={styles.label}>Cost Summary</Text>
            <View style={styles.costCard}>
              <View style={styles.costRow}>
                <Text style={styles.costLabel}>Amount</Text>
                <Text style={styles.costValue}>${amountUsd}</Text>
              </View>
              <View style={styles.costRow}>
                <Text style={styles.costLabel}>Gas Fee</Text>
                <Text style={styles.costValue}>${feeUsd}</Text>
              </View>
              <View style={styles.costDivider} />
              <View style={styles.costRow}>
                <Text style={styles.costTotalLabel}>Total</Text>
                <Text style={styles.costTotalValue}>${totalUsd}</Text>
              </View>
            </View>
          </View>
        )}

        {/* Note */}
        <View style={styles.section}>
          <Text style={styles.label}>Note (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="What's this for?"
            placeholderTextColor={GP.inputPlaceholder}
            value={note}
            onChangeText={setNote}
          />
        </View>

        {/* Live rates */}
        <View style={styles.section}>
          <Text style={styles.label}>Live Rates</Text>
          <View style={styles.ratesCard}>
            {prices.length === 0 ? (
              <Text style={styles.ratesEmpty}>Loading rates...</Text>
            ) : (
              prices.map((p) => {
                const up = p.change24h >= 0;
                return (
                  <View key={`send_rate_${p.token}`} style={styles.rateRow}>
                    <Text style={styles.rateToken}>{p.token}</Text>
                    <Text style={styles.ratePrice}>${p.priceUsd.toFixed(p.priceUsd >= 1 ? 2 : 4)}</Text>
                    <Text style={[styles.rateChange, up ? styles.rateChangeUp : styles.rateChangeDown]}>
                      {up ? '+' : ''}{p.change24h.toFixed(2)}%
                    </Text>
                  </View>
                );
              })
            )}
          </View>
        </View>

        {/* Send button */}
        <TouchableOpacity
          style={[styles.sendButton, loading && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel={loading ? 'Sending' : `Send ${amount || '0'} ${selectedToken}`}
          accessibilityHint="Tap to send the specified amount to the recipient">
          <Text style={styles.sendButtonText}>
            {loading ? 'Sending...' : `Send ${amount || '0'} ${selectedToken}`}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GP.background,
  },
  content: {
    padding: 20,
  },
  section: {
    marginBottom: 22,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: GP.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  input: {
    backgroundColor: GP.inputBg,
    borderWidth: 1.5,
    borderColor: GP.inputBorder,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 15,
    fontSize: 16,
    color: GP.inputText,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: GP.inputBg,
    borderWidth: 1.5,
    borderColor: GP.inputBorder,
    borderRadius: 14,
    paddingHorizontal: 16,
  },
  amountInput: {
    flex: 1,
    paddingVertical: 15,
    fontSize: 28,
    fontWeight: '800',
    color: GP.inputText,
  },
  tokenBadge: {
    backgroundColor: GP.surface,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  amountToken: {
    fontSize: 14,
    fontWeight: '700',
    color: GP.primary,
  },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingHorizontal: 4,
  },
  balanceLabel: {
    fontSize: 13,
    color: GP.textMuted,
    fontWeight: '600',
  },
  balanceValue: {
    fontSize: 13,
    color: GP.textSecondary,
    fontWeight: '700',
  },
  balanceInsufficient: {
    color: '#EF6C57',
  },
  insufficientText: {
    color: '#EF6C57',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
    paddingHorizontal: 4,
  },
  tokenGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tokenChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: GP.card,
    borderWidth: 1.5,
    borderColor: GP.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 6,
  },
  tokenChipActive: {
    borderColor: GP.primary,
    backgroundColor: GP.surface,
  },
  tokenChipEmoji: {
    fontSize: 16,
  },
  tokenChipText: {
    fontSize: 14,
    fontWeight: '700',
    color: GP.textSecondary,
  },
  tokenChipTextActive: {
    color: GP.primary,
  },
  gasLoadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: GP.card,
    borderRadius: 14,
    padding: 16,
    gap: 12,
  },
  gasLoadingText: {
    color: GP.textSecondary,
    fontSize: 14,
  },
  gasGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  gasChip: {
    flex: 1,
    backgroundColor: GP.card,
    borderWidth: 1.5,
    borderColor: GP.border,
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
  },
  gasChipActive: {
    borderColor: GP.primary,
    backgroundColor: GP.surface,
  },
  gasChipLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: GP.textPrimary,
    marginBottom: 4,
  },
  gasChipFee: {
    fontSize: 16,
    fontWeight: '800',
    color: GP.primary,
    marginBottom: 2,
  },
  gasChipTime: {
    fontSize: 11,
    color: GP.textMuted,
  },
  gasUnavailable: {
    color: GP.textMuted,
    fontSize: 14,
    padding: 16,
    textAlign: 'center',
  },
  costCard: {
    backgroundColor: GP.card,
    borderWidth: 1,
    borderColor: GP.border,
    borderRadius: 14,
    padding: 16,
  },
  costRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  costLabel: {
    fontSize: 14,
    color: GP.textSecondary,
  },
  costValue: {
    fontSize: 14,
    fontWeight: '600',
    color: GP.textPrimary,
  },
  costDivider: {
    height: 1,
    backgroundColor: GP.border,
    marginVertical: 8,
  },
  costTotalLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: GP.textPrimary,
  },
  costTotalValue: {
    fontSize: 18,
    fontWeight: '800',
    color: GP.primary,
  },
  sendButton: {
    backgroundColor: GP.primary,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 8,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    color: GP.textOnYellow,
    fontSize: 17,
    fontWeight: '800',
  },
  ratesCard: {
    backgroundColor: GP.card,
    borderWidth: 1,
    borderColor: GP.border,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  ratesEmpty: {
    color: GP.textSecondary,
    fontSize: 13,
    paddingVertical: 8,
  },
  rateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: GP.border,
  },
  rateToken: {
    color: GP.textPrimary,
    fontWeight: '700',
    fontSize: 13,
    width: 52,
  },
  ratePrice: {
    color: GP.textSecondary,
    fontSize: 13,
    flex: 1,
    textAlign: 'center',
  },
  rateChange: {
    fontSize: 12,
    fontWeight: '800',
    width: 66,
    textAlign: 'right',
  },
  rateChangeUp: {
    color: GP.success,
  },
  rateChangeDown: {
    color: GP.error,
  },
});
