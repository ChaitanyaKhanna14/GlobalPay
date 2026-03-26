/**
 * Request Money Screen - Send a payment request to another user
 */
import { useState, useRef, useEffect } from 'react';
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
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/supabase';
import { priceService } from '@/services/price';
import { GP } from '@/constants/colors';
import { TOKENS, DEFAULT_TOKEN } from '@/constants/tokens';
import type { SupportedToken, TokenPrice } from '@/types';

export default function RequestScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [selectedToken, setSelectedToken] = useState<SupportedToken>(DEFAULT_TOKEN);
  const [loading, setLoading] = useState(false);
  const [prices, setPrices] = useState<TokenPrice[]>([]);
  const lastRequestTime = useRef<number>(0);
  const REQUEST_COOLDOWN_MS = 15_000; // 15-second cooldown between requests

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

  const handleRequest = async () => {
    if (!recipient || !amount) {
      Alert.alert('Error', 'Please enter recipient and amount');
      return;
    }

    // Rate limiting — prevent rapid successive requests
    const now = Date.now();
    const elapsed = now - lastRequestTime.current;
    if (elapsed < REQUEST_COOLDOWN_MS) {
      const remaining = Math.ceil((REQUEST_COOLDOWN_MS - elapsed) / 1000);
      Alert.alert('Please Wait', `For your security, please wait ${remaining} seconds before requesting again.`);
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      Alert.alert('Error', 'Please enter a valid amount');
      return;
    }

    setLoading(true);

    try {
      const gpId = recipient.includes('@') ? recipient : `${recipient}@globalpay`;

      // Verify recipient exists
      const { data: recipientUser, error: lookupError } = await supabase
        .from('users')
        .select('id, global_pay_id')
        .eq('global_pay_id', gpId)
        .single();

      if (lookupError || !recipientUser) {
        Alert.alert('Error', 'User not found. Check the GlobalPay ID.');
        setLoading(false);
        return;
      }

      // Create payment request
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 day expiry

      const { error: insertError } = await supabase.from('payment_requests').insert({
        from_global_pay_id: user?.globalPayId,
        to_global_pay_id: gpId,
        amount,
        token: selectedToken,
        note,
        status: 'pending',
        expires_at: expiresAt.toISOString(),
      });

      if (insertError) {
        Alert.alert('Error', insertError.message);
        setLoading(false);
        return;
      }

      Alert.alert('Request Sent! 🔔', `Requested ${amount} ${selectedToken} from ${gpId}`, [
        { text: 'Done', onPress: () => router.back() },
      ]);
      lastRequestTime.current = Date.now();
    } catch (e: any) {
      Alert.alert('Failed', e.message ?? 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Recipient */}
        <View style={styles.section}>
          <Text style={styles.label}>Request from</Text>
          <TextInput
            style={styles.input}
            placeholder="username@globalpay"
            placeholderTextColor={GP.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            value={recipient}
            onChangeText={setRecipient}
          />
        </View>

        {/* Amount */}
        <View style={styles.section}>
          <Text style={styles.label}>Amount</Text>
          <View style={styles.amountRow}>
            <TextInput
              style={styles.amountInput}
              placeholder="0.00"
              placeholderTextColor={GP.textMuted}
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={setAmount}
            />
            <Text style={styles.amountToken}>{selectedToken}</Text>
          </View>
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

        {/* Note */}
        <View style={styles.section}>
          <Text style={styles.label}>Note (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="What's this for?"
            placeholderTextColor={GP.textMuted}
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
                  <View key={`request_rate_${p.token}`} style={styles.rateRow}>
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

        {/* Request button */}
        <TouchableOpacity
          style={[styles.requestButton, loading && styles.requestButtonDisabled]}
          onPress={handleRequest}
          disabled={loading}>
          <Text style={styles.requestButtonText}>
            {loading ? 'Sending request...' : `Request ${amount || '0'} ${selectedToken}`}
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
    marginBottom: 20,
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
    borderWidth: 1,
    borderColor: GP.inputBorder,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: GP.textPrimary,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: GP.inputBg,
    borderWidth: 1,
    borderColor: GP.inputBorder,
    borderRadius: 14,
    paddingHorizontal: 16,
  },
  amountInput: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 28,
    fontWeight: '800',
    color: GP.textPrimary,
  },
  amountToken: {
    fontSize: 14,
    fontWeight: '700',
    color: GP.textOnYellow,
    backgroundColor: GP.surface,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: 'hidden',
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
    borderWidth: 1,
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
    color: GP.textPrimary,
  },
  tokenChipTextActive: {
    color: GP.primary,
  },
  requestButton: {
    backgroundColor: GP.primary,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 12,
  },
  requestButtonDisabled: {
    opacity: 0.6,
  },
  requestButtonText: {
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
