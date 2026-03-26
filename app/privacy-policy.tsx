/**
 * Privacy Policy Screen
 * Required for App Store / Play Store submission.
 */
import { ScrollView, Text, View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { GP } from '@/constants/colors';

export default function PrivacyPolicyScreen() {
  const insets = useSafeAreaInsets();

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Privacy Policy' }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}>
        <Text style={styles.heading}>Privacy Policy</Text>
        <Text style={styles.updated}>Last updated: {new Date().toLocaleDateString()}</Text>

        <Section title="1. Introduction">
          GlobalPay ("we", "our", or "us") is committed to protecting your privacy. This Privacy
          Policy explains how we collect, use, disclose, and safeguard your information when you use
          our mobile application ("App"). Please read this policy carefully.
        </Section>

        <Section title="2. Information We Collect">
          {'• '}Account Information: When you create an account, we collect your email address,
          GlobalPay ID, and an encrypted version of your wallet credentials stored locally on your
          device.{'\n\n'}
          {'• '}Transaction Data: We record transaction metadata (amounts, timestamps, wallet
          addresses, and GlobalPay IDs) to provide your transaction history.{'\n\n'}
          {'• '}Device Information: We may collect device type, operating system version, and unique
          device identifiers for crash reporting and analytics.{'\n\n'}
          {'• '}Push Notification Tokens: If you enable notifications, we store your push token to
          deliver payment alerts.
        </Section>

        <Section title="3. How We Use Your Information">
          We use the information we collect to:{'\n\n'}
          {'• '}Provide and maintain the App{'\n'}
          {'• '}Process and record your transactions{'\n'}
          {'• '}Send you transaction notifications{'\n'}
          {'• '}Detect and prevent fraud{'\n'}
          {'• '}Improve our services and user experience{'\n'}
          {'• '}Comply with legal obligations
        </Section>

        <Section title="4. Data Storage & Security">
          Your wallet private keys are encrypted and stored exclusively on your device using secure
          hardware-backed storage (Keychain on iOS, Keystore on Android). We never have access to
          your private keys.{'\n\n'}
          Account data is stored on secure Supabase servers with row-level security policies. All
          data in transit is encrypted using TLS 1.2+.
        </Section>

        <Section title="5. Third-Party Services">
          We use the following third-party services:{'\n\n'}
          {'• '}Supabase – authentication and database{'\n'}
          {'• '}Sentry – crash reporting and error monitoring{'\n'}
          {'• '}Polygon Network – blockchain transaction processing{'\n'}
          {'• '}Expo – push notification delivery{'\n\n'}
          Each of these services has their own privacy policy governing their use of your data.
        </Section>

        <Section title="6. Data Sharing">
          We do not sell your personal information. We may share information only:{'\n\n'}
          {'• '}With your consent{'\n'}
          {'• '}To comply with legal obligations{'\n'}
          {'• '}To protect our rights and prevent fraud{'\n'}
          {'• '}With service providers who assist in operating the App (under strict data processing
          agreements)
        </Section>

        <Section title="7. Your Rights">
          You have the right to:{'\n\n'}
          {'• '}Access the personal data we hold about you{'\n'}
          {'• '}Request correction of inaccurate data{'\n'}
          {'• '}Request deletion of your account and data{'\n'}
          {'• '}Export your transaction history{'\n'}
          {'• '}Opt out of push notifications at any time
        </Section>

        <Section title="8. Data Retention">
          We retain your account data for as long as your account is active. Transaction records are
          retained in accordance with applicable financial regulations. You may request account
          deletion by contacting us.
        </Section>

        <Section title="9. Children's Privacy">
          The App is not intended for users under the age of 18. We do not knowingly collect
          information from children under 18.
        </Section>

        <Section title="10. Changes to This Policy">
          We may update this Privacy Policy from time to time. We will notify you of any material
          changes through the App or by email. Your continued use of the App after changes
          constitutes acceptance.
        </Section>

        <Section title="11. Contact Us">
          If you have questions about this Privacy Policy, please contact us at:{'\n\n'}
          Email: privacy@globalpay.app
        </Section>
      </ScrollView>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionBody}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GP.background,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  heading: {
    fontSize: 28,
    fontWeight: '800',
    color: GP.textPrimary,
    letterSpacing: -0.3,
  },
  updated: {
    fontSize: 13,
    color: GP.textSecondary,
    marginTop: 4,
    marginBottom: 24,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: GP.primary,
    marginBottom: 8,
  },
  sectionBody: {
    fontSize: 15,
    color: GP.textSecondary,
    lineHeight: 22,
  },
});
