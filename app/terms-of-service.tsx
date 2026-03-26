/**
 * Terms of Service Screen
 * Required for App Store / Play Store submission.
 */
import { ScrollView, Text, View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { GP } from '@/constants/colors';

export default function TermsOfServiceScreen() {
  const insets = useSafeAreaInsets();

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Terms of Service' }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}>
        <Text style={styles.heading}>Terms of Service</Text>
        <Text style={styles.updated}>Last updated: {new Date().toLocaleDateString()}</Text>

        <Section title="1. Acceptance of Terms">
          By downloading, installing, or using the GlobalPay mobile application ("App"), you agree to
          be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, do not
          use the App.
        </Section>

        <Section title="2. Description of Service">
          GlobalPay is a non-custodial cryptocurrency wallet application that enables users to send,
          receive, and manage digital assets on the Polygon blockchain network. We provide the
          software interface but do not hold, control, or have access to your funds.
        </Section>

        <Section title="3. Eligibility">
          You must be at least 18 years old and legally able to enter into binding contracts in your
          jurisdiction to use the App. By using the App, you represent and warrant that you meet these
          requirements.
        </Section>

        <Section title="4. Account Registration">
          To use the App, you must create an account with a valid email address and a unique GlobalPay
          ID.{'\n\n'}
          You are responsible for:{'\n'}
          {'• '}Maintaining the security of your account credentials{'\n'}
          {'• '}Safeguarding your wallet recovery phrase and PIN{'\n'}
          {'• '}All activity that occurs under your account{'\n\n'}
          We cannot recover your wallet if you lose your credentials. You acknowledge that you are
          solely responsible for securing your private keys.
        </Section>

        <Section title="5. Non-Custodial Wallet">
          GlobalPay is a non-custodial service. This means:{'\n\n'}
          {'• '}Your private keys are stored exclusively on your device{'\n'}
          {'• '}We never have access to your private keys or funds{'\n'}
          {'• '}We cannot reverse, cancel, or refund transactions{'\n'}
          {'• '}You are solely responsible for your wallet security{'\n'}
          {'• '}Loss of your device or credentials may result in permanent loss of funds
        </Section>

        <Section title="6. Transactions">
          All transactions are processed on the Polygon blockchain and are irreversible once
          confirmed.{'\n\n'}
          You acknowledge that:{'\n'}
          {'• '}Transaction fees (gas) are paid to network validators, not to GlobalPay{'\n'}
          {'• '}Transaction times depend on network conditions{'\n'}
          {'• '}You are responsible for verifying recipient addresses before sending{'\n'}
          {'• '}Sending funds to an incorrect address may result in permanent loss
        </Section>

        <Section title="7. Prohibited Uses">
          You agree not to use the App to:{'\n\n'}
          {'• '}Violate any applicable laws or regulations{'\n'}
          {'• '}Engage in money laundering, terrorist financing, or other illegal activities{'\n'}
          {'• '}Attempt to circumvent security features of the App{'\n'}
          {'• '}Interfere with or disrupt the App or its infrastructure{'\n'}
          {'• '}Use the App for unauthorized commercial purposes{'\n'}
          {'• '}Create multiple accounts for fraudulent purposes
        </Section>

        <Section title="8. Intellectual Property">
          The App and its original content, features, and functionality are owned by GlobalPay and are
          protected by international copyright, trademark, and other intellectual property laws.
        </Section>

        <Section title="9. Disclaimer of Warranties">
          The App is provided "AS IS" and "AS AVAILABLE" without warranties of any kind.{'\n\n'}
          We do not warrant that:{'\n'}
          {'• '}The App will be uninterrupted or error-free{'\n'}
          {'• '}Defects will be corrected{'\n'}
          {'• '}The App is free of viruses or harmful components{'\n'}
          {'• '}The results of using the App will meet your requirements
        </Section>

        <Section title="10. Limitation of Liability">
          To the maximum extent permitted by law, GlobalPay shall not be liable for any indirect,
          incidental, special, consequential, or punitive damages, including but not limited to loss
          of profits, data, or digital assets, resulting from your use of the App.{'\n\n'}
          This includes, without limitation, losses resulting from:{'\n'}
          {'• '}Unauthorized access to your wallet{'\n'}
          {'• '}Transactions sent to incorrect addresses{'\n'}
          {'• '}Blockchain network issues or downtime{'\n'}
          {'• '}Price volatility of digital assets
        </Section>

        <Section title="11. Indemnification">
          You agree to indemnify and hold harmless GlobalPay and its officers, directors, employees,
          and agents from any claims, damages, losses, or expenses arising out of your use of the App
          or violation of these Terms.
        </Section>

        <Section title="12. Modifications to Terms">
          We reserve the right to modify these Terms at any time. Material changes will be notified
          through the App. Your continued use of the App after changes constitutes acceptance of the
          revised Terms.
        </Section>

        <Section title="13. Termination">
          We may terminate or suspend your access to the App at any time, without prior notice, for
          conduct that we believe violates these Terms or is harmful to other users, us, or third
          parties. Your funds remain accessible via your private keys even after account termination.
        </Section>

        <Section title="14. Governing Law">
          These Terms shall be governed by and construed in accordance with the laws of the
          jurisdiction in which GlobalPay operates, without regard to its conflict of law provisions.
        </Section>

        <Section title="15. Contact Us">
          If you have questions about these Terms, please contact us at:{'\n\n'}
          Email: legal@globalpay.app
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
