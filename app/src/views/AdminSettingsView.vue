<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import {
  adjustPoints,
  createInvite,
  removeMemberFromTeam,
  setMemberRole,
  subscribePointAccounts,
  subscribeTeamMembers,
  updateMemberDisplayName,
  updateTeamSettings,
} from '../lib/data';
import { majorToMinor, minorToMajor } from '../lib/money';
import { useSessionStore } from '../stores/session';
import { useTeamStore } from '../stores/team';
import type { PointAccount, TeamMember } from '../types/domain';

const router = useRouter();
const sessionStore = useSessionStore();
const teamStore = useTeamStore();

const members = ref<TeamMember[]>([]);
const accounts = ref<PointAccount[]>([]);
const pageError = ref('');
const actionMessage = ref('');

const teamNameInput = ref('');
const unitNameInput = ref('');
const unitCodeInput = ref('');
const unitSymbolInput = ref('');

const displayNameInput = ref('');

watch(
  () => teamStore.activeMember,
  (member) => {
    if (member?.displayName) displayNameInput.value = member.displayName;
  },
  { immediate: true },
);

const saveDisplayName = async () => {
  if (!activeTeamId.value || !currentUserId.value) return;
  if (!displayNameInput.value.trim()) {
    pageError.value = 'Name cannot be empty.';
    return;
  }
  pageError.value = '';
  actionMessage.value = '';
  try {
    await updateMemberDisplayName(
      activeTeamId.value,
      currentUserId.value,
      displayNameInput.value.trim(),
      sessionStore.user!,
    );
    actionMessage.value = 'Name updated.';
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : 'Unable to update name.';
  }
};

const adjustUserId = ref('');
const adjustDeltaMajor = ref('0.00');
const adjustNote = ref('');
const inviteToken = ref('');

let unsubscribeMembers: (() => void) | null = null;
let unsubscribeAccounts: (() => void) | null = null;

const activeTeamId = computed(() => teamStore.activeTeamId);
const activeTeam = computed(() => teamStore.activeTeam);
const currentUserId = computed(() => sessionStore.user?.uid ?? '');
const isAdmin = computed(() => teamStore.isAdmin);
const pointsSymbol = computed(() => activeTeam.value?.pointsUnit.symbol ?? '');

watch(
  () => activeTeam.value,
  (team) => {
    if (!team) return;

    teamNameInput.value = team.name;
    unitNameInput.value = team.pointsUnit.name;
    unitCodeInput.value = team.pointsUnit.code;
    unitSymbolInput.value = team.pointsUnit.symbol;
  },
  { immediate: true },
);

watch(
  () => [activeTeamId.value, currentUserId.value],
  ([teamId, userId]) => {
    if (unsubscribeMembers) {
      unsubscribeMembers();
      unsubscribeMembers = null;
    }

    if (unsubscribeAccounts) {
      unsubscribeAccounts();
      unsubscribeAccounts = null;
    }

    if (!teamId || !userId || !isAdmin.value) return;

    unsubscribeMembers = subscribeTeamMembers(
      teamId,
      (nextMembers) => {
        members.value = nextMembers;
        if (!adjustUserId.value && nextMembers.length) {
          adjustUserId.value = nextMembers[0].userId;
        }
      },
      (message) => {
        pageError.value = message;
      },
    );

    unsubscribeAccounts = subscribePointAccounts(
      teamId,
      (nextAccounts) => {
        accounts.value = nextAccounts;
      },
      (message) => {
        pageError.value = message;
      },
    );
  },
  { immediate: true },
);

const balanceForUser = (userId: string) => {
  const account = accounts.value.find((entry) => entry.userId === userId);
  const major = minorToMajor(account?.balanceMinor ?? 0);
  return pointsSymbol.value ? `${pointsSymbol.value}${major}` : major;
};

const saveTeamSettings = async () => {
  if (!activeTeamId.value || !isAdmin.value) return;

  actionMessage.value = '';

  try {
    await updateTeamSettings(activeTeamId.value, {
      name: teamNameInput.value,
      pointsUnitName: unitNameInput.value,
      pointsUnitCode: unitCodeInput.value,
      pointsUnitSymbol: unitSymbolInput.value,
    });

    actionMessage.value = 'Team settings updated.';
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : 'Unable to update team settings.';
  }
};

const changeRole = async (userId: string, role: 'admin' | 'member') => {
  if (!activeTeamId.value || !isAdmin.value || !currentUserId.value) return;

  if (userId === currentUserId.value && role !== 'admin') {
    pageError.value = 'You cannot demote yourself.';
    return;
  }

  pageError.value = '';
  actionMessage.value = '';

  try {
    await setMemberRole(activeTeamId.value, userId, role);
    actionMessage.value = 'Member role updated.';
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : 'Unable to change role.';
  }
};

const removeMember = async (userId: string) => {
  if (!activeTeamId.value || !isAdmin.value || !currentUserId.value) return;

  if (userId === currentUserId.value) {
    pageError.value = 'You cannot remove yourself.';
    return;
  }

  pageError.value = '';
  actionMessage.value = '';

  try {
    await removeMemberFromTeam(activeTeamId.value, userId);
    actionMessage.value = 'Member removed from team.';
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : 'Unable to remove member.';
  }
};

