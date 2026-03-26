/**
 * ErrorBoundary - Catches React render errors and shows a recovery UI
 * Prevents the app from crashing to a white screen
 */
import React, { Component, ErrorInfo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { GP } from '@/constants/colors';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });

    // Log to Sentry if available
    try {
      const Sentry = require('@sentry/react-native');
      Sentry.captureException(error, { extra: { componentStack: errorInfo.componentStack } });
    } catch {
      // Sentry not configured yet — just log
      console.error('[ErrorBoundary] Uncaught error:', error, errorInfo);
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <View style={styles.container}>
          <Text style={styles.emoji}>⚠️</Text>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>
            The app ran into an unexpected error. This has been reported automatically.
          </Text>

          {__DEV__ && this.state.error && (
            <ScrollView style={styles.debugBox}>
              <Text style={styles.debugTitle}>{this.state.error.toString()}</Text>
              <Text style={styles.debugStack}>
                {this.state.errorInfo?.componentStack?.slice(0, 500)}
              </Text>
            </ScrollView>
          )}

          <TouchableOpacity style={styles.button} onPress={this.handleReset}>
            <Text style={styles.buttonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: GP.background,
  },
  emoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: GP.textPrimary,
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  message: {
    fontSize: 15,
    color: GP.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  debugBox: {
    maxHeight: 200,
    backgroundColor: GP.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 24,
    width: '100%',
    borderWidth: 1,
    borderColor: GP.border,
  },
  debugTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: GP.error,
    marginBottom: 4,
  },
  debugStack: {
    fontSize: 11,
    color: GP.textMuted,
    fontFamily: 'monospace',
  },
  button: {
    backgroundColor: GP.primary,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 48,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '800',
    color: GP.textOnYellow,
  },
});
