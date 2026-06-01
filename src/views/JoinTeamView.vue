<script setup lang="ts">
import jsQR from 'jsqr';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { redeemInvite } from '../lib/data';
import { auth, isFirebaseConfigured } from '../lib/firebase';
import { useSessionStore } from '../stores/session';
import { useTeamStore } from '../stores/team';

const router = useRouter();
const route = useRoute();
const sessionStore = useSessionStore();
const teamStore = useTeamStore();

const inviteCode = ref('');
const displayName = ref('');
const scannerMessage = ref('Opening camera scanner...');
const errorMessage = ref('');
const isJoining = ref(false);
const videoElement = ref<HTMLVideoElement | null>(null);
const mediaStream = ref<MediaStream | null>(null);
const scanFrameId = ref<number | null>(null);
const hasDecodedInvite = ref(false);

const canUseCamera = computed(() => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia);

const scanCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
const scanContext = scanCanvas?.getContext('2d', { willReadFrequently: true }) ?? null;

const parseInviteFromInput = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';

  if (trimmed.includes('invite=')) {
    try {
      const parsed = new URL(trimmed);
      return (parsed.searchParams.get('invite') ?? '').trim();
    } catch {
      const queryPart = trimmed.split('invite=')[1] ?? '';
      return decodeURIComponent(queryPart.split('&')[0] ?? '').trim();
    }
  }

  return trimmed;
};

const startScanner = async () => {
  errorMessage.value = '';

  if (!canUseCamera.value) {
    scannerMessage.value = 'Camera unavailable on this device/browser. Use invite code fallback.';
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'environment' },
    });

    mediaStream.value = stream;
    if (videoElement.value) {
      videoElement.value.srcObject = stream;
      await videoElement.value.play();
    }
    scannerMessage.value = 'Camera active. Point at an invite QR code.';
    hasDecodedInvite.value = false;
    scanLoop();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to open camera scanner.';
    scannerMessage.value = 'Camera permission denied. Use invite code fallback.';
    errorMessage.value = message;
  }
};

const scanLoop = () => {
  if (!videoElement.value || !scanCanvas || !scanContext || hasDecodedInvite.value) {
    return;
  }

  const video = videoElement.value;
  const width = video.videoWidth;
  const height = video.videoHeight;

  if (width > 0 && height > 0) {
    scanCanvas.width = width;
    scanCanvas.height = height;
    scanContext.drawImage(video, 0, 0, width, height);

    const imageData = scanContext.getImageData(0, 0, width, height);
    const code = jsQR(imageData.data, width, height);

    if (code?.data) {
      const parsed = parseInviteFromInput(code.data);
      if (parsed) {
        inviteCode.value = parsed;
        scannerMessage.value = 'Invite detected from QR. Tap Join Team to continue.';
        hasDecodedInvite.value = true;
        return;
      }
    }
  }

  scanFrameId.value = requestAnimationFrame(scanLoop);
};

const stopScanner = () => {
  if (scanFrameId.value !== null) {
    cancelAnimationFrame(scanFrameId.value);
    scanFrameId.value = null;
  }

  if (!mediaStream.value) return;

  mediaStream.value.getTracks().forEach((track) => track.stop());
  mediaStream.value = null;
};

const handleJoin = async () => {
  errorMessage.value = '';

  const token = parseInviteFromInput(inviteCode.value);
  if (!token) {
    errorMessage.value = 'Enter a valid invite code or invite URL.';
    return;
  }

  if (!displayName.value.trim()) {
    errorMessage.value = 'Enter your name so the team knows who you are.';
    return;
  }

  if (!isFirebaseConfigured || !auth) {
    errorMessage.value = 'Firebase is not configured yet. Add your env keys and restart the app.';
    return;
  }

  isJoining.value = true;

  try {
    const user = await sessionStore.ensureAnonymousSession();
    const joined = await redeemInvite(user, token, displayName.value);

    teamStore.setActiveTeam(joined.teamId);
    router.push('/team');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to join team.';
    errorMessage.value = message;
  } finally {
    isJoining.value = false;
  }
};

onMounted(() => {
  const queryInvite = String(route.query.invite ?? '').trim();
  if (queryInvite) {
    inviteCode.value = queryInvite;
  }

  startScanner().catch(() => {
    scannerMessage.value = 'Scanner not available. Use invite code fallback.';
  });
});

onUnmounted(() => {
  stopScanner();
});
</script>

<template>
  <main class="screen warm-bg">
    <section class="card">
      <p class="eyebrow">Join Team</p>
      <h1>Scan QR to join instantly</h1>
      <p class="lead">
        Camera scanner is the default path for joining. Manual code is included as a fallback.
      </p>

      <div class="scanner-placeholder">
        <p class="scanner-title">QR Scanner</p>
        <video ref="videoElement"
               class="scanner-video"
               muted
               playsinline></video>
        <p>{{ scannerMessage }}</p>
      </div>

      <label class="field-label"
             for="displayName">Your name</label>
      <input id="displayName"
             v-model="displayName"
             class="field"
             type="text"
             placeholder="e.g. Alex"
             autocomplete="name" />

      <label class="field-label"
             for="inviteCode">Fallback invite code</label>
      <input id="inviteCode"
             v-model="inviteCode"
             class="field"
             type="text"
             placeholder="e.g. TEAM-8XZ2"
             autocomplete="off" />

      <p v-if="errorMessage"
         class="error-text">{{ errorMessage }}</p>

      <div class="button-row">
        <button class="btn btn-primary"
                type="button"
                :disabled="isJoining"
                @click="handleJoin">
          {{ isJoining ? 'Joining...' : 'Join Team' }}
        </button>
        <button class="btn btn-ghost"
                type="button"
                @click="router.push('/')">Back</button>
      </div>
    </section>
  </main>
</template>
