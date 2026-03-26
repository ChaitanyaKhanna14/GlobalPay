/**
 * GlobalPay Design System - Colors
 * Dark theme with warm accent cards (inspired by modern task-manager UI)
 */

export const GP = {
  // Primary brand — warm yellow
  primary: '#F2C94C',
  primaryLight: '#F7DC6F',
  primaryDark: '#D4A017',

  // Accent cards
  accent: '#F2C94C',          // yellow (main accent)
  cardYellow: '#D4E157',      // lime-yellow cards
  cardGreen: '#C6D84A',       // lime-green cards
  cardCoral: '#EF6C57',       // coral/red cards
  cardMint: '#A8E6CF',        // mint accent
  cardOrange: '#F5A623',      // orange accent

  // Status
  success: '#4CAF50',
  successLight: '#1B3D1F',
  warning: '#F2C94C',
  warningLight: '#3D3520',
  error: '#EF6C57',
  errorLight: '#3D1F1F',

  // Core surfaces — dark theme
  white: '#FFFFFF',
  background: '#1A1A2E',       // deep dark navy
  surface: '#222240',          // slightly lighter surface
  card: '#2A2A45',             // card background
  cardElevated: '#32324F',     // elevated card
  border: '#3A3A55',           // subtle border
  borderLight: '#44446A',

  // Text on dark
  textPrimary: '#F5F5F5',
  textSecondary: '#B0B0C0',
  textMuted: '#7A7A90',
  textInverse: '#1A1A2E',
  textOnYellow: '#1A1A1A',
  textOnCoral: '#FFFFFF',

  // Bottom bar
  navBar: '#1E1E38',
  navBarActive: '#F2C94C',
  navBarInactive: '#6B6B80',

  // Input fields
  inputBg: '#2A2A45',
  inputBorder: '#3A3A55',
  inputText: '#F5F5F5',
  inputPlaceholder: '#6B6B80',

  // Legacy aliases for compatibility
  darkBackground: '#1A1A2E',
  darkCard: '#2A2A45',
  darkBorder: '#3A3A55',
  darkTextPrimary: '#F5F5F5',
  darkTextSecondary: '#B0B0C0',
};

export const Colors = {
  light: {
    text: GP.textPrimary,
    textSecondary: GP.textSecondary,
    background: GP.background,
    card: GP.card,
    tint: GP.primary,
    border: GP.border,
    icon: GP.textSecondary,
    tabIconDefault: GP.textMuted,
    tabIconSelected: GP.primary,
  },
  dark: {
    text: GP.textPrimary,
    textSecondary: GP.textSecondary,
    background: GP.background,
    card: GP.card,
    tint: GP.primary,
    border: GP.border,
    icon: GP.textSecondary,
    tabIconDefault: GP.textMuted,
    tabIconSelected: GP.primary,
  },
};
