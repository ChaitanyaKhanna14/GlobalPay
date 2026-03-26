/**
 * UPI Service — Paytm-style bank integration (mock layer)
 *
 * Architecture: every method here matches the signature a real Razorpay /
 * Cashfree / Juspay SDK would expose.  In production, swap each method body
 * with real SDK calls — the UI layer stays UNTOUCHED.
 */
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

// ─── Indian Bank Database ─────────────────────
export interface IndianBank {
  code: string;
  name: string;
  icon: string;
  color: string;
}

export const INDIAN_BANKS: IndianBank[] = [
  { code: 'SBIN', name: 'State Bank of India',  icon: '🏛️', color: '#1C3A6E' },
  { code: 'HDFC', name: 'HDFC Bank',            icon: '🔵', color: '#004B87' },
  { code: 'ICIC', name: 'ICICI Bank',           icon: '🟠', color: '#F58220' },
  { code: 'PUNB', name: 'Punjab National Bank', icon: '🏦', color: '#6B2D5B' },
  { code: 'BARB', name: 'Bank of Baroda',       icon: '🟡', color: '#F36F21' },
  { code: 'KKBK', name: 'Kotak Mahindra Bank',  icon: '🔴', color: '#ED1C24' },
  { code: 'UTIB', name: 'Axis Bank',            icon: '🟣', color: '#97144D' },
  { code: 'CNRB', name: 'Canara Bank',          icon: '🔷', color: '#0066B3' },
  { code: 'UBIN', name: 'Union Bank of India',  icon: '🟢', color: '#E87722' },
  { code: 'IDFB', name: 'IDFC First Bank',      icon: '🔶', color: '#9C1D26' },
  { code: 'YESB', name: 'Yes Bank',             icon: '🔹', color: '#0067A5' },
  { code: 'INDB', name: 'IndusInd Bank',        icon: '⚪', color: '#3F1D5A' },
];

export function bankByCode(code: string): IndianBank | undefined {
  return INDIAN_BANKS.find((b) => b.code === code);
}

// ─── Discovered Account shape ─────────────────
export interface DiscoveredAccount {
  bankCode: string;
  bankName: string;
  accountNumber: string; // masked  XXXX XXXX 1234
  accountType: 'savings' | 'current';
  ifsc: string;
  icon: string;
  color: string;
}

// ─── PIN storage key prefix (device-only) ─────
const PIN_PFX = 'gp_upi_pin_';

// ─── UPI Service ──────────────────────────────
class UPIService {
  /** Step 1 — Verify mobile number (silent SMS in production) */
  async verifyPhone(phone: string): Promise<{ ok: boolean; msg: string }> {
    await wait(1500);
    const d = phone.replace(/\D/g, '');
    if (d.length !== 10 || !'6789'.includes(d[0]))
      return { ok: false, msg: 'Enter a valid 10-digit Indian mobile number' };
    return { ok: true, msg: 'Phone verified via SMS' };
  }

  /** Step 2 — Return all supported banks for user to choose their bank */
  async discoverBanks(_phone: string): Promise<DiscoveredAccount[]> {
    await wait(1200);
    return allBanksAsOptions();
  }

  /** Step 3 — Debit-card verification → bank sends OTP */
  async verifyCard(
    bankCode: string, last6: string, expMM: string, expYY: string,
  ): Promise<{ ok: boolean; msg: string }> {
    await wait(1800);
    if (last6.length !== 6) return { ok: false, msg: 'Enter last 6 digits of your debit card' };
    if (!expMM || !expYY) return { ok: false, msg: 'Enter card expiry date' };
    return { ok: true, msg: 'OTP sent to your registered mobile number' };
  }

  /** Step 4 — OTP confirmation + set UPI PIN */
  async setupPin(
    bankId: string, otp: string, pin: string,
  ): Promise<{ ok: boolean; msg: string }> {
    await wait(2000);
    if (otp.length < 4) return { ok: false, msg: 'Invalid OTP' };
    if (pin.length < 4 || pin.length > 6) return { ok: false, msg: 'PIN must be 4–6 digits' };
    // Hash PIN before storing for security
    const hashedPin = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      pin,
    );
    await SecureStore.setItemAsync(`${PIN_PFX}${bankId}`, hashedPin);
    return { ok: true, msg: 'UPI PIN set successfully' };
  }

  /** Step 5 — Create VPA (Virtual Payment Address) */
  async createVPA(username: string): Promise<string> {
    await wait(800);
    return `${username.toLowerCase().replace(/[^a-z0-9]/g, '')}@globalpay`;
  }

  /** Balance enquiry (requires PIN) */
  async checkBalance(
    bankId: string, pin: string,
  ): Promise<{ ok: boolean; balance?: string; msg: string }> {
    if (!(await this.verifyPin(bankId, pin)))
      return { ok: false, msg: 'Incorrect UPI PIN' };
    await wait(1500);
    const bal = (Math.random() * 85000 + 500).toFixed(2);
    return { ok: true, balance: bal, msg: `Available: ₹${Number(bal).toLocaleString('en-IN')}` };
  }

  /** Send money (P2P push payment) */
  async send(params: {
    bankId: string; receiverVpa: string; amount: string; pin: string; note?: string;
  }): Promise<{ ok: boolean; rrn?: string; msg: string }> {
    if (!(await this.verifyPin(params.bankId, params.pin)))
      return { ok: false, msg: 'Incorrect UPI PIN' };
    const amt = parseFloat(params.amount);
    if (isNaN(amt) || amt <= 0 || amt > 100000)
      return { ok: false, msg: 'Amount must be ₹1 – ₹1,00,000' };
    await wait(2500);
    return { ok: true, rrn: makeRRN(), msg: `₹${amt.toFixed(2)} sent to ${params.receiverVpa}` };
  }

  /** Collect / request money (collect request) */
  async collect(params: {
    requesterVpa: string; payerVpa: string; amount: string; note?: string;
  }): Promise<{ ok: boolean; rrn?: string; msg: string }> {
    const amt = parseFloat(params.amount);
    if (isNaN(amt) || amt <= 0)
      return { ok: false, msg: 'Enter a valid amount' };
    await wait(1500);
    return { ok: true, rrn: makeRRN(), msg: `Collect request of ₹${amt.toFixed(2)} sent` };
  }

  /** Validate VPA format */
  isValidVPA(vpa: string): boolean {
    return /^[a-zA-Z0-9._-]+@[a-zA-Z0-9]+$/.test(vpa);
  }

  // ── internal ────────────────────────────────
  private async verifyPin(bankId: string, pin: string): Promise<boolean> {
    const stored = await SecureStore.getItemAsync(`${PIN_PFX}${bankId}`);
    if (!stored) return false;
    // Compare SHA-256 hashes
    const hashedPin = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      pin,
    );
    return stored === hashedPin;
  }
}

// ─── Helpers ──────────────────────────────────
function wait(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

function makeRRN() {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 12);
}

/** Returns all supported banks for user to pick (like Paytm's bank-select screen) */
function allBanksAsOptions(): DiscoveredAccount[] {
  return INDIAN_BANKS.map((b) => ({
    bankCode: b.code,
    bankName: b.name,
    accountNumber: '',   // filled after linking
    accountType: 'savings' as const,
    ifsc: '',            // filled after linking
    icon: b.icon,
    color: b.color,
  }));
}

export const upiService = new UPIService();
