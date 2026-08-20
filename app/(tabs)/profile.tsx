/**
 * Profile Tab - User info, GlobalPay ID, wallet, settings (dark theme)
 */
import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { useAuth } from '@/context/auth-context';
import { useAppLock } from '@/context/app-lock-context';
import { walletService } from '@/services/wallet';
import { recordKeyExported } from '@/services/security/instrument';
import { GP } from '@/constants/colors';

const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';
const BUILD_NUMBER =
  Constants.expoConfig?.ios?.buildNumber ??
  Constants.expoConfig?.android?.versionCode?.toString() ??
  '1';

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const { isLockEnabled, hasBiometrics, biometricType, enableLock, disableLock, authenticateForAction, setPin } = useAppLock();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [currency, setCurrency] = useState('USDC');

  // Load saved currency on mount
  useEffect(() => {
    AsyncStorage.getItem('gp_default_currency').then((v) => { if (v) setCurrency(v); });
  }, []);

  const CURRENCIES = [
    { code: 'USDC', label: 'USDC (US Dollar Coin)' },
    { code: 'USDT', label: 'USDT (Tether)' },
    { code: 'ETH', label: 'ETH (Ethereum)' },
    { code: 'MATIC', label: 'MATIC (Polygon)' },
    { code: 'WBTC', label: 'WBTC (Wrapped Bitcoin)' },
  ];

  const handleCurrencyPicker = () => {
    Alert.alert(
      'Default Currency',
      'Select your preferred default token for transactions',
      [
        ...CURRENCIES.map((c) => ({
          text: `${c.code === currency ? '✓ ' : ''}${c.label}`,
          onPress: async () => {
            setCurrency(c.code);
            await AsyncStorage.setItem('gp_default_currency', c.code);
          },
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ],
    );
  };

  const copyToClipboard = async (text: string, label: string) => {
    await Clipboard.setStringAsync(text);
    Alert.alert('Copied!', `${label} copied to clipboard`);
  };

  const handleToggleLock = async () => {
    if (isLockEnabled) {
      const authed = await authenticateForAction('Authenticate to disable lock');
      if (authed) {
        await disableLock();
        Alert.alert('App Lock Disabled', 'Biometric/PIN lock has been turned off.');
      }
    } else {
      await enableLock();
      if (!hasBiometrics) {
        // Prompt to set a PIN if no biometrics available
        Alert.prompt?.('Set a 4-digit PIN', 'This PIN will be used to unlock the app.', async (pinText: string) => {
          if (pinText && pinText.length === 4) {
            await setPin(pinText);
            Alert.alert('PIN Set!', 'Your app is now protected.');
          }
        }) ?? Alert.alert('App Lock Enabled', 'Use biometric authentication to unlock the app.');
      } else {
        Alert.alert('App Lock Enabled', `${biometricType ?? 'Biometric'} authentication is now required.`);
      }
    }
  };

  const handleExportWallet = async () => {
    // Always require authentication before showing private key
    if (isLockEnabled) {
      const authed = await authenticateForAction('Authenticate to export wallet');
      if (!authed) {
        Alert.alert('Authentication Failed', 'You must authenticate to export your wallet.');
        return;
      }
    } else {
      // Force user to set up app lock before exporting
      Alert.alert(
        'Security Required',
        'You must enable App Lock (biometrics or PIN) before exporting your private key.',
        [{ text: 'OK', style: 'default' }],
      );
      return;
    }

    Alert.alert(
      '⚠️ Export Private Key',
      'Your private key gives full access to your wallet. Never share it with anyone.\n\nExport now?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Export',
          style: 'destructive',
          onPress: async () => {
            try {
              const pk = await walletService.getPrivateKeyForExport(user?.id);
              if (!pk) {
                Alert.alert('Error', 'No wallet found on this device.');
              } else {
                // Logged whether or not the export is legitimate: these wallets
                // are non-custodial, so this is the single most consequential
                // action available in the app and it must always leave a trace.
                recordKeyExported(user?.id ?? 'anonymous', user?.globalPayId);
                Alert.alert(
                  'Your Private Key',
                  pk,
                  [
                    {
                      text: 'Copy to Clipboard',
                      onPress: async () => {
                        await Clipboard.setStringAsync(pk);
                        // Auto-clear clipboard after 15 seconds
                        setTimeout(() => {
                          Clipboard.setStringAsync('').catch(() => {});
                        }, 15_000);
                        Alert.alert('Copied!', 'Private key copied. It will be auto-cleared from clipboard in 15 seconds.');
                      },
                    },
                    { text: 'Close', style: 'cancel' },
                  ],
                );
              }
            } catch (e: any) {
              Alert.alert('Error', e.message ?? 'Failed to export wallet');
            }
          },
        },
      ],
    );
  };

  const handleSecurity = () => {
    Alert.alert(
      '🔐 Security Info',
      'Your private key is stored securely on this device using the system keychain.\n\n' +
      '• Never share your private key\n' +
      '• Back up your wallet using Export\n' +
      '• Use a strong account password\n\n' +
      'Network: Polygon (MATIC)\nEncryption: SecureStore (Keychain/Keystore)',
      [{ text: 'OK' }],
    );
  };

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
    <ScrollView
      style={{ flex: 1, backgroundColor: GP.background }}
      contentContainerStyle={{ paddingTop: 16, paddingBottom: insets.bottom + 20 }}>
      <Text style={styles.title}>Profile</Text>

      {/* Avatar & Name */}
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {user?.displayName?.charAt(0)?.toUpperCase() ?? '?'}
          </Text>
        </View>
        <Text style={styles.displayName}>{user?.displayName}</Text>
        <Text style={styles.email}>{user?.email}</Text>
      </View>

      {/* GlobalPay ID */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>GlobalPay ID</Text>
        <TouchableOpacity
          style={styles.infoRow}
          onPress={() => copyToClipboard(user?.globalPayId ?? '', 'GlobalPay ID')}>
          <View style={[styles.infoIconWrap, { backgroundColor: GP.cardYellow }]}>
            <Text style={styles.infoEmoji}>⚡</Text>
          </View>
          <View style={styles.infoContent}>
            <Text style={styles.infoValue}>{user?.globalPayId}</Text>
            <Text style={styles.infoHint}>Tap to copy · Share this to receive payments</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Wallet Address */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Wallet</Text>
        <TouchableOpacity
          style={styles.infoRow}
          onPress={() => copyToClipboard(user?.walletAddress ?? '', 'Wallet address')}>
          <View style={[styles.infoIconWrap, { backgroundColor: GP.cardGreen }]}>
            <Text style={styles.infoEmoji}>💳</Text>
          </View>
          <View style={styles.infoContent}>
            <Text style={styles.infoValue}>
              {user?.walletAddress
                ? `${user.walletAddress.slice(0, 10)}...${user.walletAddress.slice(-8)}`
                : 'No wallet'}
            </Text>
            <Text style={styles.infoHint}>Polygon Network · Tap to copy full address</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Settings */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Settings</Text>

        <TouchableOpacity style={styles.menuRow} onPress={handleToggleLock}>
          <View style={[styles.menuIconWrap, { backgroundColor: GP.primary }]}>
            <Text style={styles.menuEmoji}>{isLockEnabled ? '🔒' : '🔓'}</Text>
          </View>
          <Text style={styles.menuLabel}>App Lock</Text>
          <View style={styles.menuValueBadge}>
            <Text style={styles.menuValue}>{isLockEnabled ? 'ON' : 'OFF'}</Text>
          </View>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.menuRow} onPress={handleSecurity}>
          <View style={[styles.menuIconWrap, { backgroundColor: GP.cardCoral }]}>
            <Text style={styles.menuEmoji}>🔐</Text>
          </View>
          <Text style={styles.menuLabel}>Security</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.menuRow} onPress={() => router.push('/soc' as any)}>
          <View style={[styles.menuIconWrap, { backgroundColor: GP.cardMint }]}>
            <Text style={styles.menuEmoji}>🛡️</Text>
          </View>
          <Text style={styles.menuLabel}>Security Center</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.menuRow} onPress={() => router.push('/linked-accounts')}>
          <View style={[styles.menuIconWrap, { backgroundColor: GP.cardOrange }]}>
            <Text style={styles.menuEmoji}>🏦</Text>
          </View>
          <Text style={styles.menuLabel}>Linked Accounts</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.menuRow} onPress={handleCurrencyPicker}>
          <View style={[styles.menuIconWrap, { backgroundColor: GP.cardOrange }]}>
            <Text style={styles.menuEmoji}>🌐</Text>
          </View>
          <Text style={styles.menuLabel}>Default Currency</Text>
          <View style={styles.menuValueBadge}>
            <Text style={styles.menuValue}>{currency}</Text>
          </View>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.menuRow} onPress={handleExportWallet}>
          <View style={[styles.menuIconWrap, { backgroundColor: GP.cardMint }]}>
            <Text style={styles.menuEmoji}>📄</Text>
          </View>
          <Text style={styles.menuLabel}>Export Wallet</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Legal */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Legal</Text>

        <TouchableOpacity style={styles.menuRow} onPress={() => router.push('/privacy-policy' as any)}>
          <View style={[styles.menuIconWrap, { backgroundColor: GP.cardGreen }]}>
            <Text style={styles.menuEmoji}>🔒</Text>
          </View>
          <Text style={styles.menuLabel}>Privacy Policy</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.menuRow} onPress={() => router.push('/terms-of-service' as any)}>
          <View style={[styles.menuIconWrap, { backgroundColor: GP.cardGreen }]}>
            <Text style={styles.menuEmoji}>📜</Text>
          </View>
          <Text style={styles.menuLabel}>Terms of Service</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Logout */}
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>Sign Out</Text>
      </TouchableOpacity>

      {/* Version info */}
      <Text style={styles.versionText}>GlobalPay v{APP_VERSION} (build {BUILD_NUMBER})</Text>
    </ScrollView>
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
  profileCard: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 24,
    backgroundColor: GP.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  avatarText: {
    fontSize: 30,
    fontWeight: '800',
    color: GP.textOnYellow,
  },
  displayName: {
    fontSize: 22,
    fontWeight: '800',
    color: GP.textPrimary,
  },
  email: {
    fontSize: 14,
    color: GP.textSecondary,
    marginTop: 2,
  },
  section: {
    paddingHorizontal: 20,
    marginTop: 20,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: GP.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: GP.card,
    borderRadius: 16,
    padding: 16,
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
  infoValue: {
    fontSize: 15,
    fontWeight: '700',
    color: GP.textPrimary,
  },
  infoHint: {
    fontSize: 12,
    color: GP.textMuted,
    marginTop: 2,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: GP.card,
    borderRadius: 16,
    padding: 14,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: GP.border,
  },
  menuIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  menuEmoji: {
    fontSize: 16,
  },
  menuLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: GP.textPrimary,
  },
  menuValueBadge: {
    backgroundColor: GP.surface,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 8,
  },
  menuValue: {
    fontSize: 13,
    fontWeight: '700',
    color: GP.primary,
  },
  menuArrow: {
    fontSize: 22,
    color: GP.textMuted,
    fontWeight: '300',
  },
  logoutButton: {
    marginHorizontal: 20,
    marginTop: 32,
    backgroundColor: GP.cardCoral,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '700',
    color: GP.white,
  },
  versionText: {
    textAlign: 'center',
    fontSize: 12,
    color: GP.textMuted,
    marginTop: 16,
    marginBottom: 32,
  },
});
