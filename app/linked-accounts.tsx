/**
 * Linked Accounts — Paytm-style UPI bank linking + Crypto wallets
 */
import { useEffect, useState, useCallback } from 'react';
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
import { useRouter } from 'expo-router';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/supabase';
import { upiService, bankByCode } from '@/services/upi';
import type { DiscoveredAccount } from '@/services/upi';
import { GP } from '@/constants/colors';
import type { UPILinkedBank, LinkedWallet } from '@/types';

// ─── Bitcoin address validation ───────────────
function isValidBtcAddress(addr: string): boolean {
  return /^(1|3)[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(addr) ||
    /^bc1[a-z0-9]{39,59}$/i.test(addr);
}

type LinkStep = 'phone' | 'verifying' | 'discover' | 'card' | 'otp' | 'pin' | 'done';
const STEPS: LinkStep[] = ['phone', 'verifying', 'discover', 'card', 'otp', 'pin', 'done'];
const STEP_TITLE: Record<LinkStep, string> = {
  phone: 'Enter Mobile Number',
  verifying: 'Verifying…',
  discover: 'Select Bank Account',
  card: 'Verify Debit Card',
  otp: 'Enter OTP',
  pin: 'Set UPI PIN',
  done: 'All Done!',
};

export default function LinkedAccountsScreen() {
  const { user } = useAuth();
  const router = useRouter();

  // ── Data ──
  const [upiBanks, setUpiBanks] = useState<UPILinkedBank[]>([]);
  const [wallets, setWallets] = useState<LinkedWallet[]>([]);
  const [loading, setLoading] = useState(true);

  // ── UPI Link Flow ──
  const [showLink, setShowLink] = useState(false);
  const [step, setStep] = useState<LinkStep>('phone');
  const [phone, setPhone] = useState('');
  const [discovered, setDiscovered] = useState<DiscoveredAccount[]>([]);
  const [selected, setSelected] = useState<DiscoveredAccount | null>(null);
  const [bankSearch, setBankSearch] = useState('');
  const [cardLast6, setCardLast6] = useState('');
  const [cardMM, setCardMM] = useState('');
  const [cardYY, setCardYY] = useState('');
  const [otp, setOtp] = useState('');
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  // ── Balance ──
  const [showBalance, setShowBalance] = useState(false);
  const [balPin, setBalPin] = useState('');
  const [balBankId, setBalBankId] = useState('');
  const [balResult, setBalResult] = useState<string | null>(null);

  // ── Wallet ──
  const [showWallet, setShowWallet] = useState(false);
  const [wLabel, setWLabel] = useState('');
  const [wNet, setWNet] = useState('bitcoin');
  const [wAddr, setWAddr] = useState('');
  const [saving, setSaving] = useState(false);

  // ═══════════════════════════════════════════════
  //  LOAD DATA
  // ═══════════════════════════════════════════════
  const loadData = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const [uRes, wRes] = await Promise.all([
        supabase.from('upi_linked_banks').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
        supabase.from('linked_wallets').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
      ]);
      if (uRes.data) {
        setUpiBanks(uRes.data.map((r: any) => ({
          id: r.id, userId: r.user_id, bankName: r.bank_name, bankCode: r.bank_code,
          accountNumber: r.account_number, accountType: r.account_type, ifsc: r.ifsc,
          vpa: r.vpa, phoneNumber: r.phone_number, isDefault: r.is_default, createdAt: r.created_at,
        })));
      }
      if (wRes.data) {
        setWallets(wRes.data.map((w: any) => ({
          id: w.id, userId: w.user_id, label: w.label, network: w.network,
          address: w.address, isVerified: w.is_verified, createdAt: w.created_at,
        })));
      }
    } catch (e) {
      console.warn('[LinkedAccounts] load failed:', e);
    }
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { loadData(); }, [loadData]);

  // ═══════════════════════════════════════════════
  //  UPI LINK FLOW
  // ═══════════════════════════════════════════════
  const resetLink = () => {
    setStep('phone'); setPhone(''); setDiscovered([]); setSelected(null);
    setCardLast6(''); setCardMM(''); setCardYY(''); setBankSearch('');
    setOtp(''); setPin(''); setPinConfirm(''); setStatusMsg('');
  };

  const openLink = () => { resetLink(); setShowLink(true); };

  const goBack = () => {
    const map: Partial<Record<LinkStep, LinkStep>> = {
      discover: 'phone', card: 'discover', otp: 'card', pin: 'otp',
    };
    const prev = map[step];
    if (prev) setStep(prev);
    else { setShowLink(false); resetLink(); }
  };

  // Step 1 → 2: verify phone & show bank list
  const handlePhoneSubmit = async () => {
    setBusy(true);
    setStep('verifying');
    setStatusMsg('Sending SMS for verification…');
    const res = await upiService.verifyPhone(phone);
    if (!res.ok) {
      Alert.alert('Error', res.msg);
      setStep('phone'); setBusy(false); return;
    }
    setStatusMsg('Loading supported banks…');
    const banks = await upiService.discoverBanks(phone);
    setDiscovered(banks);
    setStep('discover');
    setBusy(false);
  };

  // Step 2 → 3: select bank & generate account info
  const handleSelectBank = (acc: DiscoveredAccount) => {
    // Generate realistic masked account number & IFSC for the selected bank
    const seed = phone.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const last4 = String(((seed * 137) & 0xFFFF) % 10000).padStart(4, '0');
    const ifsc = `${acc.bankCode}0${String(seed % 99999).padStart(5, '0')}`;
    setSelected({
      ...acc,
      accountNumber: `XXXX XXXX ${last4}`,
      ifsc,
    });
    setStep('card');
  };

  // Step 3 → 4: verify debit card → OTP
  const handleCardSubmit = async () => {
    if (!selected) return;
    setBusy(true);
    const res = await upiService.verifyCard(selected.bankCode, cardLast6, cardMM, cardYY);
    setBusy(false);
    if (!res.ok) { Alert.alert('Error', res.msg); return; }
    Alert.alert('OTP Sent', res.msg);
    setStep('otp');
  };

  // Step 4 → 5: OTP → PIN setup
  const handleOtpSubmit = () => {
    if (otp.length < 4) { Alert.alert('Error', 'Enter the OTP received via SMS'); return; }
    setStep('pin');
  };

  // Step 5 → done: set PIN + save to DB
  const handlePinSubmit = async () => {
    if (pin.length < 4 || pin.length > 6) { Alert.alert('Error', 'UPI PIN must be 4–6 digits'); return; }
    if (pin !== pinConfirm) { Alert.alert('Error', 'PINs do not match'); return; }
    if (!selected || !user) return;

    setBusy(true);

    // Setup PIN with temp ID
    const tempId = `tmp_${Date.now()}`;
    const pinRes = await upiService.setupPin(tempId, otp, pin);
    if (!pinRes.ok) { Alert.alert('Error', pinRes.msg); setBusy(false); return; }

    // Create VPA
    const vpa = await upiService.createVPA(user.globalPayId.split('@')[0]);

    // Save to Supabase
    const { data: inserted, error } = await supabase.from('upi_linked_banks').insert({
      user_id: user.id,
      bank_name: selected.bankName,
      bank_code: selected.bankCode,
      account_number: selected.accountNumber,
      account_type: selected.accountType,
      ifsc: selected.ifsc,
      vpa,
      phone_number: phone,
      is_default: upiBanks.length === 0,
    }).select().single();

    if (error) { Alert.alert('Error', error.message); setBusy(false); return; }

    // Re-store PIN with real bank ID
    if (inserted) {
      await upiService.setupPin(inserted.id, otp, pin);
    }

    setBusy(false);
    setStep('done');
    loadData();
  };

  // ═══════════════════════════════════════════════
  //  BALANCE CHECK
  // ═══════════════════════════════════════════════
  const openBalance = (bankId: string) => {
    setBalBankId(bankId); setBalPin(''); setBalResult(null);
    setShowBalance(true);
  };

  const handleCheckBalance = async () => {
    setBusy(true);
    const res = await upiService.checkBalance(balBankId, balPin);
    setBusy(false);
    if (!res.ok) { Alert.alert('Error', res.msg); return; }
    setBalResult(res.balance!);
  };

  // ═══════════════════════════════════════════════
  //  DELETE
  // ═══════════════════════════════════════════════
  const handleDeleteBank = (id: string, name: string) => {
    Alert.alert('Remove Bank', `Remove "${name}" from UPI?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        await supabase.from('upi_linked_banks').delete().eq('id', id);
        loadData();
      }},
    ]);
  };

  const handleDeleteWallet = (id: string, label: string) => {
    Alert.alert('Remove Wallet', `Remove "${label}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        await supabase.from('linked_wallets').delete().eq('id', id);
        loadData();
      }},
    ]);
  };

  // ═══════════════════════════════════════════════
  //  ADD WALLET
  // ═══════════════════════════════════════════════
  const handleAddWallet = async () => {
    if (!wLabel.trim() || !wAddr.trim()) { Alert.alert('Error', 'Fill in all fields'); return; }
    if (wNet === 'bitcoin' && !isValidBtcAddress(wAddr.trim())) {
      Alert.alert('Invalid Address', 'Enter a valid Bitcoin address.');
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('linked_wallets').insert({
      user_id: user?.id, label: wLabel.trim(), network: wNet, address: wAddr.trim(),
    });
    setSaving(false);
    if (error) { Alert.alert('Error', error.message); return; }
    Alert.alert('Linked!', `${wLabel} added.`);
    setWLabel(''); setWNet('bitcoin'); setWAddr('');
    setShowWallet(false);
    loadData();
  };

  // ═══════════════════════════════════════════════
  //  HELPERS
  // ═══════════════════════════════════════════════
  const stepIdx = STEPS.indexOf(step);

  const renderDots = () => (
    <View style={s.dots}>
      {[0, 2, 3, 4, 5, 6].map((i) => (
        <View key={i} style={[s.dot, stepIdx >= i && s.dotActive]} />
      ))}
    </View>
  );

  const PinInput = ({ value, onChange, placeholder }: { value: string; onChange: (t: string) => void; placeholder: string }) => (
    <View style={s.pinRow}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <View key={i} style={[s.pinDot, i < value.length && s.pinDotFilled]} />
      ))}
      <TextInput
        style={s.pinHidden}
        value={value}
        onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        secureTextEntry
        placeholder={placeholder}
        placeholderTextColor={GP.textMuted}
        maxLength={6}
        autoFocus
      />
    </View>
  );

  // ═══════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════
  if (loading) {
    return (
      <View style={[s.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={GP.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>

      {/* ══════ UPI BANK ACCOUNTS ══════ */}
      <View style={s.section}>
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>🏦 UPI Bank Accounts</Text>
          <TouchableOpacity style={s.addBtn} onPress={openLink}>
            <Text style={s.addBtnText}>+ Link Bank</Text>
          </TouchableOpacity>
        </View>

        {upiBanks.length === 0 ? (
          <TouchableOpacity style={s.heroCard} onPress={openLink}>
            <Text style={s.heroIcon}>🏦</Text>
            <Text style={s.heroTitle}>Link Your Bank Account</Text>
            <Text style={s.heroSub}>
              Just like Paytm — verify your phone, select your bank,{'\n'}set your UPI PIN, and start transacting instantly.
            </Text>
            <View style={s.heroBtnWrap}>
              <Text style={s.heroBtnText}>Link Bank via UPI →</Text>
            </View>
          </TouchableOpacity>
        ) : (
          upiBanks.map((b) => {
            const bank = bankByCode(b.bankCode);
            return (
              <View key={b.id} style={s.bankCard}>
                <View style={[s.bankStripe, { backgroundColor: bank?.color ?? GP.primary }]} />
                <View style={s.bankBody}>
                  <View style={s.bankTop}>
                    <Text style={s.bankIcon}>{bank?.icon ?? '🏦'}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.bankName}>{b.bankName}</Text>
                      <Text style={s.bankAcct}>{b.accountNumber} · {b.accountType}</Text>
                    </View>
                    {b.isDefault && <View style={s.defaultBadge}><Text style={s.defaultBadgeText}>DEFAULT</Text></View>}
                  </View>
                  <View style={s.bankVpaRow}>
                    <Text style={s.bankVpa}>{b.vpa}</Text>
                  </View>
                  <View style={s.bankActions}>
                    <TouchableOpacity style={s.bankActionBtn} onPress={() => openBalance(b.id)}>
                      <Text style={s.bankActionText}>💰 Balance</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={s.bankActionBtn}
                      onPress={() => router.push({ pathname: '/upi-pay' as any, params: { bankId: b.id, vpa: b.vpa } })}>
                      <Text style={s.bankActionText}>📤 Send</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.bankActionBtn, { borderColor: GP.error }]} onPress={() => handleDeleteBank(b.id, b.bankName)}>
                      <Text style={[s.bankActionText, { color: GP.error }]}>✕ Remove</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            );
          })
        )}
      </View>

      {/* ══════ QUICK ACTIONS ══════ */}
      {upiBanks.length > 0 && (
        <View style={s.section}>
          <Text style={s.sectionTitle}>⚡ Quick Actions</Text>
          <View style={s.quickRow}>
            <TouchableOpacity
              style={[s.quickBtn, { backgroundColor: '#1B5E20' }]}
              onPress={() => router.push('/upi-pay' as any)}>
              <Text style={s.quickEmoji}>📤</Text>
              <Text style={s.quickLabel}>Send</Text>
              <Text style={s.quickSub}>Pay via UPI</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.quickBtn, { backgroundColor: '#E65100' }]}
              onPress={() => router.push('/request')}>
              <Text style={s.quickEmoji}>📥</Text>
              <Text style={s.quickLabel}>Request</Text>
              <Text style={s.quickSub}>Collect money</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.quickBtn, { backgroundColor: '#1A237E' }]}
              onPress={() => router.push('/scan')}>
              <Text style={s.quickEmoji}>📷</Text>
              <Text style={s.quickLabel}>Scan & Pay</Text>
              <Text style={s.quickSub}>QR code</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ══════ CRYPTO WALLETS ══════ */}
      <View style={s.section}>
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>₿ Crypto Wallets</Text>
          <TouchableOpacity style={s.addBtn} onPress={() => { setWLabel(''); setWNet('bitcoin'); setWAddr(''); setShowWallet(true); }}>
            <Text style={s.addBtnText}>+ Add</Text>
          </TouchableOpacity>
        </View>

        {wallets.length === 0 ? (
          <View style={s.emptyCard}>
            <Text style={s.emptyIcon}>🔗</Text>
            <Text style={s.emptyText}>No wallets linked</Text>
            <Text style={s.emptySub}>Link your Bitcoin or other crypto wallets</Text>
          </View>
        ) : (
          wallets.map((w) => (
            <TouchableOpacity key={w.id} style={s.itemCard} onLongPress={() => handleDeleteWallet(w.id, w.label)}>
              <View style={[s.itemIconWrap, { backgroundColor: w.network === 'bitcoin' ? '#F7931A' : GP.cardGreen }]}>
                <Text style={s.itemEmoji}>{w.network === 'bitcoin' ? '₿' : '⟠'}</Text>
              </View>
              <View style={s.itemContent}>
                <Text style={s.itemLabel}>{w.label}</Text>
                <Text style={s.itemValue} numberOfLines={1}>{w.address.slice(0, 10)}…{w.address.slice(-8)}</Text>
                <Text style={s.itemMeta}>{w.network.charAt(0).toUpperCase() + w.network.slice(1)} · Long press to remove</Text>
              </View>
            </TouchableOpacity>
          ))
        )}
      </View>

      {/* ══════════════════════════════════════════
            MODAL — LINK BANK VIA UPI
         ══════════════════════════════════════════ */}
      <Modal visible={showLink} animationType="slide" transparent>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.modalCard}>
            {/* Header + dots */}
            <View style={s.modalHeader}>
              {step !== 'verifying' && step !== 'done' && (
                <TouchableOpacity onPress={goBack} style={s.backBtn}>
                  <Text style={s.backText}>← Back</Text>
                </TouchableOpacity>
              )}
              <Text style={s.modalTitle}>{STEP_TITLE[step]}</Text>
            </View>
            {renderDots()}

            {/* ── Step: Phone ── */}
            {step === 'phone' && (
              <View>
                <Text style={s.fieldLabel}>MOBILE NUMBER</Text>
                <View style={s.phoneRow}>
                  <View style={s.countryCode}><Text style={s.countryText}>🇮🇳 +91</Text></View>
                  <TextInput
                    style={[s.input, { flex: 1 }]}
                    placeholder="Enter 10-digit number"
                    placeholderTextColor={GP.textMuted}
                    keyboardType="phone-pad"
                    maxLength={10}
                    value={phone}
                    onChangeText={setPhone}
                  />
                </View>
                <Text style={s.hint}>We'll send a verification SMS from this device. Make sure the SIM linked to your bank is in this phone.</Text>
                <TouchableOpacity
                  style={[s.primaryBtn, phone.length < 10 && s.btnDisabled]}
                  onPress={handlePhoneSubmit}
                  disabled={phone.length < 10}>
                  <Text style={s.primaryBtnText}>Verify & Find Banks</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ── Step: Verifying ── */}
            {step === 'verifying' && (
              <View style={s.center}>
                <ActivityIndicator size="large" color={GP.primary} />
                <Text style={s.verifyMsg}>{statusMsg}</Text>
                <View style={s.pulseRow}>
                  {[0, 1, 2].map((i) => (
                    <View key={i} style={[s.pulseDot, { opacity: 0.3 + (i * 0.3) }]} />
                  ))}
                </View>
              </View>
            )}

            {/* ── Step: Discover ── */}
            {step === 'discover' && (
              <View>
                <Text style={s.discoverLabel}>
                  Select your bank to continue
                </Text>
                <TextInput
                  style={[s.input, { marginBottom: 12 }]}
                  placeholder="Search bank name…"
                  placeholderTextColor={GP.textMuted}
                  value={bankSearch}
                  onChangeText={setBankSearch}
                  autoFocus
                />
                <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
                  {discovered
                    .filter((acc) => acc.bankName.toLowerCase().includes(bankSearch.toLowerCase()))
                    .map((acc, i) => (
                    <TouchableOpacity key={i} style={s.discoverCard} onPress={() => handleSelectBank(acc)}>
                      <View style={[s.discoverIcon, { backgroundColor: acc.color }]}>
                        <Text style={s.discoverEmoji}>{acc.icon}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.discoverBank}>{acc.bankName}</Text>
                      </View>
                      <Text style={s.discoverArrow}>›</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* ── Step: Card ── */}
            {step === 'card' && selected && (
              <View>
                <View style={s.selectedBankChip}>
                  <Text style={s.selectedBankEmoji}>{selected.icon}</Text>
                  <Text style={s.selectedBankName}>{selected.bankName} · {selected.accountNumber}</Text>
                </View>
                <Text style={s.fieldLabel}>LAST 6 DIGITS OF DEBIT CARD</Text>
                <TextInput
                  style={s.input}
                  placeholder="XXXXXX"
                  placeholderTextColor={GP.textMuted}
                  keyboardType="number-pad"
                  maxLength={6}
                  value={cardLast6}
                  onChangeText={setCardLast6}
                />
                <Text style={s.fieldLabel}>CARD EXPIRY DATE</Text>
                <View style={s.expiryRow}>
                  <TextInput
                    style={[s.input, s.expiryInput]}
                    placeholder="MM"
                    placeholderTextColor={GP.textMuted}
                    keyboardType="number-pad"
                    maxLength={2}
                    value={cardMM}
                    onChangeText={setCardMM}
                  />
                  <Text style={s.expirySlash}>/</Text>
                  <TextInput
                    style={[s.input, s.expiryInput]}
                    placeholder="YY"
                    placeholderTextColor={GP.textMuted}
                    keyboardType="number-pad"
                    maxLength={2}
                    value={cardYY}
                    onChangeText={setCardYY}
                  />
                </View>
                <Text style={s.hint}>Your bank will send an OTP to verify card ownership.</Text>
                <TouchableOpacity
                  style={[s.primaryBtn, (cardLast6.length < 6 || !cardMM || !cardYY) && s.btnDisabled]}
                  onPress={handleCardSubmit}
                  disabled={busy || cardLast6.length < 6 || !cardMM || !cardYY}>
                  {busy ? <ActivityIndicator color={GP.textOnYellow} /> :
                    <Text style={s.primaryBtnText}>Send OTP</Text>}
                </TouchableOpacity>
              </View>
            )}

            {/* ── Step: OTP ── */}
            {step === 'otp' && (
              <View>
                <Text style={s.otpLabel}>Enter the OTP sent by {selected?.bankName ?? 'your bank'} via SMS</Text>
                <TextInput
                  style={[s.input, s.otpInput]}
                  placeholder="• • • • • •"
                  placeholderTextColor={GP.textMuted}
                  keyboardType="number-pad"
                  maxLength={6}
                  value={otp}
                  onChangeText={setOtp}
                  autoFocus
                />
                <TouchableOpacity
                  style={[s.primaryBtn, otp.length < 4 && s.btnDisabled]}
                  onPress={handleOtpSubmit}
                  disabled={otp.length < 4}>
                  <Text style={s.primaryBtnText}>Verify OTP</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ── Step: PIN ── */}
            {step === 'pin' && (
              <View>
                <Text style={s.pinLabel}>Create a 4–6 digit UPI PIN for {selected?.bankName}</Text>
                <Text style={s.fieldLabel}>NEW UPI PIN</Text>
                <PinInput value={pin} onChange={setPin} placeholder="Enter PIN" />
                <Text style={[s.fieldLabel, { marginTop: 16 }]}>CONFIRM UPI PIN</Text>
                <PinInput value={pinConfirm} onChange={setPinConfirm} placeholder="Re-enter PIN" />
                <Text style={s.hint}>Never share your UPI PIN with anyone. GlobalPay will never ask for it.</Text>
                <TouchableOpacity
                  style={[s.primaryBtn, (pin.length < 4 || pinConfirm.length < 4) && s.btnDisabled]}
                  onPress={handlePinSubmit}
                  disabled={busy || pin.length < 4 || pinConfirm.length < 4}>
                  {busy ? <ActivityIndicator color={GP.textOnYellow} /> :
                    <Text style={s.primaryBtnText}>Set UPI PIN & Link Bank</Text>}
                </TouchableOpacity>
              </View>
            )}

            {/* ── Step: Done ── */}
            {step === 'done' && (
              <View style={s.center}>
                <Text style={s.doneIcon}>✅</Text>
                <Text style={s.doneTitle}>Bank Linked Successfully!</Text>
                <Text style={s.doneSub}>{selected?.bankName} · {selected?.accountNumber}</Text>
                <Text style={s.doneVpa}>Your UPI ID: {user?.globalPayId.split('@')[0]}@globalpay</Text>
                <Text style={s.hint}>You can now send & receive money, check balance, and pay via UPI.</Text>
                <TouchableOpacity
                  style={s.primaryBtn}
                  onPress={() => { setShowLink(false); resetLink(); }}>
                  <Text style={s.primaryBtnText}>Done</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ══════════════════════════════════════════
            MODAL — CHECK BALANCE
         ══════════════════════════════════════════ */}
      <Modal visible={showBalance} animationType="slide" transparent>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Check Balance</Text>

            {balResult ? (
              <View style={s.center}>
                <Text style={s.balanceAmount}>₹{Number(balResult).toLocaleString('en-IN')}</Text>
                <Text style={s.balanceSub}>Available Balance</Text>
                <TouchableOpacity style={s.primaryBtn} onPress={() => setShowBalance(false)}>
                  <Text style={s.primaryBtnText}>Done</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View>
                <Text style={s.fieldLabel}>ENTER UPI PIN</Text>
                <PinInput value={balPin} onChange={setBalPin} placeholder="UPI PIN" />
                <View style={s.modalActions}>
                  <TouchableOpacity style={s.cancelBtn} onPress={() => setShowBalance(false)}>
                    <Text style={s.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.primaryBtn, { flex: 0 }, balPin.length < 4 && s.btnDisabled]}
                    onPress={handleCheckBalance}
                    disabled={busy || balPin.length < 4}>
                    {busy ? <ActivityIndicator color={GP.textOnYellow} /> :
                      <Text style={s.primaryBtnText}>Check</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ══════════════════════════════════════════
            MODAL — ADD CRYPTO WALLET
         ══════════════════════════════════════════ */}
      <Modal visible={showWallet} animationType="slide" transparent>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Link Crypto Wallet</Text>

            <Text style={s.fieldLabel}>LABEL</Text>
            <TextInput style={s.input} placeholder="My Bitcoin Wallet"
              placeholderTextColor={GP.textMuted} value={wLabel} onChangeText={setWLabel} />

            <Text style={s.fieldLabel}>NETWORK</Text>
            <View style={s.chipRow}>
              {['bitcoin', 'ethereum', 'solana'].map((n) => (
                <TouchableOpacity key={n} style={[s.chip, wNet === n && s.chipActive]} onPress={() => setWNet(n)}>
                  <Text style={[s.chipText, wNet === n && s.chipTextActive]}>
                    {n === 'bitcoin' ? '₿ Bitcoin' : n === 'ethereum' ? '⟠ Ethereum' : '◎ Solana'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.fieldLabel}>WALLET ADDRESS</Text>
            <TextInput style={s.input}
              placeholder={wNet === 'bitcoin' ? 'bc1q… or 1…' : '0x…'}
              placeholderTextColor={GP.textMuted} autoCapitalize="none" autoCorrect={false}
              value={wAddr} onChangeText={setWAddr} />

            <View style={s.modalActions}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setShowWallet(false)}>
                <Text style={s.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.5 }]}
                onPress={handleAddWallet} disabled={saving}>
                <Text style={s.saveBtnText}>{saving ? 'Saving…' : 'Link Wallet'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}

// ─── Styles ─────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: GP.background },
  content: { padding: 20, paddingBottom: 60 },

  // ── Section ──
  section: { marginBottom: 28 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 20, fontWeight: '800', color: GP.textPrimary, letterSpacing: -0.3 },
  addBtn: { backgroundColor: GP.primary, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 8 },
  addBtnText: { fontSize: 14, fontWeight: '800', color: GP.textOnYellow },

  // ── Hero card (no banks linked) ──
  heroCard: {
    backgroundColor: GP.card, borderRadius: 20, padding: 32, alignItems: 'center',
    borderWidth: 1.5, borderColor: GP.primary, borderStyle: 'dashed',
  },
  heroIcon: { fontSize: 48, marginBottom: 12 },
  heroTitle: { fontSize: 20, fontWeight: '800', color: GP.textPrimary, marginBottom: 6 },
  heroSub: { fontSize: 14, color: GP.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: 16 },
  heroBtnWrap: { backgroundColor: GP.primary, borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 },
  heroBtnText: { fontSize: 15, fontWeight: '800', color: GP.textOnYellow },

  // ── Bank card ──
  bankCard: {
    flexDirection: 'row', backgroundColor: GP.card, borderRadius: 18,
    marginBottom: 10, overflow: 'hidden', borderWidth: 1, borderColor: GP.border,
  },
  bankStripe: { width: 6 },
  bankBody: { flex: 1, padding: 16 },
  bankTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bankIcon: { fontSize: 28 },
  bankName: { fontSize: 16, fontWeight: '800', color: GP.textPrimary },
  bankAcct: { fontSize: 13, color: GP.textSecondary, marginTop: 1 },
  defaultBadge: { backgroundColor: GP.primary, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  defaultBadgeText: { fontSize: 10, fontWeight: '800', color: GP.textOnYellow },
  bankVpaRow: { marginTop: 8, backgroundColor: GP.surface, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start' },
  bankVpa: { fontSize: 14, fontWeight: '700', color: GP.primary },
  bankActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  bankActionBtn: {
    borderWidth: 1, borderColor: GP.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  bankActionText: { fontSize: 12, fontWeight: '700', color: GP.textSecondary },

  // ── Quick actions ──
  quickRow: { flexDirection: 'row', gap: 10 },
  quickBtn: { flex: 1, borderRadius: 16, padding: 16, alignItems: 'center', gap: 4 },
  quickEmoji: { fontSize: 24 },
  quickLabel: { fontSize: 14, fontWeight: '800', color: '#FFF' },
  quickSub: { fontSize: 11, color: 'rgba(255,255,255,0.7)' },

  // ── Empty & item (wallets) ──
  emptyCard: {
    backgroundColor: GP.card, borderRadius: 18, padding: 32, alignItems: 'center',
    borderWidth: 1, borderColor: GP.border,
  },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyText: { fontSize: 16, fontWeight: '700', color: GP.textPrimary },
  emptySub: { fontSize: 13, color: GP.textSecondary, textAlign: 'center', marginTop: 4 },
  itemCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: GP.card, borderRadius: 16,
    padding: 16, marginBottom: 8, borderWidth: 1, borderColor: GP.border,
  },
  itemIconWrap: { width: 44, height: 44, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  itemEmoji: { fontSize: 22 },
  itemContent: { flex: 1 },
  itemLabel: { fontSize: 15, fontWeight: '700', color: GP.textPrimary },
  itemValue: { fontSize: 14, color: GP.textSecondary, marginTop: 2 },
  itemMeta: { fontSize: 11, color: GP.textMuted, marginTop: 2 },

  // ── Modal ──
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: GP.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40, maxHeight: '90%',
  },
  modalHeader: { marginBottom: 4 },
  modalTitle: { fontSize: 22, fontWeight: '800', color: GP.textPrimary, letterSpacing: -0.3 },
  backBtn: { marginBottom: 6 },
  backText: { fontSize: 14, fontWeight: '700', color: GP.primary },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 24 },

  // ── Dots ──
  dots: { flexDirection: 'row', gap: 6, marginBottom: 20 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: GP.border },
  dotActive: { backgroundColor: GP.primary, width: 24 },

  // ── Fields ──
  fieldLabel: { fontSize: 12, fontWeight: '700', color: GP.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, marginTop: 14 },
  input: {
    backgroundColor: GP.inputBg, borderWidth: 1, borderColor: GP.inputBorder, borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: GP.textPrimary,
  },
  hint: { fontSize: 12, color: GP.textMuted, marginTop: 10, lineHeight: 17 },
  phoneRow: { flexDirection: 'row', gap: 8 },
  countryCode: { backgroundColor: GP.card, borderRadius: 14, paddingHorizontal: 14, justifyContent: 'center', borderWidth: 1, borderColor: GP.border },
  countryText: { fontSize: 15, fontWeight: '700', color: GP.textPrimary },
  expiryRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  expiryInput: { flex: 1, textAlign: 'center' },
  expirySlash: { fontSize: 22, color: GP.textMuted, fontWeight: '700' },
  otpLabel: { fontSize: 15, color: GP.textSecondary, marginBottom: 12, lineHeight: 22 },
  otpInput: { fontSize: 24, fontWeight: '800', textAlign: 'center', letterSpacing: 12 },

  // ── Primary button ──
  primaryBtn: {
    backgroundColor: GP.primary, borderRadius: 16, paddingVertical: 16,
    alignItems: 'center', marginTop: 20,
  },
  primaryBtnText: { color: GP.textOnYellow, fontSize: 16, fontWeight: '800' },
  btnDisabled: { opacity: 0.4 },
  cancelBtn: { borderRadius: 14, paddingHorizontal: 20, paddingVertical: 14 },
  cancelText: { fontSize: 15, fontWeight: '700', color: GP.textSecondary },
  saveBtn: { backgroundColor: GP.primary, borderRadius: 14, paddingHorizontal: 24, paddingVertical: 14 },
  saveBtnText: { fontSize: 15, fontWeight: '800', color: GP.textOnYellow },

  // ── Verify step ──
  center: { alignItems: 'center', paddingVertical: 24 },
  verifyMsg: { fontSize: 15, color: GP.textSecondary, marginTop: 16, textAlign: 'center' },
  pulseRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  pulseDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: GP.primary },

  // ── Discover step ──
  discoverLabel: { fontSize: 14, color: GP.textSecondary, marginBottom: 12 },
  discoverCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: GP.card,
    borderRadius: 16, padding: 16, marginBottom: 8, borderWidth: 1, borderColor: GP.border,
  },
  discoverIcon: { width: 44, height: 44, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  discoverEmoji: { fontSize: 22 },
  discoverBank: { fontSize: 16, fontWeight: '700', color: GP.textPrimary },
  discoverAcct: { fontSize: 14, color: GP.textSecondary, marginTop: 2 },
  discoverIfsc: { fontSize: 12, color: GP.textMuted, marginTop: 1 },
  discoverArrow: { fontSize: 28, color: GP.textMuted, marginLeft: 8 },

  // ── Card step ──
  selectedBankChip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: GP.card,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, gap: 8, marginBottom: 4,
    borderWidth: 1, borderColor: GP.primary, alignSelf: 'flex-start',
  },
  selectedBankEmoji: { fontSize: 18 },
  selectedBankName: { fontSize: 14, fontWeight: '700', color: GP.primary },

  // ── PIN input ──
  pinLabel: { fontSize: 15, color: GP.textSecondary, marginBottom: 4, lineHeight: 22 },
  pinRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  pinDot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: GP.border },
  pinDotFilled: { backgroundColor: GP.primary, borderColor: GP.primary },
  pinHidden: { position: 'absolute', opacity: 0, width: '100%', height: 40 },

  // ── Done step ──
  doneIcon: { fontSize: 56, marginBottom: 12 },
  doneTitle: { fontSize: 22, fontWeight: '800', color: GP.textPrimary },
  doneSub: { fontSize: 15, color: GP.textSecondary, marginTop: 4 },
  doneVpa: { fontSize: 16, fontWeight: '700', color: GP.primary, marginTop: 10, backgroundColor: GP.card, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },

  // ── Balance modal ──
  balanceAmount: { fontSize: 36, fontWeight: '800', color: GP.primary, marginVertical: 12 },
  balanceSub: { fontSize: 15, color: GP.textSecondary },

  // ── Chips (wallet) ──
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: { backgroundColor: GP.card, borderWidth: 1, borderColor: GP.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  chipActive: { borderColor: GP.primary },
  chipText: { fontSize: 14, fontWeight: '700', color: GP.textSecondary },
  chipTextActive: { color: GP.primary },
});
