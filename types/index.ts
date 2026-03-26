/**
 * GlobalPay Core Types
 */

// Re-export auth types
export * from './auth';

// ─── User & Auth ──────────────────────────────
export interface User {
  id: string;
  email: string;
  globalPayId: string; // e.g. "rahul@globalpay"
  displayName: string;
  avatarUrl?: string;
  walletAddress: string;
  createdAt: string;
}

// ─── Wallet ───────────────────────────────────
export interface Wallet {
  address: string;
  encryptedPrivateKey?: string; // stored in SecureStore, never leaves device
}

export type SupportedToken = 'USDC' | 'USDT' | 'ETH' | 'MATIC' | 'WBTC';

export interface TokenBalance {
  token: SupportedToken;
  symbol: string;
  name: string;
  balance: string; // raw amount
  balanceFormatted: string; // human-readable
  balanceUsd: string;
  decimals: number;
  iconUrl: string;
}

// ─── Transactions ─────────────────────────────
export type TransactionStatus = 'pending' | 'confirmed' | 'failed';
export type TransactionType = 'send' | 'receive' | 'request' | 'conversion';

export interface Transaction {
  id: string;
  type: TransactionType;
  status: TransactionStatus;
  fromAddress: string;
  toAddress: string;
  fromGlobalPayId?: string;
  toGlobalPayId?: string;
  amount: string;
  token: SupportedToken;
  amountUsd: string;
  fee: string;
  feeUsd: string;
  txHash?: string; // blockchain tx hash
  note?: string;
  createdAt: string;
  confirmedAt?: string;
}

// ─── Payment Request ──────────────────────────
export interface PaymentRequest {
  id: string;
  fromGlobalPayId: string;
  toGlobalPayId: string;
  amount: string;
  token: SupportedToken;
  note?: string;
  status: 'pending' | 'paid' | 'declined' | 'expired';
  expiresAt: string;
  createdAt: string;
}

// ─── QR Code ──────────────────────────────────
export interface QRPayload {
  globalPayId: string;
  walletAddress: string;
  amount?: string;
  token?: SupportedToken;
  note?: string;
}

// ─── Price Feed ───────────────────────────────
export interface TokenPrice {
  token: SupportedToken;
  priceUsd: number;
  change24h: number;
}

// ─── Linked Accounts ──────────────────────────
export interface LinkedWallet {
  id: string;
  userId: string;
  label: string;
  network: string;         // "bitcoin" | "ethereum" | "solana" etc.
  address: string;
  isVerified: boolean;
  createdAt: string;
}

export interface BankAccount {
  id: string;
  userId: string;
  bankName: string;
  accountHolder: string;
  accountNumber: string;   // masked in UI
  routingNumber?: string;
  accountType: 'checking' | 'savings';
  currency: string;
  isVerified: boolean;
  createdAt: string;
}

// ─── Fiat On/Off Ramp ────────────────────────
export interface FiatTransaction {
  id: string;
  userId: string;
  bankAccountId: string;
  type: 'deposit' | 'withdraw';
  amount: string;
  currency: string;
  token: SupportedToken;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  reference?: string;
  createdAt: string;
  completedAt?: string;
}

// ─── UPI ──────────────────────────────────────
export interface UPILinkedBank {
  id: string;
  userId: string;
  bankName: string;
  bankCode: string;
  accountNumber: string;
  accountType: 'savings' | 'current';
  ifsc: string;
  vpa: string;
  phoneNumber: string;
  isDefault: boolean;
  createdAt: string;
}

export interface UPITransaction {
  id: string;
  userId: string;
  type: 'send' | 'receive' | 'collect';
  amount: string;
  senderVpa: string;
  receiverVpa: string;
  bankAccountId?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  note?: string;
  rrn?: string;
  createdAt: string;
  completedAt?: string;
}
