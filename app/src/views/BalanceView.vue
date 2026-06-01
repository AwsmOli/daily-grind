<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import { subscribeLedger } from '../lib/data';
import { minorToMajor } from '../lib/money';
import { useSessionStore } from '../stores/session';
import { useTeamStore } from '../stores/team';
import type { PointLedgerEntry } from '../types/domain';

const router = useRouter()
const sessionStore = useSessionStore()
const teamStore = useTeamStore()

const ledger = ref<PointLedgerEntry[]>([])
const pageError = ref('')
let unsubscribeLedger: (() => void) | null = null

const currentUserId = computed(() => sessionStore.user?.uid ?? '')
const activeTeamId = computed(() => teamStore.activeTeamId)
const pointsSymbol = computed(() => teamStore.activeTeam?.pointsUnit.symbol ?? '')

const balanceLabel = computed(() => {
  const major = minorToMajor(teamStore.activeAccount?.balanceMinor ?? 0)
  return pointsSymbol.value ? `${pointsSymbol.value}${major}` : major
})

const myLedger = computed(() =>
  ledger.value.filter((entry) => entry.userId === currentUserId.value),
)

const formatMinor = (value: number): string => {
  const major = minorToMajor(value)
  return pointsSymbol.value ? `${pointsSymbol.value}${major}` : major
}

const formatWhen = (value: Date | null): string => {
  if (!value) return 'n/a'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)
}

watch(
  () => [activeTeamId.value, currentUserId.value],
  ([teamId, userId]) => {
    if (unsubscribeLedger) {
      unsubscribeLedger()
      unsubscribeLedger = null
    }

    if (!teamId || !userId) return

    unsubscribeLedger = subscribeLedger(
      teamId,
      (entries) => {
        ledger.value = entries
      },
      (message) => {
        pageError.value = message
      },
    )
  },
  { immediate: true },
)

onUnmounted(() => {
  if (unsubscribeLedger) unsubscribeLedger()
})
</script>

<template>
  <main class="screen team-bg">
    <section class="card">
      <div class="panel-title-row">
        <div>
          <p class="eyebrow">Balance</p>
          <h1>{{ balanceLabel }}</h1>
        </div>

        <button class="btn btn-ghost" type="button" @click="router.push('/team')">Back</button>
      </div>

      <p v-if="pageError" class="error-text">{{ pageError }}</p>

      <section class="panel">
        <h2>All Changes</h2>
        <ul v-if="myLedger.length" class="todo-list compact-list">
          <li v-for="entry in myLedger" :key="entry.id">
            <strong>{{ formatMinor(entry.deltaMinor) }}</strong>
            <span> · balance {{ formatMinor(entry.balanceAfterMinor) }} · {{ entry.reasonType }} · {{ entry.note }}</span>
            <p class="task-meta">{{ formatWhen(entry.createdAt) }}</p>
          </li>
        </ul>
        <p v-else class="lead">No ledger changes yet.</p>
      </section>
    </section>
  </main>
</template>
