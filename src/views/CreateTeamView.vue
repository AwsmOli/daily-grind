<script setup lang="ts">
import { createUserWithEmailAndPassword, signOut, updateProfile } from 'firebase/auth';
import { ref } from 'vue';
import { useRouter } from 'vue-router';

import { createTeam } from '../lib/data';
import { auth, isFirebaseConfigured } from '../lib/firebase';
import { useTeamStore } from '../stores/team';

const router = useRouter();
const teamStore = useTeamStore();

const teamName = ref('');
const displayName = ref('');
const pointsUnitName = ref('Credits');
const pointsUnitCode = ref('CR');
const pointsUnitSymbol = ref('');
const email = ref('');
const password = ref('');
const isSubmitting = ref(false);
const errorMessage = ref('');

const handleCreateTeam = async () => {
  errorMessage.value = '';

  if (!isFirebaseConfigured || !auth) {
    errorMessage.value = 'Firebase is not configured yet. Add your env keys and restart the app.';
    return;
  }

  if (!teamName.value.trim()) {
    errorMessage.value = 'Team name is required.';
    return;
  }

  if (!displayName.value.trim()) {
    errorMessage.value = 'Your name is required.';
    return;
  }

  if (!email.value.trim() || password.value.length < 6) {
    errorMessage.value = 'Provide a valid email and a password with at least 6 characters.';
    return;
  }

  isSubmitting.value = true;

  try {
    if (auth.currentUser) {
      await signOut(auth);
    }

    const credential = await createUserWithEmailAndPassword(auth, email.value.trim(), password.value);
    await updateProfile(credential.user, { displayName: displayName.value.trim() });
    const teamId = await createTeam(credential.user, {
      name: teamName.value,
      pointsUnit: {
        name: pointsUnitName.value,
        code: pointsUnitCode.value,
        symbol: pointsUnitSymbol.value,
      },
    });

    teamStore.setActiveTeam(teamId);
    router.push('/team');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create team.';
    errorMessage.value = message;
  } finally {
    isSubmitting.value = false;
  }
};
</script>

<template>
  <main class="screen cool-bg">
    <section class="card">
      <p class="eyebrow">Create Team</p>
      <h1>Sign up with email to lead a team</h1>
      <p class="lead">
        Creating a team requires email sign-up first. After this, you can create named invite links
        and QR invites for members.
      </p>

      <form class="form"
            @submit.prevent="handleCreateTeam">
        <label class="field-label"
               for="teamName">Team name</label>
        <input id="teamName"
               v-model="teamName"
               class="field"
               type="text"
               required />

        <label class="field-label"
               for="displayName">Your name</label>
        <input id="displayName"
               v-model="displayName"
               class="field"
               type="text"
               placeholder="e.g. Alex"
               required />

        <div class="field-group">
          <div>
            <label class="field-label"
                   for="pointsUnitName">Points unit name</label>
            <input id="pointsUnitName"
                   v-model="pointsUnitName"
                   class="field"
                   type="text"
                   required />
          </div>
          <div>
            <label class="field-label"
                   for="pointsUnitCode">Unit code</label>
            <input id="pointsUnitCode"
                   v-model="pointsUnitCode"
                   class="field"
                   type="text"
                   maxlength="8"
                   required />
          </div>
          <div>
            <label class="field-label"
                   for="pointsUnitSymbol">Unit symbol (optional)</label>
            <input id="pointsUnitSymbol"
                   v-model="pointsUnitSymbol"
                   class="field"
                   type="text"
                   maxlength="4" />
          </div>
        </div>

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
               autocomplete="new-password"
               minlength="6"
               required />

        <p v-if="errorMessage"
           class="error-text">{{ errorMessage }}</p>

        <div class="button-row">
          <button class="btn btn-primary"
                  type="submit"
                  :disabled="isSubmitting">
            {{ isSubmitting ? 'Creating...' : 'Create Team' }}
          </button>
          <button class="btn btn-ghost"
                  type="button"
                  @click="router.push('/')">Back</button>
        </div>
      </form>
    </section>
  </main>
</template>
