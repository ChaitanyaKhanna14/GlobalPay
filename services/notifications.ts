/**
 * NotificationService - Push notifications for payment events
 * Registers device token with Supabase and handles incoming notifications
 *
 * IMPORTANT: expo-notifications is imported LAZILY (dynamic import) to prevent
 * the DevicePushTokenAutoRegistration side-effect from crashing in Expo Go.
 * All methods in this service are safe to call regardless of environment.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from '@/supabase';

/**
 * Detect if running inside Expo Go (as opposed to a dev build).
 * In Expo Go, remote push notifications are unavailable since SDK 53.
 */
const isExpoGo = Constants.appOwnership === 'expo';

/** Lazily cached reference to expo-notifications */
let _Notifications: typeof import('expo-notifications') | null = null;

async function getNotificationsModule() {
  if (_Notifications) return _Notifications;
  _Notifications = await import('expo-notifications');
  return _Notifications;
}

/** One-time setup flag */
let _handlerConfigured = false;

async function ensureHandlerConfigured() {
  if (_handlerConfigured) return;
  try {
    const Notifications = await getNotificationsModule();
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    _handlerConfigured = true;
  } catch (e) {
    __DEV__ && console.warn('[Notifications] Failed to set notification handler:', e);
  }
}

class NotificationService {
  private pushToken: string | null = null;

  /**
   * Register for push notifications and store the token
   */
  async register(userId: string): Promise<string | null> {
    if (isExpoGo) {
      __DEV__ && console.log('[Notifications] Running in Expo Go — remote push disabled. Use a dev build for full support.');
      return null;
    }

    let Device: typeof import('expo-device');
    try {
      Device = await import('expo-device');
    } catch {
      __DEV__ && console.warn('[Notifications] expo-device not available');
      return null;
    }

    if (!Device.isDevice) {
      __DEV__ && console.warn('[Notifications] Push notifications only work on physical devices');
      return null;
    }

    const Notifications = await getNotificationsModule();
    await ensureHandlerConfigured();

    // Check existing permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    // Request if not already granted
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      __DEV__ && console.warn('[Notifications] Permission not granted');
      return null;
    }

    // Get the Expo push token
    try {
      const projectId = Constants.expoConfig?.extra?.eas?.projectId;

      // Validate projectId is a real UUID (not a placeholder)
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!projectId || !uuidRegex.test(projectId)) {
        __DEV__ && console.warn('[Notifications] EAS projectId not configured — push registration skipped. Run `eas init` to set up.');
        return null;
      }

      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId,
      });
      this.pushToken = tokenData.data;

      // Store token in Supabase for backend to use
      await this.saveTokenToServer(userId, this.pushToken);

      // Android: set notification channel
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('payments', {
          name: 'Payments',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#F2C94C',
          sound: 'default',
        });

        await Notifications.setNotificationChannelAsync('requests', {
          name: 'Payment Requests',
          importance: Notifications.AndroidImportance.HIGH,
          sound: 'default',
        });
      }

      __DEV__ && console.log('[Notifications] Registered with token:', this.pushToken);
      return this.pushToken;
    } catch (e) {
      __DEV__ && console.error('[Notifications] Registration failed:', e);
      return null;
    }
  }

  /**
   * Save push token to Supabase so the backend can send notifications
   */
  private async saveTokenToServer(userId: string, token: string) {
    try {
      await supabase.from('push_tokens').upsert(
        {
          user_id: userId,
          token,
          platform: Platform.OS,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,token' },
      );
    } catch (e) {
      __DEV__ && console.warn('[Notifications] Failed to save token:', e);
    }
  }

  /**
   * Remove push token on sign out
   */
  async unregister(userId: string) {
    if (this.pushToken) {
      try {
        await supabase
          .from('push_tokens')
          .delete()
          .eq('user_id', userId)
          .eq('token', this.pushToken);
      } catch (e) {
        __DEV__ && console.warn('[Notifications] Failed to remove token:', e);
      }
      this.pushToken = null;
    }
  }

  /**
   * Schedule a local notification (e.g. transaction confirmed)
   */
  async sendLocalNotification(title: string, body: string, data?: Record<string, unknown>) {
    if (isExpoGo) return; // local notification scheduling can be flaky in Expo Go
    try {
      const Notifications = await getNotificationsModule();
      await ensureHandlerConfigured();
      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data: data ?? {},
          sound: 'default',
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 1 },
      });
    } catch (e) {
      __DEV__ && console.warn('[Notifications] Failed to send local notification:', e);
    }
  }

  /**
   * Get the current push token
   */
  getToken(): string | null {
    return this.pushToken;
  }

  /**
   * Add a listener for received notifications (foreground).
   * Returns a no-op subscription if in Expo Go.
   */
  async onNotificationReceived(callback: (notification: any) => void) {
    if (isExpoGo) return { remove: () => {} };
    const Notifications = await getNotificationsModule();
    return Notifications.addNotificationReceivedListener(callback);
  }

  /**
   * Add a listener for notification interactions (user tapped).
   * Returns a no-op subscription if in Expo Go.
   */
  async onNotificationResponse(callback: (response: any) => void) {
    if (isExpoGo) return { remove: () => {} };
    const Notifications = await getNotificationsModule();
    return Notifications.addNotificationResponseReceivedListener(callback);
  }

  /**
   * Get and clear badge count
   */
  async clearBadge() {
    if (isExpoGo) return;
    try {
      const Notifications = await getNotificationsModule();
      await Notifications.setBadgeCountAsync(0);
    } catch (e) {
      __DEV__ && console.warn('[Notifications] Failed to clear badge:', e);
    }
  }
}

export const notificationService = new NotificationService();
