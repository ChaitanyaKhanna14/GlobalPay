/**
 * UPI Pay Screen — Send money via UPI (Paytm-style)
 */
import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
  StyleSheet,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/supabase';
import { upiService, bankByCode } from '@/services/upi';
import { GP } from '@/constants/colors';
import type { UPILinkedBank } from '@/types';

type Screen = 'form' | 'pin' | 'processing' | 'success' | 'failed';

export default function UPIPayScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ bankId?: string; vpa?: string; recipient?: string; amount?: string }>();

  const [banks, setBanks] = useState<UPILinkedBank[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Form ──
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [selectedBankId, setSelectedBankId] = useState('');
  const [screen, setScreen] = useState<Screen>('form');

  // ── PIN ──
  const [pin, setPin] = useState('');

  // ── Result ──
  const [rrn, setRrn] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Load linked UPI banks
  useEffect(() => {
    if (!user?.id) return;
    supabase.from('upi_linked_banks').select('*').eq('user_id', user.id).order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) {
          const mapped = data.map((r: any): UPILinkedBank => ({
            id: r.id, userId: r.user_id, bankName: r.bank_name, bankCode: r.bank_code,
            accountNumber: r.account_number, accountType: r.account_type, ifsc: r.ifsc,
            vpa: r.vpa, phoneNumber: r.phone_number, isDefault: r.is_default, createdAt: r.created_at,
          }));
          setBanks(mapped);
          // Auto-select bank from params or default
          const defaultId = params.bankId ?? mapped.find((b) => b.isDefault)?.id ?? mapped[0]?.id;
          if (defaultId) setSelectedBankId(defaultId);
        }
        setLoading(false);
      });
  }, [user?.id]);

  // Pre-fill from params
  useEffect(() => {
    if (params.recipient) setRecipient(params.recipient);
    if (params.amount) setAmount(params.amount);
  }, [params.recipient, params.amount]);

  const selectedBank = banks.find((b) => b.id === selectedBankId);

  const handlePayPress = () => {
    if (!recipient.trim()) { Alert.alert('Error', 'Enter recipient UPI ID or phone number'); return; }
    if (!amount || parseFloat(amount) <= 0) { Alert.alert('Error', 'Enter a valid amount'); return; }
    if (!selectedBankId) { Alert.alert('Error', 'Select a bank account'); return; }
    setPin('');
    setScreen('pin');
  };

  const handlePinSubmit = async () => {
    if (pin.length < 4) { Alert.alert('Error', 'Enter your UPI PIN'); return; }

    setScreen('processing');

    // Resolve recipient — if phone number, append @globalpay
    let receiverVpa = recipient.trim();
    if (/^\d{10}$/.test(receiverVpa)) {
      receiverVpa = `${receiverVpa}@globalpay`;
    } else if (!receiverVpa.includes('@')) {
      receiverVpa = `${receiverVpa}@globalpay`;
    }

    const result = await upiService.send({
      bankId: selectedBankId,
      receiverVpa,
      amount,
      pin,
      note: note || undefined,
    });

    if (result.ok) {
      setRrn(result.rrn ?? '');

      // Record transaction in Supabase
      try {
        await supabase.from('upi_transactions').insert({
          user_id: user?.id,
          type: 'send',
          amount,
          sender_vpa: selectedBank?.vpa ?? '',
          receiver_vpa: receiverVpa,
          bank_account_id: selectedBankId,
          status: 'completed',
          note: note || null,
          rrn: result.rrn,
          completed_at: new Date().toISOString(),
        });
      } catch (e) {
        console.warn('[UPIPay] Failed to record tx:', e);
      }

      setScreen('success');
    } else {
      setErrorMsg(result.msg);
      setScreen('failed');
    }
  };

  const bankInfo = selectedBank ? bankByCode(selectedBank.bankCode) : undefined;

  // ── PIN Input component ──
  const PinDots = () => (
    <View style={st.pinDotsRow}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <View key={i} style={[st.pinDot, i < pin.length && st.pinDotFilled]} />
      ))}
      <TextInput
        style={st.pinHidden}
        value={pin}
        onChangeText={(t) => setPin(t.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
        autoFocus
      />
    </View>
  );

  if (loading) {
    return (
      <View style={[st.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={GP.primary} />
      </View>
    );
  }

  if (banks.length === 0) {
    return (
      <View style={[st.container, st.center]}>
        <Text style={st.emptyIcon}>🏦</Text>
        <Text style={st.emptyTitle}>No UPI Bank Linked</Text>
        <Text style={st.emptySub}>Link a bank account first to send money via UPI.</Text>
        <TouchableOpacity style={st.primaryBtn} onPress={() => router.push('/linked-accounts')}>
          <Text style={st.primaryBtnText}>Link Bank Account</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ═══════════════════════════════════════════════
  //  FORM SCREEN
  // ═══════════════════════════════════════════════
  if (screen === 'form') {
    return (
      <KeyboardAvoidingView style={st.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={st.content} keyboardShouldPersistTaps="handled">
          {/* Recipient */}
          <View style={st.field}>
            <Text style={st.label}>PAY TO</Text>
            <TextInput
              style={st.input}
              placeholder="UPI ID or mobile number"
              placeholderTextColor={GP.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              value={recipient}
              onChangeText={setRecipient}
            />
          </View>

          {/* Amount */}
          <View style={st.field}>
            <Text style={st.label}>AMOUNT</Text>
            <View style={st.amountRow}>
              <Text style={st.rupee}>₹</Text>
              <TextInput
                style={st.amountInput}
                placeholder="0"
                placeholderTextColor={GP.textMuted}
                keyboardType="decimal-pad"
                value={amount}
                onChangeText={setAmount}
              />
            </View>
          </View>

          {/* Note */}
          <View style={st.field}>
            <Text style={st.label}>NOTE (OPTIONAL)</Text>
            <TextInput
              style={st.input}
              placeholder="What's this for?"
              placeholderTextColor={GP.textMuted}
              value={note}
              onChangeText={setNote}
            />
          </View>

          {/* Bank selector */}
          <View style={st.field}>
            <Text style={st.label}>PAY FROM</Text>
            {banks.map((b) => {
              const bi = bankByCode(b.bankCode);
              const isSelected = b.id === selectedBankId;
              return (
                <TouchableOpacity
                  key={b.id}
                  style={[st.bankOption, isSelected && st.bankOptionActive]}
                  onPress={() => setSelectedBankId(b.id)}>
                  <View style={[st.bankOptionIcon, { backgroundColor: bi?.color ?? GP.primary }]}>
                    <Text style={st.bankOptionEmoji}>{bi?.icon ?? '🏦'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={st.bankOptionName}>{b.bankName}</Text>
                    <Text style={st.bankOptionAcct}>{b.accountNumber}</Text>
                  </View>
                  {isSelected && <Text style={st.bankCheck}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Pay button */}
          <TouchableOpacity
            style={[st.payBtn, (!recipient || !amount) && st.btnDisabled]}
            onPress={handlePayPress}
            disabled={!recipient || !amount}>
            <Text style={st.payBtnText}>
              Pay {amount ? `₹${amount}` : ''} via UPI
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ═══════════════════════════════════════════════
  //  PIN SCREEN
  // ═══════════════════════════════════════════════
  if (screen === 'pin') {
    return (
      <View style={[st.container, st.center]}>
        <View style={[st.pinBankChip, { backgroundColor: bankInfo?.color ?? GP.card }]}>
          <Text style={st.pinBankEmoji}>{bankInfo?.icon ?? '🏦'}</Text>
          <Text style={st.pinBankName}>{selectedBank?.bankName}</Text>
        </View>
        <Text style={st.pinAmount}>₹{parseFloat(amount).toLocaleString('en-IN')}</Text>
        <Text style={st.pinTo}>to {recipient}</Text>

        <Text style={st.pinLabel}>Enter UPI PIN</Text>
        <PinDots />

        <View style={st.pinActions}>
          <TouchableOpacity style={st.pinCancel} onPress={() => { setScreen('form'); setPin(''); }}>
            <Text style={st.pinCancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[st.primaryBtn, { flex: 1 }, pin.length < 4 && st.btnDisabled]}
            onPress={handlePinSubmit}
            disabled={pin.length < 4}>
            <Text style={st.primaryBtnText}>Confirm & Pay</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ═══════════════════════════════════════════════
  //  PROCESSING SCREEN
  // ═══════════════════════════════════════════════
  if (screen === 'processing') {
    return (
      <View style={[st.container, st.center]}>
        <ActivityIndicator size="large" color={GP.primary} />
        <Text style={st.processingText}>Processing payment…</Text>
        <Text style={st.processingHint}>Please wait, do not close the app</Text>
        <View style={st.pulseRow}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={[st.pulseDot, { opacity: 0.3 + (i * 0.3) }]} />
          ))}
        </View>
      </View>
    );
  }

  // ═══════════════════════════════════════════════
  //  SUCCESS SCREEN
  // ═══════════════════════════════════════════════
  if (screen === 'success') {
    return (
      <View style={[st.container, st.center]}>
        <View style={st.successCircle}>
          <Text style={st.successIcon}>✓</Text>
        </View>
        <Text style={st.successTitle}>Payment Successful!</Text>
        <Text style={st.successAmount}>₹{parseFloat(amount).toLocaleString('en-IN')}</Text>
        <Text style={st.successTo}>sent to {recipient}</Text>
        {rrn ? <Text style={st.successRrn}>RRN: {rrn}</Text> : null}
        <Text style={st.successBank}>{selectedBank?.bankName} · {selectedBank?.accountNumber}</Text>

        <TouchableOpacity style={st.primaryBtn} onPress={() => router.back()}>
          <Text style={st.primaryBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ═══════════════════════════════════════════════
  //  FAILED SCREEN
  // ═══════════════════════════════════════════════
  return (
    <View style={[st.container, st.center]}>
      <View style={st.failCircle}>
        <Text style={st.failIcon}>✕</Text>
      </View>
      <Text style={st.failTitle}>Payment Failed</Text>
      <Text style={st.failMsg}>{errorMsg}</Text>

      <TouchableOpacity style={st.primaryBtn} onPress={() => { setScreen('form'); setPin(''); }}>
        <Text style={st.primaryBtnText}>Try Again</Text>
      </TouchableOpacity>
      <TouchableOpacity style={st.secondaryBtn} onPress={() => router.back()}>
        <Text style={st.secondaryBtnText}>Go Back</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────
const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: GP.background },
  content: { padding: 20, paddingBottom: 40 },
  center: { justifyContent: 'center', alignItems: 'center', padding: 24 },

  // ── Empty ──
  emptyIcon: { fontSize: 56, marginBottom: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '800', color: GP.textPrimary },
  emptySub: { fontSize: 14, color: GP.textSecondary, textAlign: 'center', marginTop: 6, marginBottom: 20 },

  // ── Form ──
  field: { marginBottom: 20 },
  label: { fontSize: 12, fontWeight: '700', color: GP.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  input: {
    backgroundColor: GP.inputBg, borderWidth: 1, borderColor: GP.inputBorder, borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: GP.textPrimary,
  },
  amountRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: GP.inputBg, borderWidth: 1, borderColor: GP.inputBorder, borderRadius: 14, paddingHorizontal: 16 },
  rupee: { fontSize: 28, fontWeight: '800', color: GP.textPrimary, marginRight: 4 },
  amountInput: { flex: 1, paddingVertical: 14, fontSize: 32, fontWeight: '800', color: GP.textPrimary },

  // ── Bank selector ──
  bankOption: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: GP.card,
    borderRadius: 14, padding: 14, marginBottom: 8, borderWidth: 1.5, borderColor: GP.border,
  },
  bankOptionActive: { borderColor: GP.primary },
  bankOptionIcon: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  bankOptionEmoji: { fontSize: 20 },
  bankOptionName: { fontSize: 15, fontWeight: '700', color: GP.textPrimary },
  bankOptionAcct: { fontSize: 13, color: GP.textSecondary, marginTop: 1 },
  bankCheck: { fontSize: 20, color: GP.primary, fontWeight: '800' },

  // ── Pay button ──
  payBtn: { backgroundColor: GP.primary, borderRadius: 16, paddingVertical: 18, alignItems: 'center', marginTop: 8 },
  payBtnText: { color: GP.textOnYellow, fontSize: 17, fontWeight: '800' },
  btnDisabled: { opacity: 0.4 },

  // ── PIN screen ──
  pinBankChip: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10, gap: 8, marginBottom: 20 },
  pinBankEmoji: { fontSize: 24 },
  pinBankName: { fontSize: 16, fontWeight: '700', color: '#FFF' },
  pinAmount: { fontSize: 40, fontWeight: '800', color: GP.textPrimary },
  pinTo: { fontSize: 16, color: GP.textSecondary, marginTop: 4, marginBottom: 32 },
  pinLabel: { fontSize: 14, fontWeight: '700', color: GP.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 },
  pinDotsRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 32 },
  pinDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: GP.border },
  pinDotFilled: { backgroundColor: GP.primary, borderColor: GP.primary },
  pinHidden: { position: 'absolute', opacity: 0, width: '100%', height: 50 },
  pinActions: { flexDirection: 'row', gap: 12, width: '100%' },
  pinCancel: { borderRadius: 16, paddingVertical: 16, paddingHorizontal: 20 },
  pinCancelText: { fontSize: 16, fontWeight: '700', color: GP.textSecondary },

  // ── Processing ──
  processingText: { fontSize: 18, fontWeight: '700', color: GP.textPrimary, marginTop: 20 },
  processingHint: { fontSize: 14, color: GP.textMuted, marginTop: 8 },
  pulseRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  pulseDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: GP.primary },

  // ── Success ──
  successCircle: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: GP.success,
    justifyContent: 'center', alignItems: 'center', marginBottom: 20,
  },
  successIcon: { fontSize: 40, color: '#FFF', fontWeight: '800' },
  successTitle: { fontSize: 24, fontWeight: '800', color: GP.textPrimary },
  successAmount: { fontSize: 36, fontWeight: '800', color: GP.primary, marginTop: 8 },
  successTo: { fontSize: 16, color: GP.textSecondary, marginTop: 4 },
  successRrn: { fontSize: 13, color: GP.textMuted, marginTop: 12, backgroundColor: GP.card, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  successBank: { fontSize: 13, color: GP.textMuted, marginTop: 8, marginBottom: 20 },

  // ── Failed ──
  failCircle: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: GP.error,
    justifyContent: 'center', alignItems: 'center', marginBottom: 20,
  },
  failIcon: { fontSize: 40, color: '#FFF', fontWeight: '800' },
  failTitle: { fontSize: 24, fontWeight: '800', color: GP.textPrimary },
  failMsg: { fontSize: 15, color: GP.textSecondary, marginTop: 8, textAlign: 'center', marginBottom: 20 },

  // ── Buttons ──
  primaryBtn: { backgroundColor: GP.primary, borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 12, width: '100%' },
  primaryBtnText: { color: GP.textOnYellow, fontSize: 16, fontWeight: '800' },
  secondaryBtn: { borderRadius: 16, paddingVertical: 14, alignItems: 'center', marginTop: 8, width: '100%' },
  secondaryBtnText: { color: GP.textSecondary, fontSize: 15, fontWeight: '700' },
});
