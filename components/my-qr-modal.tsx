/**
 * My QR Modal - Google Pay-style QR code display
 * One-tap access to show your payment QR
 */
import { useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  Alert,
  Share,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as MediaLibrary from 'expo-media-library';
import { cacheDirectory, writeAsStringAsync, EncodingType } from 'expo-file-system/legacy';
import { useAuth } from '@/context/auth-context';
import { GP } from '@/constants/colors';
import type { QRPayload } from '@/types';

// Import QR code component
let QRCode: any = null;
try {
  QRCode = require('react-native-qrcode-svg').default;
} catch {}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const QR_SIZE = Math.min(SCREEN_WIDTH - 100, 280);

interface MyQRModalProps {
  visible: boolean;
  onClose: () => void;
}

export default function MyQRModal({ visible, onClose }: MyQRModalProps) {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const qrRef = useRef<any>(null);
  const [saving, setSaving] = useState(false);

  const qrPayload: QRPayload = {
    globalPayId: user?.globalPayId ?? '',
    walletAddress: user?.walletAddress ?? '',
  };

  const qrString = JSON.stringify(qrPayload);

  const copyGlobalPayId = async () => {
    await Clipboard.setStringAsync(user?.globalPayId ?? '');
    Alert.alert('Copied!', 'GlobalPay ID copied to clipboard');
  };

  const saveToGallery = async () => {
    if (!qrRef.current) return;
    setSaving(true);

    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow access to save images.');
        setSaving(false);
        return;
      }

      qrRef.current.toDataURL(async (data: string) => {
        try {
          const filename = `GlobalPay_QR_${Date.now()}.png`;
          const fileUri = `${cacheDirectory}${filename}`;
          await writeAsStringAsync(fileUri, data, { encoding: EncodingType.Base64 });
          const asset = await MediaLibrary.createAssetAsync(fileUri);
          await MediaLibrary.createAlbumAsync('GlobalPay', asset, false);
          Alert.alert('Saved!', 'QR code saved to gallery');
        } catch {
          Alert.alert('Error', 'Failed to save QR code');
        } finally {
          setSaving(false);
        }
      });
    } catch {
      Alert.alert('Error', 'Could not access gallery');
      setSaving(false);
    }
  };

  const shareQR = async () => {
    try {
      await Share.share({
        message: `Pay me on GlobalPay!\n\nGlobalPay ID: ${user?.globalPayId}\n\nDownload GlobalPay to send instant payments.`,
      });
    } catch {}
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { paddingTop: insets.top + 10 }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Ionicons name="close" size={28} color={GP.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>My QR Code</Text>
          <View style={{ width: 44 }} />
        </View>

        {/* QR Card */}
        <View style={styles.qrCard}>
          <View style={styles.qrHeader}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {user?.displayName?.charAt(0)?.toUpperCase() ?? '?'}
              </Text>
            </View>
            <View style={styles.userInfo}>
              <Text style={styles.displayName}>{user?.displayName}</Text>
              <TouchableOpacity onPress={copyGlobalPayId} style={styles.idRow}>
                <Text style={styles.globalPayId}>{user?.globalPayId}</Text>
                <Ionicons name="copy-outline" size={14} color={GP.primary} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.qrWrapper}>
            {QRCode ? (
              <QRCode
                value={qrString}
                size={QR_SIZE}
                color={GP.textOnYellow}
                backgroundColor={GP.primary}
                getRef={(ref: any) => (qrRef.current = ref)}
              />
            ) : (
              <View style={styles.qrPlaceholder}>
                <Text style={styles.qrPlaceholderIcon}>QR</Text>
                <Text style={styles.qrPlaceholderText}>QR Code</Text>
              </View>
            )}
          </View>

          <Text style={styles.instructions}>
            Scan this QR code to pay me instantly
          </Text>
        </View>

        {/* Action Buttons */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={saveToGallery}
            disabled={saving}
          >
            <View style={[styles.actionIcon, { backgroundColor: GP.cardGreen }]}>
              <Ionicons name="download-outline" size={24} color={GP.textOnYellow} />
            </View>
            <Text style={styles.actionLabel}>{saving ? 'Saving...' : 'Save'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionBtn} onPress={shareQR}>
            <View style={[styles.actionIcon, { backgroundColor: GP.cardYellow }]}>
              <Ionicons name="share-outline" size={24} color={GP.textOnYellow} />
            </View>
            <Text style={styles.actionLabel}>Share</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionBtn} onPress={copyGlobalPayId}>
            <View style={[styles.actionIcon, { backgroundColor: GP.cardCoral }]}>
              <Ionicons name="copy-outline" size={24} color={GP.textOnYellow} />
            </View>
            <Text style={styles.actionLabel}>Copy ID</Text>
          </TouchableOpacity>
        </View>

        {/* Wallet Address */}
        <TouchableOpacity
          style={styles.walletCard}
          onPress={async () => {
            await Clipboard.setStringAsync(user?.walletAddress ?? '');
            Alert.alert('Copied!', 'Wallet address copied');
          }}
        >
          <Text style={styles.walletLabel}>Wallet Address</Text>
          <Text style={styles.walletAddress} numberOfLines={1}>
            {user?.walletAddress}
          </Text>
          <Ionicons name="copy-outline" size={16} color={GP.textMuted} style={styles.walletCopyIcon} />
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GP.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: GP.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: GP.textPrimary,
  },
  qrCard: {
    backgroundColor: GP.card,
    borderRadius: 28,
    marginHorizontal: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: GP.border,
  },
  qrHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
    width: '100%',
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: GP.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 24,
    fontWeight: '800',
    color: GP.textOnYellow,
  },
  userInfo: {
    marginLeft: 14,
    flex: 1,
  },
  displayName: {
    fontSize: 20,
    fontWeight: '800',
    color: GP.textPrimary,
  },
  idRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  globalPayId: {
    fontSize: 14,
    fontWeight: '600',
    color: GP.primary,
  },
  qrWrapper: {
    padding: 16,
    backgroundColor: GP.primary,
    borderRadius: 20,
  },
  qrPlaceholder: {
    width: QR_SIZE,
    height: QR_SIZE,
    backgroundColor: GP.surface,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  qrPlaceholderIcon: {
    fontSize: 48,
    fontWeight: '800',
    color: GP.textMuted,
  },
  qrPlaceholderText: {
    marginTop: 8,
    fontSize: 14,
    color: GP.textMuted,
  },
  instructions: {
    marginTop: 20,
    fontSize: 14,
    color: GP.textSecondary,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 32,
    marginTop: 28,
    paddingHorizontal: 20,
  },
  actionBtn: {
    alignItems: 'center',
    gap: 8,
  },
  actionIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: GP.textSecondary,
  },
  walletCard: {
    backgroundColor: GP.card,
    borderRadius: 16,
    marginHorizontal: 20,
    marginTop: 28,
    padding: 16,
    borderWidth: 1,
    borderColor: GP.border,
    position: 'relative',
  },
  walletLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: GP.textMuted,
    marginBottom: 4,
  },
  walletAddress: {
    fontSize: 14,
    fontWeight: '600',
    color: GP.textPrimary,
    paddingRight: 24,
  },
  walletCopyIcon: {
    position: 'absolute',
    right: 16,
    top: '50%',
  },
});
