/**
 * 404 - Not Found screen for expo-router
 */
import { Link, Stack } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { GP } from '@/constants/colors';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Oops!' }} />
      <View style={styles.container}>
        <Text style={styles.emoji}>🔍</Text>
        <Text style={styles.title}>Page not found</Text>
        <Link href="/(tabs)" style={styles.link}>
          <Text style={styles.linkText}>Go to home</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GP.background,
    padding: 24,
  },
  emoji: { fontSize: 48, marginBottom: 16 },
  title: { fontSize: 20, fontWeight: '800', color: GP.textPrimary, letterSpacing: -0.3 },
  link: { marginTop: 24 },
  linkText: { fontSize: 16, color: GP.primary, fontWeight: '700' },
});
