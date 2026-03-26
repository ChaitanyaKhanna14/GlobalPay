/**
 * NetworkContext - Monitors internet connectivity and shows offline banner
 */
import React, { createContext, useContext, useEffect, useState } from 'react';
import * as Network from 'expo-network';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { GP } from '@/constants/colors';

interface NetworkContextType {
  isConnected: boolean;
  isInternetReachable: boolean;
}

const NetworkContext = createContext<NetworkContextType>({
  isConnected: true,
  isInternetReachable: true,
});

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [isConnected, setIsConnected] = useState(true);
  const [isInternetReachable, setIsInternetReachable] = useState(true);
  const [showBanner, setShowBanner] = useState(false);
  const bannerOpacity = useState(new Animated.Value(0))[0];

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;

    const checkNetwork = async () => {
      try {
        const state = await Network.getNetworkStateAsync();
        const connected = state.isConnected ?? true;
        const reachable = state.isInternetReachable ?? true;

        setIsConnected(connected);
        setIsInternetReachable(reachable);

        if (!connected || !reachable) {
          setShowBanner(true);
          Animated.timing(bannerOpacity, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }).start();
        } else if (showBanner) {
          // Show "back online" briefly, then hide
          Animated.timing(bannerOpacity, {
            toValue: 0,
            duration: 500,
            delay: 1500,
            useNativeDriver: true,
          }).start(() => setShowBanner(false));
        }
      } catch {
        // Network check failed — assume connected
      }
    };

    checkNetwork();
    // Poll every 5 seconds (expo-network doesn't have a listener API on all platforms)
    interval = setInterval(checkNetwork, 5000);

    return () => clearInterval(interval);
  }, [showBanner]);

  return (
    <NetworkContext.Provider value={{ isConnected, isInternetReachable }}>
      {children}
      {showBanner && (
        <Animated.View style={[styles.banner, { opacity: bannerOpacity }]}>
          <Text style={styles.bannerText}>
            {isConnected && isInternetReachable ? '✅ Back online' : '📡 No internet connection'}
          </Text>
        </Animated.View>
      )}
    </NetworkContext.Provider>
  );
}

export function useNetwork() {
  return useContext(NetworkContext);
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: GP.error,
    paddingTop: 50,
    paddingBottom: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    zIndex: 9999,
  },
  bannerText: {
    color: GP.white,
    fontSize: 14,
    fontWeight: '700',
  },
});
