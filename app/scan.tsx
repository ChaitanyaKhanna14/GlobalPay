/**
 * QR Scanner Screen - Scan a GlobalPay QR code or UPI QR to initiate payment
 * Enhanced with flashlight toggle and UPI QR format support
 */
import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GP } from '@/constants/colors';
import type { QRPayload } from '@/types';

// UPI QR format: upi://pay?pa=<vpa>&pn=<name>&am=<amount>&cu=<currency>&tn=<note>
interface UPIPayload {
  pa: string; // Payee VPA (UPI ID)
  pn?: string; // Payee name
  am?: string; // Amount
  cu?: string; // Currency (INR)
  tn?: string; // Transaction note
  tr?: string; // Transaction reference
}

function parseUPIQR(data: string): UPIPayload | null {
  try {
    if (!data.toLowerCase().startsWith('upi://pay')) {
      return null;
    }

    // Extract query string
    const queryStart = data.indexOf('?');
    if (queryStart === -1) return null;

    const queryString = data.slice(queryStart + 1);
    const params = new URLSearchParams(queryString);

    const pa = params.get('pa');
    if (!pa) return null; // VPA is required

    return {
      pa: pa.toLowerCase(),
      pn: params.get('pn') || undefined,
      am: params.get('am') || undefined,
      cu: params.get('cu') || 'INR',
      tn: params.get('tn') || undefined,
      tr: params.get('tr') || undefined,
    };
  } catch {
    return null;
  }
}

export default function ScanScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);

  const toggleTorch = () => {
    setTorchEnabled((prev) => !prev);
  };

  const handleBarcodeScanned = ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);

    // Try parsing as UPI QR first
    const upiPayload = parseUPIQR(data);
    if (upiPayload) {
      // Redirect to UPI pay screen with pre-filled data
      Alert.alert(
        'UPI Payment',
        `Pay to: ${upiPayload.pn || upiPayload.pa}${upiPayload.am ? `\nAmount: ₹${upiPayload.am}` : ''}`,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => setScanned(false) },
          {
            text: 'Pay',
            onPress: () => {
              router.replace({
                pathname: '/upi-pay' as any,
                params: {
                  vpa: upiPayload.pa,
                  name: upiPayload.pn || '',
                  amount: upiPayload.am || '',
                  note: upiPayload.tn || '',
                },
              });
            },
          },
        ],
      );
      return;
    }

    // Try parsing as GlobalPay QR
    try {
      const payload: QRPayload = JSON.parse(data);

      // Sanitize & validate QR payload
      const gpId = typeof payload.globalPayId === 'string'
        ? payload.globalPayId.replace(/[^a-zA-Z0-9@._-]/g, '').slice(0, 64)
        : undefined;
      const walletAddr = typeof payload.walletAddress === 'string'
        ? payload.walletAddress.replace(/[^a-zA-Z0-9x]/g, '').slice(0, 42)
        : undefined;
      const token = typeof payload.token === 'string'
        ? payload.token.replace(/[^A-Z]/g, '').slice(0, 6)
        : '';
      const amount = typeof payload.amount === 'string'
        ? payload.amount.replace(/[^0-9.]/g, '').slice(0, 20)
        : '';

      // Validate wallet address format if present
      if (walletAddr && !/^0x[a-fA-F0-9]{40}$/.test(walletAddr)) {
        Alert.alert('Invalid QR', 'The wallet address in this QR code is not valid.', [
          { text: 'Scan Again', onPress: () => setScanned(false) },
        ]);
        return;
      }

      if (gpId || walletAddr) {
        // Show confirmation for payment requests with amount
        if (amount && parseFloat(amount) > 0) {
          Alert.alert(
            'Payment Request',
            `${gpId || walletAddr} is requesting ${amount} ${token || 'USDC'}`,
            [
              { text: 'Cancel', style: 'cancel', onPress: () => setScanned(false) },
              {
                text: 'Review & Pay',
                onPress: () => {
                  router.replace({
                    pathname: '/send' as any,
                    params: {
                      recipient: gpId || walletAddr,
                      amount,
                      token,
                    },
                  });
                },
              },
            ],
          );
        } else {
          // No amount - go directly to send screen
          router.replace({
            pathname: '/send' as any,
            params: {
              recipient: gpId || walletAddr,
              amount: '',
              token,
            },
          });
        }
      } else {
        Alert.alert('Invalid QR', 'This QR code is not a valid GlobalPay payment code.', [
          { text: 'Scan Again', onPress: () => setScanned(false) },
        ]);
      }
    } catch {
      // Check if it's a plain wallet address
      if (data.startsWith('0x') && data.length === 42 && /^0x[a-fA-F0-9]{40}$/.test(data)) {
        router.replace({
          pathname: '/send' as any,
          params: {
            recipient: data,
            amount: '',
            token: '',
          },
        });
        return;
      }

      Alert.alert('Invalid QR', 'Could not read this QR code.', [
        { text: 'Scan Again', onPress: () => setScanned(false) },
      ]);
    }
  };

  if (!permission) {
    return (
      <View style={styles.centered}>
        <Text style={styles.statusText}>Requesting camera permission...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <Text style={styles.statusEmoji}>📷</Text>
        <Text style={styles.statusTitle}>Camera Access Needed</Text>
        <Text style={styles.statusText}>
          Allow camera access to scan QR codes for payments
        </Text>
        <TouchableOpacity style={styles.permButton} onPress={requestPermission}>
          <Text style={styles.permButtonText}>Grant Permission</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.cancelButton} onPress={() => router.back()}>
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
        enableTorch={torchEnabled}
      />

      {/* Overlay */}
      <View style={styles.overlay}>
        {/* Top buttons row */}
        <View style={[styles.topButtonsRow, { top: insets.top + 12 }]}>
          {/* Flashlight toggle */}
          <TouchableOpacity
            style={[styles.iconButton, torchEnabled && styles.iconButtonActive]}
            onPress={toggleTorch}>
            <Text style={styles.iconButtonText}>{torchEnabled ? '🔦' : '💡'}</Text>
          </TouchableOpacity>

          {/* Close button */}
          <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.scanFrame}>
          <View style={styles.cornerTL} />
          <View style={styles.cornerTR} />
          <View style={styles.cornerBL} />
          <View style={styles.cornerBR} />
        </View>

        <Text style={styles.scanHint}>
          Point your camera at a GlobalPay or UPI QR code
        </Text>

        {/* Supported formats info */}
        <View style={styles.formatsContainer}>
          <View style={styles.formatBadge}>
            <Text style={styles.formatBadgeText}>GlobalPay</Text>
          </View>
          <View style={styles.formatBadge}>
            <Text style={styles.formatBadgeText}>UPI</Text>
          </View>
          <View style={styles.formatBadge}>
            <Text style={styles.formatBadgeText}>Wallet Address</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const CORNER_SIZE = 28;
