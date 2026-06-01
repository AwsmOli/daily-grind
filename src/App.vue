<script setup lang="ts">
import { onUnmounted, watch } from 'vue';

import { useSessionStore } from './stores/session';
import { useTeamStore } from './stores/team';

const sessionStore = useSessionStore();
const teamStore = useTeamStore();

// Start team subscriptions whenever we have both a user and an active team ID.
// This covers two cases:
//   1. Returning device: activeTeamId is already in localStorage when auth resolves
//   2. Fresh device: activeTeamId gets set by watchUserTeams after Firestore returns
watch(
  () => ({ uid: sessionStore.user?.uid, teamId: teamStore.activeTeamId }),
  ({ uid, teamId }) => {
    console.log('[app] uid+teamId watcher', uid, teamId);
    if (!uid || !teamId) return;
    teamStore.watchTeamContext(uid, teamId);
  },
  { immediate: true },
);

watch(
  () => sessionStore.user?.uid,
  (uid, prevUid) => {
    console.log('[app] uid watcher', uid, prevUid);
    if (uid === undefined) return; // Firebase not resolved yet

    if (!uid) {
      if (prevUid) {
        teamStore.cleanup();
        teamStore.clearActiveTeam();
      }
      return;
    }

    // Fetch the user's team list from Firestore.
    // If activeTeamId is empty (fresh device), this will set it and
    // the watcher above will trigger watchTeamContext automatically.
    teamStore.watchUserTeams(uid);
  },
  { immediate: true },
);

onUnmounted(() => {
  teamStore.cleanup();
});
</script>

<template>
  <RouterView v-slot="{ Component }">
    <Transition name="page"
                mode="out-in">
      <component :is="Component" />
    </Transition>
  </RouterView>
</template>
