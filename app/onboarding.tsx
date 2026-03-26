/**
 * Onboarding Screen – shown once on first app launch.
 * Swipeable pages introducing GlobalPay features.
 */
import { useState, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Dimensions,
  StyleSheet,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GP } from '@/constants/colors';

const { width } = Dimensions.get('window');

const ONBOARDING_KEY = 'globalpay_onboarding_completed';

interface OnboardingPage {
  id: string;
  icon: string;
  title: string;
  subtitle: string;
  color: string;
}

const PAGES: OnboardingPage[] = [
  {
    id: '1',
    icon: '🌍',
    title: 'Welcome to GlobalPay',
    subtitle:
      'Send and receive money anywhere in the world — instantly, securely, and with near-zero fees.',
    color: GP.cardYellow,
  },
  {
    id: '2',
    icon: '🔐',
    title: 'Your Wallet, Your Keys',
    subtitle:
      'GlobalPay creates a non-custodial wallet just for you. Only you control your funds — we never hold your crypto.',
    color: GP.cardGreen,
  },
  {
    id: '3',
    icon: '⚡',
    title: 'Powered by Polygon',
    subtitle:
      'Transactions settle in seconds on the Polygon network with fees under a cent. Send USDC, USDT, POL, and more.',
    color: GP.cardCoral,
  },
  {
    id: '4',
    icon: '📲',
    title: 'Pay Anyone with a GP ID',
    subtitle:
      'No wallet addresses needed. Share your GlobalPay ID and get paid — or scan a QR code to send instantly.',
    color: GP.cardMint,
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / width);
    setCurrentIndex(index);
  };

  const handleNext = () => {
    if (currentIndex < PAGES.length - 1) {
      flatListRef.current?.scrollToIndex({ index: currentIndex + 1, animated: true });
    } else {
      completeOnboarding();
    }
  };

  const completeOnboarding = async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
    router.replace('/(auth)/login');
  };

  const renderPage = ({ item }: { item: OnboardingPage }) => (
    <View style={[styles.page, { width }]}>
      <View style={[styles.iconCircle, { backgroundColor: item.color }]}>
        <Text style={styles.icon}>{item.icon}</Text>
      </View>
      <Text style={styles.pageTitle}>{item.title}</Text>
      <Text style={styles.pageSubtitle}>{item.subtitle}</Text>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom + 20 }]}>
      <FlatList
        ref={flatListRef}
        data={PAGES}
        renderItem={renderPage}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      />

      {/* Dots */}
      <View style={styles.dotRow}>
        {PAGES.map((_, i) => (
          <View
            key={i}
            style={[styles.dot, currentIndex === i && styles.dotActive]}
          />
        ))}
      </View>

      {/* Buttons */}
      <View style={styles.buttonRow}>
        <TouchableOpacity onPress={completeOnboarding}>
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.nextBtn} onPress={handleNext}>
          <Text style={styles.nextBtnText}>
            {currentIndex === PAGES.length - 1 ? 'Get Started' : 'Next'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/** Check if onboarding has been completed */
export async function hasCompletedOnboarding(): Promise<boolean> {
  const value = await AsyncStorage.getItem(ONBOARDING_KEY);
  return value === 'true';
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GP.background,
  },
  page: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  iconCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 32,
  },
  icon: {
    fontSize: 52,
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: GP.textPrimary,
    textAlign: 'center',
    marginBottom: 16,
    letterSpacing: -0.3,
  },
  pageSubtitle: {
    fontSize: 16,
    color: GP.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
  },
  dotRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: GP.border,
    marginHorizontal: 4,
  },
  dotActive: {
    backgroundColor: GP.primary,
    width: 24,
    borderRadius: 12,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  skipText: {
    fontSize: 16,
    color: GP.textSecondary,
    fontWeight: '600',
  },
  nextBtn: {
    backgroundColor: GP.primary,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 14,
  },
  nextBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: GP.textOnYellow,
  },
});