const CORNER_STYLE = {
  width: CORNER_SIZE,
  height: CORNER_SIZE,
  borderColor: GP.primary,
  position: 'absolute' as const,
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
    backgroundColor: GP.background,
  },
  statusEmoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  statusTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: GP.textPrimary,
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  statusText: {
    fontSize: 15,
    color: GP.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
  permButton: {
    backgroundColor: GP.primary,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 36,
    marginTop: 24,
  },
  permButtonText: {
    color: GP.textOnYellow,
    fontSize: 16,
    fontWeight: '800',
  },
  cancelButton: {
    marginTop: 12,
    paddingVertical: 12,
  },
  cancelButtonText: {
    color: GP.textMuted,
    fontSize: 15,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  topButtonsRow: {
    position: 'absolute',
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: GP.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconButtonActive: {
    backgroundColor: GP.primary,
  },
  iconButtonText: {
    fontSize: 22,
  },
  closeText: {
    color: GP.textPrimary,
    fontSize: 20,
    fontWeight: '700',
  },
  scanFrame: {
    width: 240,
    height: 240,
    position: 'relative',
  },
  cornerTL: {
    ...CORNER_STYLE,
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderTopLeftRadius: 14,
  },
  cornerTR: {
    ...CORNER_STYLE,
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderTopRightRadius: 14,
  },
  cornerBL: {
    ...CORNER_STYLE,
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 14,
  },
  cornerBR: {
    ...CORNER_STYLE,
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 14,
  },
  scanHint: {
    color: GP.primary,
    fontSize: 15,
    fontWeight: '700',
    marginTop: 32,
    textAlign: 'center',
  },
  formatsContainer: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 8,
  },
  formatBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  formatBadgeText: {
    color: GP.textPrimary,
    fontSize: 12,
    fontWeight: '600',
  },
});
