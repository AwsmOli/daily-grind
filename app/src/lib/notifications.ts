import { getToken } from 'firebase/messaging'

import { upsertPushToken } from './data'
import { getMessagingClient } from './firebase'

export interface PushRegistrationResult {
  supported: boolean
  permission: NotificationPermission
  token?: string
}

export const registerPushNotifications = async (userId: string): Promise<PushRegistrationResult> => {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return {
      supported: false,
      permission: 'denied',
    }
  }

  const messaging = await getMessagingClient()

  if (!messaging) {
    return {
      supported: false,
      permission: Notification.permission,
    }
  }

  const permission = await Notification.requestPermission()

  if (permission !== 'granted') {
    return {
      supported: true,
      permission,
    }
  }

  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY
  if (!vapidKey?.trim()) {
    throw new Error('Missing VITE_FIREBASE_VAPID_KEY in environment settings.')
  }

  const token = await getToken(messaging, { vapidKey })

  if (!token) {
    throw new Error('Unable to obtain FCM token for this browser.')
  }

  await upsertPushToken(userId, token, navigator.userAgent || 'web')

  return {
    supported: true,
    permission,
    token,
  }
}
