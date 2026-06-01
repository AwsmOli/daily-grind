<script setup lang="ts">
import { useRouter } from 'vue-router';

import { useSessionStore } from '../stores/session';

const router = useRouter();
const sessionStore = useSessionStore();
</script>

<template>
  <main class="screen gradient-bg">
    <section class="card">
      <p class="eyebrow">Daily Grind</p>
      <h1>Start with a team</h1>
      <p class="lead">
        Choose how you want to begin. You can join an existing team with a QR scan
        or create your own team as the lead.
      </p>

      <div class="button-grid">
        <button class="btn btn-primary"
                type="button"
                @click="router.push('/join')">
          Join a Team
        </button>
        <button class="btn btn-secondary"
                type="button"
                @click="router.push('/create')">
          Create a Team
        </button>
      </div>

      <p class="text-link-center">
        <button class="text-link"
                type="button"
                @click="router.push('/login')">Sign in</button>
      </p>

      <div v-if="sessionStore.user"
           class="button-row">
        <button class="btn btn-ghost"
                type="button"
                @click="sessionStore.logout().then(() => router.replace('/'))">Sign out</button>
      </div>
    </section>
  </main>
</template>
