/**
 * Request Details Screen - View and respond to a payment request
 * Shows request details with Pay and Decline options
 */
import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/supabase';
import { priceService } from '@/services/price';
import { GP } from '@/constants/colors';
import { TOKENS } from '@/constants/tokens';
import type { PaymentRequest, SupportedToken } from '@/types';

interface RequestDetails {
  id: string;
  fromGlobalPayId: string;
  fromDisplayName?: string;
  toGlobalPayId: string;
  amount: string;
  token: SupportedToken;
  note?: string;
  status: 'pending' | 'paid' | 'declined' | 'expired';
  expiresAt: string;
  createdAt: string;
}

export default function RequestDetailsScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string }>();
  const requestId = params.id;

  const [request, setRequest] = useState<RequestDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [amountUsd, setAmountUsd] = useState<string | null>(null);

  useEffect(() => {
    if (requestId) {
      fetchRequestDetails();
    }
  }, [requestId]);

  const fetchRequestDetails = async () => {
    setLoading(true);
    try {
      // Fetch the payment request
      const { data: requestData, error: requestError } = await supabase
        .from('payment_requests')
        .select('*')
        .eq('id', requestId)
        .single();

      if (requestError || !requestData) {
        Alert.alert('Error', 'Payment request not found.', [
          { text: 'Go Back', onPress: () => router.back() },
        ]);
        setLoading(false);
        return;
      }

      // Fetch sender's display name
      const { data: senderData } = await supabase
        .from('users')
        .select('display_name')
        .eq('global_pay_id', requestData.from_global_pay_id)
        .single();

      const details: RequestDetails = {
        id: requestData.id,
        fromGlobalPayId: requestData.from_global_pay_id,
        fromDisplayName: senderData?.display_name,
        toGlobalPayId: requestData.to_global_pay_id,
        amount: requestData.amount,
        token: requestData.token as SupportedToken,
        note: requestData.note,
        status: requestData.status,
        expiresAt: requestData.expires_at,
        createdAt: requestData.created_at,
      };

      setRequest(details);

      // Get USD value
      try {
        const price = await priceService.getPrice(details.token);
        const usd = (parseFloat(details.amount) * price.priceUsd).toFixed(2);
        setAmountUsd(usd);
      } catch {}
    } catch (e) {
      console.warn('[RequestDetails] Error fetching:', e);
      Alert.alert('Error', 'Failed to load request details.', [
        { text: 'Go Back', onPress: () => router.back() },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handlePay = () => {
    if (!request) return;

    // Navigate to send screen with pre-filled data
    router.push({
      pathname: '/send' as any,
      params: {
        recipient: request.fromGlobalPayId,
        amount: request.amount,
        token: request.token,
        requestId: request.id, // Pass request ID to mark as paid after success
      },
    });
  };

  const handleDecline = async () => {
    if (!request) return;

    Alert.alert(
      'Decline Request',
      `Are you sure you want to decline this request from ${request.fromDisplayName || request.fromGlobalPayId}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Decline',
          style: 'destructive',
          onPress: async () => {
            setActionLoading(true);
            try {
              const { error } = await supabase
                .from('payment_requests')
                .update({ status: 'declined' })
                .eq('id', request.id);

              if (error) {
                Alert.alert('Error', 'Failed to decline request. Please try again.');
              } else {
                Alert.alert('Declined', 'Payment request has been declined.', [
                  { text: 'OK', onPress: () => router.back() },
                ]);
              }
            } catch (e) {
              Alert.alert('Error', 'Something went wrong. Please try again.');
            } finally {
              setActionLoading(false);
            }
          },
        },
      ],
    );
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'pending':
        return GP.primary;
      case 'paid':
        return GP.success;
      case 'declined':
        return GP.error;
      case 'expired':
        return GP.textMuted;
      default:
        return GP.textSecondary;
    }
  };

  const getStatusLabel = (status: string): string => {
    return status.charAt(0).toUpperCase() + status.slice(1);
  };

  const isExpired = (expiresAt: string): boolean => {
    return new Date(expiresAt) < new Date();
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={GP.primary} />
        <Text style={styles.loadingText}>Loading request...</Text>
      </View>
    );
  }

  if (!request) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorEmoji}>❌</Text>
        <Text style={styles.errorTitle}>Request Not Found</Text>
        <Text style={styles.errorText}>This payment request may have been deleted or doesn't exist.</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const expired = isExpired(request.expiresAt);
  const isPending = request.status === 'pending' && !expired;
  const tokenConfig = TOKENS[request.token];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: insets.bottom + 20, paddingTop: 20 }}>
      {/* Status Badge */}
      <View style={styles.statusContainer}>
        <View style={[styles.statusBadge, { backgroundColor: getStatusColor(expired ? 'expired' : request.status) }]}>
          <Text style={styles.statusText}>
            {expired ? 'Expired' : getStatusLabel(request.status)}
          </Text>
        </View>
      </View>

      {/* Amount Card */}
      <View style={styles.amountCard}>
        <Text style={styles.amountLabel}>Amount Requested</Text>
        <View style={styles.amountRow}>
          <Text style={styles.tokenEmoji}>{tokenConfig?.iconEmoji || '💰'}</Text>
          <Text style={styles.amountValue}>{request.amount}</Text>
          <Text style={styles.tokenSymbol}>{request.token}</Text>
        </View>
        {amountUsd && (
          <Text style={styles.amountUsd}>~${amountUsd} USD</Text>
        )}
      </View>

      {/* Request Details */}
      <View style={styles.detailsCard}>
        <Text style={styles.detailsTitle}>Request Details</Text>

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>From</Text>
          <View style={styles.detailValueContainer}>
            {request.fromDisplayName && (
              <Text style={styles.detailName}>{request.fromDisplayName}</Text>
            )}
            <Text style={styles.detailValue}>{request.fromGlobalPayId}</Text>
          </View>
        </View>

        <View style={styles.detailDivider} />

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>To</Text>
          <Text style={styles.detailValue}>{request.toGlobalPayId}</Text>
        </View>

        <View style={styles.detailDivider} />

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Created</Text>
          <Text style={styles.detailValue}>{formatDate(request.createdAt)}</Text>
        </View>

        <View style={styles.detailDivider} />

        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Expires</Text>
          <Text style={[styles.detailValue, expired && styles.expiredText]}>
            {formatDate(request.expiresAt)}
            {expired && ' (Expired)'}
          </Text>
        </View>

        {request.note && (
          <>
            <View style={styles.detailDivider} />
            <View style={styles.noteSection}>
              <Text style={styles.detailLabel}>Message</Text>
              <Text style={styles.noteText}>{request.note}</Text>
            </View>
          </>
        )}
      </View>

      {/* Action Buttons - Only show for pending requests */}
      {isPending && (
        <View style={styles.actionsContainer}>
          <TouchableOpacity
            style={[styles.actionButton, styles.declineButton, actionLoading && styles.actionButtonDisabled]}
            onPress={handleDecline}
            disabled={actionLoading}>
            <Text style={styles.declineButtonText}>
              {actionLoading ? 'Processing...' : 'Decline'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, styles.payButton, actionLoading && styles.actionButtonDisabled]}
            onPress={handlePay}
            disabled={actionLoading}>
            <Text style={styles.payButtonText}>
              Pay {request.amount} {request.token}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Status messages for non-pending requests */}
      {!isPending && (
        <View style={styles.statusMessageContainer}>
          {request.status === 'paid' && (
            <View style={styles.statusMessage}>
              <Text style={styles.statusMessageEmoji}>✅</Text>
              <Text style={styles.statusMessageText}>This request has been paid.</Text>
            </View>
          )}
          {request.status === 'declined' && (
            <View style={styles.statusMessage}>
              <Text style={styles.statusMessageEmoji}>❌</Text>
              <Text style={styles.statusMessageText}>This request was declined.</Text>
            </View>
          )}
          {expired && request.status === 'pending' && (
            <View style={styles.statusMessage}>
              <Text style={styles.statusMessageEmoji}>⏰</Text>
              <Text style={styles.statusMessageText}>This request has expired.</Text>
            </View>
          )}
        </View>
      )}

      {/* Back button */}
      <TouchableOpacity style={styles.backLinkButton} onPress={() => router.back()}>
        <Text style={styles.backLinkText}>← Back to Activity</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GP.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: GP.background,
    gap: 16,
  },
  loadingText: {
    color: GP.textSecondary,
    fontSize: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: GP.background,
    padding: 40,
  },
  errorEmoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: GP.textPrimary,
    marginBottom: 8,
  },
  errorText: {
    fontSize: 15,
    color: GP.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
  backButton: {
    backgroundColor: GP.primary,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 32,
    marginTop: 24,
  },
  backButtonText: {
    color: GP.textOnYellow,
    fontSize: 16,
    fontWeight: '700',
  },
  statusContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  statusBadge: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  statusText: {
    color: GP.textOnYellow,
    fontSize: 14,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  amountCard: {
    backgroundColor: GP.card,
    borderRadius: 22,
    padding: 28,
    marginHorizontal: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: GP.border,
  },
  amountLabel: {
    fontSize: 13,
    color: GP.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  tokenEmoji: {
    fontSize: 32,
  },
  amountValue: {
    fontSize: 42,
    fontWeight: '800',
    color: GP.textPrimary,
  },
  tokenSymbol: {
    fontSize: 20,
    fontWeight: '700',
    color: GP.primary,
  },
  amountUsd: {
    fontSize: 16,
    color: GP.textSecondary,
    marginTop: 8,
  },
  detailsCard: {
    backgroundColor: GP.card,
    borderRadius: 18,
    padding: 20,
    marginHorizontal: 20,
    marginTop: 16,
    borderWidth: 1,
    borderColor: GP.border,
  },
  detailsTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: GP.textPrimary,
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 8,
  },
  detailLabel: {
    fontSize: 14,
    color: GP.textMuted,
    fontWeight: '600',
  },
  detailValueContainer: {
    alignItems: 'flex-end',
    flex: 1,
    marginLeft: 16,
  },
  detailName: {
    fontSize: 14,
    fontWeight: '700',
    color: GP.textPrimary,
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 14,
    color: GP.textPrimary,
    fontWeight: '600',
    textAlign: 'right',
  },
  expiredText: {
    color: GP.error,
  },
  detailDivider: {
    height: 1,
    backgroundColor: GP.border,
    marginVertical: 4,
  },
  noteSection: {
    paddingVertical: 8,
  },
  noteText: {
    fontSize: 14,
    color: GP.textPrimary,
    marginTop: 8,
    lineHeight: 20,
    fontStyle: 'italic',
  },
  actionsContainer: {
    flexDirection: 'row',
    gap: 12,
    marginHorizontal: 20,
    marginTop: 24,
  },
  actionButton: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
  },
  actionButtonDisabled: {
    opacity: 0.6,
  },
  declineButton: {
    backgroundColor: GP.surface,
    borderWidth: 1.5,
    borderColor: GP.border,
  },
  declineButtonText: {
    color: GP.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  payButton: {
    backgroundColor: GP.primary,
    flex: 1.5,
  },
  payButtonText: {
    color: GP.textOnYellow,
    fontSize: 16,
    fontWeight: '800',
  },
  statusMessageContainer: {
    marginHorizontal: 20,
    marginTop: 24,
  },
  statusMessage: {
    backgroundColor: GP.surface,
    borderRadius: 14,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statusMessageEmoji: {
    fontSize: 24,
  },
  statusMessageText: {
    fontSize: 15,
    color: GP.textSecondary,
    flex: 1,
  },
  backLinkButton: {
    marginTop: 24,
    paddingVertical: 12,
    alignItems: 'center',
  },
  backLinkText: {
    color: GP.textMuted,
    fontSize: 15,
    fontWeight: '600',
  },
});
