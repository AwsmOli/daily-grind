<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';

import { useSessionStore } from '../stores/session';

const router = useRouter();
const sessionStore = useSessionStore();

const email = ref('');
const password = ref('');
const isSubmitting = ref(false);
const errorMessage = ref('');
const infoMessage = ref('');

const handleLogin = async () => {
  errorMessage.value = '';
  infoMessage.value = '';

  if (!email.value.trim() || !password.value) {
    errorMessage.value = 'Enter your email and password.';
    return;
  }

  isSubmitting.value = true;

  try {
    await sessionStore.loginWithEmail(email.value, password.value);
    // Always go to /team — watchUserTeams in App.vue will auto-select the team
    // once Firestore responds. Checking teamStore.teams here races with that load.
    router.push('/team');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to sign in.';
    errorMessage.value = message;
  } finally {
    isSubmitting.value = false;
  }
};

const handleResetPassword = async () => {
  errorMessage.value = '';
  infoMessage.value = '';

  if (!email.value.trim()) {
    errorMessage.value = 'Enter your email first to receive a reset link.';
    return;
  }

  try {
    await sessionStore.requestPasswordReset(email.value);
    infoMessage.value = 'Password reset email sent. Check your inbox.';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to send password reset email.';
    errorMessage.value = message;
  }
};
</script>

<template>
  <main class="screen cool-bg">
    <section class="card">
      <p class="eyebrow">Account Recovery</p>
      <h1>Sign in to recover admin access</h1>
      <p class="lead">
        Use the same email/password used when creating your team. If you forgot your password,
        request a reset link and sign in again.
      </p>

      <form class="form"
            @submit.prevent="handleLogin">
        <label class="field-label"
               for="email">Email</label>
        <input id="email"
               v-model="email"
               class="field"
               type="email"
               autocomplete="email"
               required />

        <label class="field-label"
               for="password">Password</label>
        <input id="password"
               v-model="password"
               class="field"
               type="password"
               autocomplete="current-password"
               required />

        <p v-if="errorMessage"
           class="error-text">{{ errorMessage }}</p>
        <p v-if="infoMessage">{{ infoMessage }}</p>

        <div class="button-row">
          <button class="btn btn-primary"
                  type="submit"
                  :disabled="isSubmitting">
            {{ isSubmitting ? 'Signing in...' : 'Sign In' }}
          </button>
          <button class="btn btn-ghost"
                  type="button"
                  @click="handleResetPassword">
            Forgot Password
          </button>
          <button class="btn btn-ghost"
                  type="button"
                  @click="router.push('/')">Back</button>
        </div>
      </form>
    </section>
  </main>
</template>
