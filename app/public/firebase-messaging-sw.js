/* eslint-disable no-undef */
importScripts('https://www.gstatic.com/firebasejs/12.4.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/12.4.0/firebase-messaging-compat.js')

firebase.initializeApp({
  apiKey: 'REPLACE_WITH_VITE_FIREBASE_API_KEY',
  authDomain: 'REPLACE_WITH_VITE_FIREBASE_AUTH_DOMAIN',
  projectId: 'REPLACE_WITH_VITE_FIREBASE_PROJECT_ID',
  storageBucket: 'REPLACE_WITH_VITE_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'REPLACE_WITH_VITE_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'REPLACE_WITH_VITE_FIREBASE_APP_ID',
})

const messaging = firebase.messaging()

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || 'Daily Grind'
  const options = {
    body: payload.notification?.body || 'You have a new update.',
    icon: '/pwa-192x192.png',
    data: payload.data || {},
  }

  self.registration.showNotification(title, options)
})