const applyAdjustment = async () => {
  if (!activeTeamId.value || !currentUserId.value || !isAdmin.value) return;

  if (!adjustUserId.value) {
    pageError.value = 'Select a member first.';
    return;
  }

  if (!adjustNote.value.trim()) {
    pageError.value = 'A note is required.';
    return;
  }

  pageError.value = '';
  actionMessage.value = '';

  try {
    await adjustPoints(
      activeTeamId.value,
      adjustUserId.value,
      currentUserId.value,
      majorToMinor(adjustDeltaMajor.value),
      'manual_adjust',
      adjustNote.value,
    );

    adjustDeltaMajor.value = '0.00';
    adjustNote.value = '';
    actionMessage.value = 'Point adjustment applied.';
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : 'Unable to apply point adjustment.';
  }
};

const createMemberInvite = async () => {
  if (!activeTeamId.value || !currentUserId.value || !isAdmin.value) return;

  pageError.value = '';
  actionMessage.value = '';

  try {
    const token = await createInvite(activeTeamId.value, currentUserId.value, 'New Member', 'link');
    inviteToken.value = token;
    actionMessage.value = 'Invite link created. Share it with the new member.';
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : 'Unable to create invite.';
  }
};

const inviteLink = computed(() => {
  if (!inviteToken.value) return '';
  return `${window.location.origin}/join?invite=${encodeURIComponent(inviteToken.value)}`;
});

const copyInviteLink = async () => {
  if (!inviteLink.value) return;

  await navigator.clipboard.writeText(inviteLink.value);
  actionMessage.value = 'Invite link copied.';
};

onUnmounted(() => {
  if (unsubscribeMembers) unsubscribeMembers();
  if (unsubscribeAccounts) unsubscribeAccounts();
});
</script>

<template>
  <main class="screen team-bg">
    <section class="card wide-card">
      <div class="panel-title-row">
        <div>
          <p class="eyebrow">Settings</p>
          <h1>Admin Settings</h1>
        </div>
        <button class="btn btn-ghost"
                type="button"
                @click="router.push('/team')">Back</button>
      </div>

      <p v-if="!isAdmin"
         class="error-text">Only admins can access this page.</p>
      <p v-if="pageError"
         class="error-text">{{ pageError }}</p>
      <p v-if="actionMessage"
         class="lead">{{ actionMessage }}</p>

      <section class="panel">
        <h2>Your Name</h2>
        <form class="form"
              @submit.prevent="saveDisplayName">
          <label class="field-label"
                 for="displayNameInput">Display name</label>
          <input id="displayNameInput"
                 v-model="displayNameInput"
                 class="field"
                 type="text"
                 required />
          <button class="btn btn-primary"
                  type="submit">Save Name</button>
        </form>
      </section>

      <template v-if="isAdmin">
        <section class="panel">
          <h2>Team Management</h2>
          <form class="form"
                @submit.prevent="saveTeamSettings">
            <label class="field-label">Team name</label>
            <input v-model="teamNameInput"
                   class="field"
                   type="text"
                   required />

            <div class="field-group">
              <div>
                <label class="field-label">Points unit name</label>
                <input v-model="unitNameInput"
                       class="field"
                       type="text"
                       required />
              </div>
              <div>
                <label class="field-label">Points unit code</label>
                <input v-model="unitCodeInput"
                       class="field"
                       type="text"
                       maxlength="8"
                       required />
              </div>
              <div>
                <label class="field-label">Points unit symbol</label>
                <input v-model="unitSymbolInput"
                       class="field"
                       type="text"
                       maxlength="4" />
              </div>
            </div>

            <button class="btn btn-primary"
                    type="submit">Save Team Settings</button>
          </form>
        </section>

        <section class="panel">
          <h2>Members & Points</h2>

          <div class="button-row">
            <button class="btn btn-primary"
                    type="button"
                    @click="createMemberInvite">Add Member</button>
            <button v-if="inviteLink"
                    class="btn btn-ghost"
                    type="button"
                    @click="copyInviteLink">Copy Invite Link</button>
          </div>
          <p v-if="inviteLink"
             class="lead">{{ inviteLink }}</p>

          <form class="form"
                @submit.prevent="applyAdjustment">
            <label class="field-label">Admin points adjustment</label>
            <select v-model="adjustUserId"
                    class="field">
              <option v-for="member in members"
                      :key="member.userId"
                      :value="member.userId">
                {{ member.displayName || member.email || member.userId }}
              </option>
            </select>
            <input v-model="adjustDeltaMajor"
                   class="field"
                   type="number"
                   step="0.01"
                   placeholder="Use + or - value" />
            <input v-model="adjustNote"
                   class="field"
                   type="text"
                   placeholder="Reason note (required)" />
            <button class="btn btn-secondary"
                    type="submit">Apply</button>
          </form>

          <ul class="todo-list compact-list">
            <li v-for="member in members"
                :key="member.userId"
                class="member-manage-row">
              <div>
                <strong>{{ member.displayName || member.email || member.userId }}</strong>
                <span> · {{ member.role }} · {{ balanceForUser(member.userId) }}</span>
              </div>

              <div class="button-row">
                <button class="btn btn-ghost"
                        type="button"
                        :disabled="member.userId === currentUserId"
                        @click="changeRole(member.userId, 'member')">
                  Set Member
                </button>
                <button class="btn btn-ghost"
                        type="button"
                        @click="changeRole(member.userId, 'admin')">Set Admin</button>
                <button class="btn btn-ghost"
                        type="button"
                        :disabled="member.userId === currentUserId"
                        @click="removeMember(member.userId)">
                  Remove
                </button>
              </div>
            </li>
          </ul>
        </section>
      </template>
    </section>
  </main>
</template>
