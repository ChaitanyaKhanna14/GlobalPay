/**
 * Receive Screen - Show QR code & GlobalPay ID for receiving payments (dark theme)
 * Enhanced with amount/token selection, save to gallery, and deep link generation
 */
import { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  StyleSheet,
  ScrollView,
  Share,
  Platform,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as MediaLibrary from 'expo-media-library';
import { cacheDirectory, writeAsStringAsync, EncodingType } from 'expo-file-system/legacy';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/auth-context';
import { GP } from '@/constants/colors';
import { TOKENS, DEFAULT_TOKEN } from '@/constants/tokens';
import type { QRPayload, SupportedToken } from '@/types';

// Lightweight QR display (text-based fallback when react-native-qrcode-svg isn't available)
function QRPlaceholder({ value }: { value: string }) {
  return (
    <View style={styles.qrBox}>
      <Text style={styles.qrEmoji}>📱</Text>
      <Text style={styles.qrLabel}>QR Code</Text>
      <Text style={styles.qrValue} numberOfLines={3}>{value}</Text>
    </View>
  );
}

// Try to use the actual QR code component
let QRCode: any = null;
try {
  QRCode = require('react-native-qrcode-svg').default;
} catch {}

// Deep link scheme for GlobalPay
const DEEP_LINK_SCHEME = 'globalpay://';
const UNIVERSAL_LINK_BASE = 'https://globalpay.app/pay';

export default function ReceiveScreen() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const qrRef = useRef<any>(null);

  // Payment request options
  const [amount, setAmount] = useState('');
  const [selectedToken, setSelectedToken] = useState<SupportedToken>(DEFAULT_TOKEN);
  const [saving, setSaving] = useState(false);

  const qrPayload: QRPayload = {
    globalPayId: user?.globalPayId ?? '',
    walletAddress: user?.walletAddress ?? '',
    ...(amount ? { amount } : {}),
    ...(amount ? { token: selectedToken } : {}),
  };

  const qrString = JSON.stringify(qrPayload);

  // Generate deep link URL
  const generateDeepLink = (): string => {
    const params = new URLSearchParams({
      id: user?.globalPayId ?? '',
      ...(amount ? { amount } : {}),
      ...(amount ? { token: selectedToken } : {}),
    });
    return `${DEEP_LINK_SCHEME}pay?${params.toString()}`;
  };

  // Generate universal link for sharing
  const generateUniversalLink = (): string => {
    const params = new URLSearchParams({
      id: user?.globalPayId ?? '',
      ...(amount ? { amount } : {}),
      ...(amount ? { token: selectedToken } : {}),
    });
    return `${UNIVERSAL_LINK_BASE}?${params.toString()}`;
  };

  const copyId = async () => {
    await Clipboard.setStringAsync(user?.globalPayId ?? '');
    Alert.alert('Copied!', 'GlobalPay ID copied to clipboard');
  };

  const copyAddress = async () => {
    await Clipboard.setStringAsync(user?.walletAddress ?? '');
    Alert.alert('Copied!', 'Wallet address copied to clipboard');
  };

  const copyDeepLink = async () => {
    const link = generateUniversalLink();
    await Clipboard.setStringAsync(link);
    Alert.alert('Copied!', 'Payment link copied to clipboard');
  };

  const saveQRToGallery = async () => {
    if (!qrRef.current) {
      Alert.alert('Error', 'QR code not ready. Please try again.');
      return;
    }

    setSaving(true);

    try {
      // Request media library permissions
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Required',
          'Please allow access to save images to your gallery.',
        );
        setSaving(false);
        return;
      }

      // Get base64 data from QR code
      qrRef.current.toDataURL(async (data: string) => {
        try {
          const filename = `GlobalPay_QR_${Date.now()}.png`;
          const fileUri = `${cacheDirectory}${filename}`;

          // Write base64 to file
          await writeAsStringAsync(fileUri, data, {
            encoding: EncodingType.Base64,
          });

          // Save to media library
          const asset = await MediaLibrary.createAssetAsync(fileUri);
          await MediaLibrary.createAlbumAsync('GlobalPay', asset, false);

          Alert.alert('Saved!', 'QR code saved to your gallery in the GlobalPay album.');
        } catch (err) {
          console.warn('[Receive] Failed to save QR:', err);
          Alert.alert('Error', 'Failed to save QR code. Please try again.');
        } finally {
          setSaving(false);
        }
      });
    } catch (err) {
      console.warn('[Receive] Permission error:', err);
      Alert.alert('Error', 'Could not access gallery. Please check permissions.');
      setSaving(false);
    }
  };

  const handleShare = async () => {
    try {
      const amountLine = amount ? `\nAmount: ${amount} ${selectedToken}` : '';
      const link = generateUniversalLink();

      await Share.share({
        message: `Send me crypto on GlobalPay!\n\nGlobalPay ID: ${user?.globalPayId}${amountLine}\n\nPay here: ${link}`,
      });
    } catch {}
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: insets.bottom + 20, paddingTop: 20 }}>
      {/* Amount Input */}
      <View style={styles.amountSection}>
        <Text style={styles.sectionLabel}>Request Amount (Optional)</Text>
        <View style={styles.amountRow}>
          <TextInput
            style={styles.amountInput}
            placeholder="0.00"
            placeholderTextColor={GP.textMuted}
            keyboardType="decimal-pad"
            value={amount}
            onChangeText={setAmount}
          />
          <View style={styles.tokenBadge}>
            <Text style={styles.tokenBadgeText}>{selectedToken}</Text>
          </View>
        </View>
        {amount ? (
          <Text style={styles.amountHint}>
            QR code will include this amount for quick payment
          </Text>
        ) : null}
      </View>

      {/* Token Selector */}
      <View style={styles.tokenSection}>
        <Text style={styles.sectionLabel}>Token</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tokenScroll}>
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
        </ScrollView>
      </View>

      {/* QR Code */}
      <View style={styles.qrCard}>
        <Text style={styles.qrTitle}>
          {amount ? `Request ${amount} ${selectedToken}` : 'Scan to Pay Me'}
        </Text>
        <View style={styles.qrWrapper}>
          {QRCode ? (
            <QRCode
              value={qrString}
              size={200}
              color={GP.textOnYellow}
              backgroundColor={GP.primary}
              getRef={(ref: any) => (qrRef.current = ref)}
            />
          ) : (
            <QRPlaceholder value={qrString} />
          )}
        </View>

        {/* Save to Gallery Button */}
        <TouchableOpacity
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={saveQRToGallery}
          disabled={saving}>
          <Text style={styles.saveButtonText}>
            {saving ? 'Saving...' : '💾 Save QR to Gallery'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* GlobalPay ID */}
      <TouchableOpacity style={styles.infoCard} onPress={copyId}>
        <View style={[styles.infoIconWrap, { backgroundColor: GP.cardYellow }]}>
          <Text style={styles.infoEmoji}>⚡</Text>
        </View>
        <View style={styles.infoContent}>
          <Text style={styles.infoLabel}>GlobalPay ID</Text>
          <Text style={styles.infoValue}>{user?.globalPayId}</Text>
        </View>
        <Text style={styles.copyIcon}>📋</Text>
      </TouchableOpacity>

      {/* Wallet Address */}
      <TouchableOpacity style={styles.infoCard} onPress={copyAddress}>
        <View style={[styles.infoIconWrap, { backgroundColor: GP.cardGreen }]}>
          <Text style={styles.infoEmoji}>💳</Text>
        </View>
        <View style={styles.infoContent}>
          <Text style={styles.infoLabel}>Polygon Wallet</Text>
          <Text style={styles.infoValue} numberOfLines={1}>
            {user?.walletAddress}
          </Text>
        </View>
        <Text style={styles.copyIcon}>📋</Text>
      </TouchableOpacity>

      {/* Payment Link */}
      <TouchableOpacity style={styles.infoCard} onPress={copyDeepLink}>
        <View style={[styles.infoIconWrap, { backgroundColor: GP.cardMint }]}>
          <Text style={styles.infoEmoji}>🔗</Text>
        </View>
        <View style={styles.infoContent}>
          <Text style={styles.infoLabel}>Payment Link</Text>
          <Text style={styles.infoValue} numberOfLines={1}>
            {generateUniversalLink()}
          </Text>
        </View>
        <Text style={styles.copyIcon}>📋</Text>
      </TouchableOpacity>

      <Text style={styles.hint}>
        Share your GlobalPay ID, payment link, or let others scan your QR code to receive payments.
      </Text>

      <TouchableOpacity style={styles.shareButton} onPress={handleShare}>
        <Text style={styles.shareButtonText}>📤 Share Payment Info</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GP.background,
  },
  amountSection: {
    marginHorizontal: 20,
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: GP.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: GP.card,
    borderWidth: 1.5,
    borderColor: GP.border,
    borderRadius: 14,
    paddingHorizontal: 16,
  },
  amountInput: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 24,
    fontWeight: '800',
    color: GP.textPrimary,
  },
  tokenBadge: {
    backgroundColor: GP.surface,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  tokenBadgeText: {
    fontSize: 14,
    fontWeight: '700',
    color: GP.primary,
  },
  amountHint: {
    fontSize: 12,
    color: GP.textMuted,
    marginTop: 8,
    paddingHorizontal: 4,
  },
  tokenSection: {
    marginBottom: 16,
    paddingHorizontal: 20,
  },
  tokenScroll: {
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
  qrCard: {
    backgroundColor: GP.card,
    borderRadius: 22,
    padding: 24,
    marginHorizontal: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: GP.border,
  },
  qrTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: GP.textPrimary,
    marginBottom: 20,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  qrWrapper: {
    padding: 18,
    backgroundColor: GP.primary,
    borderRadius: 18,
  },
  qrBox: {
    width: 200,
    height: 200,
    backgroundColor: GP.surface,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  qrEmoji: {
    fontSize: 40,
    marginBottom: 8,
  },
  qrLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: GP.textSecondary,
  },
  qrValue: {
    fontSize: 10,
    color: GP.textMuted,
    textAlign: 'center',
    marginTop: 8,
  },
  saveButton: {
    marginTop: 16,
    backgroundColor: GP.surface,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: GP.border,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: GP.textPrimary,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: GP.card,
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 20,
    marginTop: 12,
    borderWidth: 1,
    borderColor: GP.border,
  },
  infoIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  infoEmoji: {
    fontSize: 20,
  },
  infoContent: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 12,
    color: GP.textMuted,
    fontWeight: '600',
  },
  infoValue: {
    fontSize: 15,
    fontWeight: '700',
    color: GP.textPrimary,
    marginTop: 2,
  },
  copyIcon: {
    fontSize: 18,
  },
  hint: {
    fontSize: 13,
    color: GP.textMuted,
    textAlign: 'center',
    marginTop: 20,
    paddingHorizontal: 40,
    lineHeight: 18,
  },
  shareButton: {
    backgroundColor: GP.primary,
    borderRadius: 16,
    paddingVertical: 16,
    marginHorizontal: 20,
    marginTop: 20,
    alignItems: 'center',
  },
  shareButtonText: {
    fontSize: 16,
    fontWeight: '800',
    color: GP.textOnYellow,
  },
});
