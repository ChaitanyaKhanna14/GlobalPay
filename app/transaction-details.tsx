/**
 * Transaction Details Screen - Full transaction info with Polygonscan link
 */
import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  Linking,
  Share,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { supabase } from '@/supabase';
import { GP } from '@/constants/colors';
import { POLYGONSCAN_URL } from '@/constants/tokens';
import type { Transaction } from '@/types';

interface TransactionDetails extends Transaction {
  blockNumber?: number;
  gasUsed?: string;
  gasPrice?: string;
}

export default function TransactionDetailsScreen() {
  const params = useLocalSearchParams<{ id?: string; txHash?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [tx, setTx] = useState<TransactionDetails | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTransaction();
  }, [params.id, params.txHash]);

  const loadTransaction = async () => {
    setLoading(true);
    try {
      let query = supabase.from('transactions').select('*');

      if (params.id) {
        query = query.eq('id', params.id);
      } else if (params.txHash) {
        query = query.eq('tx_hash', params.txHash);
      } else {
        throw new Error('No transaction ID or hash provided');
      }

      const { data, error } = await query.single();

      if (error || !data) {
        Alert.alert('Error', 'Transaction not found');
        router.back();
        return;
      }

      setTx({
        id: data.id,
        type: data.from_address === data.from_address ? 'send' : 'receive',
        status: data.status ?? 'confirmed',
        fromAddress: data.from_address,
        toAddress: data.to_address,
        fromGlobalPayId: data.from_global_pay_id,
        toGlobalPayId: data.to_global_pay_id,
        amount: data.amount,
        token: data.token,
        amountUsd: data.amount_usd ?? '0',
        fee: data.fee ?? '0',
        feeUsd: data.fee_usd ?? '0',
        txHash: data.tx_hash,
        note: data.note,
        createdAt: data.created_at,
        confirmedAt: data.confirmed_at,
        blockNumber: data.block_number,
        gasUsed: data.gas_used,
        gasPrice: data.gas_price,
      });
    } catch (e: any) {
      __DEV__ && console.error('[TransactionDetails] Load error:', e);
      Alert.alert('Error', e.message ?? 'Failed to load transaction');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    await Clipboard.setStringAsync(text);
    Alert.alert('Copied!', `${label} copied to clipboard`);
  };

  const openPolygonscan = () => {
    if (!tx?.txHash) return;
    const url = `${POLYGONSCAN_URL}/tx/${tx.txHash}`;
    Linking.openURL(url).catch(() => {
      Alert.alert('Error', 'Could not open Polygonscan');
    });
  };

  const shareReceipt = async () => {
    if (!tx) return;

    const receipt = `
GlobalPay Transaction Receipt

Status: ${tx.status.toUpperCase()}
Date: ${new Date(tx.createdAt).toLocaleString()}

From: ${tx.fromGlobalPayId || tx.fromAddress}
To: ${tx.toGlobalPayId || tx.toAddress}

Amount: ${tx.amount} ${tx.token}
${tx.amountUsd !== '0' ? `Value: $${tx.amountUsd} USD` : ''}
${tx.fee !== '0' ? `Gas Fee: ${tx.fee} MATIC (~$${tx.feeUsd})` : ''}

Transaction Hash:
${tx.txHash}

View on Polygonscan:
${POLYGONSCAN_URL}/tx/${tx.txHash}

Powered by GlobalPay
    `.trim();

    try {
      await Share.share({
        message: receipt,
        title: 'Transaction Receipt',
      });
    } catch (e: any) {
      __DEV__ && console.error('[TransactionDetails] Share error:', e);
    }
  };

  const formatAddress = (address: string) => {
    if (!address) return '';
    return `${address.slice(0, 10)}...${address.slice(-8)}`;
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  if (!tx) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.loadingText}>Transaction not found</Text>
      </View>
    );
  }

  const isSend = tx.type === 'send';
  const statusColor = tx.status === 'confirmed' ? GP.success : tx.status === 'failed' ? GP.error : GP.warning;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={GP.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Transaction Details</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Amount Card */}
        <View style={[styles.amountCard, { backgroundColor: isSend ? GP.cardCoral : GP.cardGreen }]}>
          <Text style={styles.amountLabel}>{isSend ? 'Sent' : 'Received'}</Text>
          <Text style={styles.amountValue}>
            {isSend ? '-' : '+'}{tx.amount} {tx.token}
          </Text>
          {tx.amountUsd !== '0' && (
            <Text style={styles.amountUsd}>~${tx.amountUsd} USD</Text>
          )}
        </View>

        {/* Status */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Status</Text>
          <View style={styles.infoRow}>
            <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
              <Text style={styles.statusText}>{tx.status.toUpperCase()}</Text>
            </View>
            <Text style={styles.infoValue}>{formatDate(tx.createdAt)}</Text>
          </View>
        </View>

        {/* From / To */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>From</Text>
          <TouchableOpacity
            style={styles.addressRow}
            onPress={() => copyToClipboard(tx.fromAddress, 'From address')}>
            <View style={styles.addressContent}>
              {tx.fromGlobalPayId && (
                <Text style={styles.gpId}>{tx.fromGlobalPayId}</Text>
              )}
              <Text style={styles.addressText}>{formatAddress(tx.fromAddress)}</Text>
            </View>
            <Ionicons name="copy-outline" size={18} color={GP.textMuted} />
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>To</Text>
          <TouchableOpacity
            style={styles.addressRow}
            onPress={() => copyToClipboard(tx.toAddress, 'To address')}>
            <View style={styles.addressContent}>
              {tx.toGlobalPayId && (
                <Text style={styles.gpId}>{tx.toGlobalPayId}</Text>
              )}
              <Text style={styles.addressText}>{formatAddress(tx.toAddress)}</Text>
            </View>
            <Ionicons name="copy-outline" size={18} color={GP.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Note */}
        {tx.note && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Note</Text>
            <View style={styles.noteCard}>
              <Text style={styles.noteText}>{tx.note}</Text>
            </View>
          </View>
        )}

        {/* Gas / Fee */}
        {tx.fee !== '0' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Network Fee</Text>
            <View style={styles.infoCard}>
              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>Gas Fee</Text>
                <Text style={styles.infoValue}>{tx.fee} MATIC</Text>
              </View>
              {tx.feeUsd !== '0' && (
                <View style={styles.infoItem}>
                  <Text style={styles.infoLabel}>Fee (USD)</Text>
                  <Text style={styles.infoValue}>~${tx.feeUsd}</Text>
                </View>
              )}
              {tx.gasUsed && (
                <View style={styles.infoItem}>
                  <Text style={styles.infoLabel}>Gas Used</Text>
                  <Text style={styles.infoValue}>{tx.gasUsed}</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Transaction Hash */}
        {tx.txHash && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Transaction Hash</Text>
            <TouchableOpacity
              style={styles.hashRow}
              onPress={() => copyToClipboard(tx.txHash!, 'Transaction hash')}>
              <Text style={styles.hashText} numberOfLines={1}>
                {tx.txHash}
              </Text>
              <Ionicons name="copy-outline" size={18} color={GP.textMuted} />
            </TouchableOpacity>
          </View>
        )}

        {/* Block Number */}
        {tx.blockNumber && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Block</Text>
            <Text style={styles.blockText}>#{tx.blockNumber.toLocaleString()}</Text>
          </View>
        )}

        {/* Actions */}
        <View style={styles.actionsRow}>
          {tx.txHash && (
            <TouchableOpacity style={styles.actionBtn} onPress={openPolygonscan}>
              <Ionicons name="open-outline" size={20} color={GP.primary} />
              <Text style={styles.actionText}>View on Polygonscan</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.actionBtn} onPress={shareReceipt}>
            <Ionicons name="share-outline" size={20} color={GP.primary} />
            <Text style={styles.actionText}>Share Receipt</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GP.background,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: GP.textSecondary,
    fontSize: 16,
  },
  content: {
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: GP.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: GP.textPrimary,
  },
  amountCard: {
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 24,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
  },
  amountLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(0,0,0,0.6)',
    marginBottom: 4,
  },
  amountValue: {
    fontSize: 32,
    fontWeight: '800',
    color: '#1A1A1A',
  },
  amountUsd: {
    fontSize: 15,
    fontWeight: '600',
    color: 'rgba(0,0,0,0.5)',
    marginTop: 4,
  },
  section: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: GP.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '800',
    color: GP.white,
  },
  infoValue: {
    fontSize: 14,
    color: GP.textSecondary,
    fontWeight: '600',
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: GP.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: GP.border,
  },
  addressContent: {
    flex: 1,
  },
  gpId: {
    fontSize: 15,
    fontWeight: '700',
    color: GP.primary,
    marginBottom: 2,
  },
  addressText: {
    fontSize: 13,
    color: GP.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  noteCard: {
    backgroundColor: GP.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: GP.border,
  },
  noteText: {
    fontSize: 14,
    color: GP.textPrimary,
    lineHeight: 20,
  },
  infoCard: {
    backgroundColor: GP.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: GP.border,
    gap: 10,
  },
  infoItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoLabel: {
    fontSize: 13,
    color: GP.textSecondary,
  },
  hashRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: GP.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: GP.border,
    gap: 10,
  },
  hashText: {
    flex: 1,
    fontSize: 12,
    color: GP.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  blockText: {
    fontSize: 15,
    fontWeight: '700',
    color: GP.textPrimary,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 12,
    paddingHorizontal: 20,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: GP.surface,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 8,
    borderWidth: 1,
    borderColor: GP.border,
  },
  actionText: {
    fontSize: 14,
    fontWeight: '700',
    color: GP.primary,
  },
});
