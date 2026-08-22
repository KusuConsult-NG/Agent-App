/**
 * Web Push Notification Client Manager.
 *
 * Enables agents to receive instant background notifications for:
 * - KYC & referee clearance status changes
 * - Commission settlements and wallet top-ups
 * - Critical operational announcements from PSIRS
 */

import { api } from './api';

export interface PushSubscriptionState {
  isSupported: boolean;
  permission: NotificationPermission;
  isSubscribed: boolean;
}

export class PushNotificationManager {
  public isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    );
  }

  public getPermission(): NotificationPermission {
    if (!this.isSupported()) return 'denied';
    return Notification.permission;
  }

  public async subscribe(): Promise<boolean> {
    if (!this.isSupported()) {
      throw new Error('Push notifications are not supported on this device/browser.');
    }

    // 1. Request user permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return false;
    }

    // 2. Obtain Service Worker registration
    const registration = await navigator.serviceWorker.ready;

    // 3. Fetch public VAPID key from backend
    const { publicKey } = await api.get<{ publicKey: string }>('/push/vapid-key');
    if (!publicKey) {
      throw new Error('VAPID public key not configured on server.');
    }

    // 4. Subscribe with PushManager
    const applicationServerKey = this.urlBase64ToUint8Array(publicKey);
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey as unknown as BufferSource,
    });

    // 5. Send subscription JSON payload to backend
    await api.post('/push/subscribe', {
      subscription: subscription.toJSON(),
    });

    return true;
  }

  public async unsubscribe(): Promise<void> {
    if (!this.isSupported()) return;
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await subscription.unsubscribe();
      await api.post('/push/unsubscribe', {
        endpoint: subscription.endpoint,
      }).catch(() => {});
    }
  }

  private urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }
}

export const pushManager = new PushNotificationManager();
