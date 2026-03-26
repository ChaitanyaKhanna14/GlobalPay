/**
 * Skeleton - Animated loading placeholder component
 * Use for content that hasn't loaded yet
 */
import { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, ViewStyle } from 'react-native';
import { GP } from '@/constants/colors';

interface SkeletonProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export function Skeleton({
  width = '100%',
  height = 16,
  borderRadius = 8,
  style,
}: SkeletonProps) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.7,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, []);

  return (
    <Animated.View
      style={[
        {
          width: width as any,
          height,
          borderRadius,
          backgroundColor: GP.surface,
          opacity,
        },
        style,
      ]}
    />
  );
}

/**
 * Pre-built skeleton layouts for common views
 */
export function BalanceCardSkeleton() {
  return (
    <View style={skeletonStyles.balanceCard}>
      <Skeleton width={100} height={14} />
      <Skeleton width={180} height={42} borderRadius={12} style={{ marginTop: 8 }} />
      <Skeleton width={140} height={12} style={{ marginTop: 12 }} />
    </View>
  );
}

export function TokenRowSkeleton() {
  return (
    <View style={skeletonStyles.tokenRow}>
      <Skeleton width={42} height={42} borderRadius={14} />
      <View style={{ flex: 1, marginLeft: 12, gap: 6 }}>
        <Skeleton width={100} height={15} />
        <Skeleton width={60} height={13} />
      </View>
      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        <Skeleton width={70} height={15} />
        <Skeleton width={50} height={13} />
      </View>
    </View>
  );
}

export function TokenListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <View style={{ gap: 8 }}>
      {Array.from({ length: count }).map((_, i) => (
        <TokenRowSkeleton key={i} />
      ))}
    </View>
  );
}

export function TransactionCardSkeleton() {
  return (
    <View style={skeletonStyles.txCard}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <Skeleton width={34} height={34} borderRadius={17} />
        <Skeleton width={140} height={16} style={{ marginLeft: 10 }} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Skeleton width={120} height={12} />
        <Skeleton width={80} height={15} />
      </View>
    </View>
  );
}

export function TransactionListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View style={{ gap: 10, paddingHorizontal: 20 }}>
      {Array.from({ length: count }).map((_, i) => (
        <TransactionCardSkeleton key={i} />
      ))}
    </View>
  );
}

const skeletonStyles = StyleSheet.create({
  balanceCard: {
    backgroundColor: GP.card,
    borderRadius: 22,
    marginHorizontal: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: GP.border,
  },
  tokenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: GP.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: GP.border,
  },
  txCard: {
    borderRadius: 18,
    padding: 18,
    backgroundColor: GP.card,
    borderWidth: 1,
    borderColor: GP.border,
  },
});
