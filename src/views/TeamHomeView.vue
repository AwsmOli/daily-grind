<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import {
  createTask,
  removeTask,
  setTaskAssignee,
  setTaskStatus,
  setTaskVisibility,
  subscribeAllPersonalTasks,
  subscribeLists,
  subscribePointAccounts,
  subscribeTasks,
  subscribeTeamMembers,
  updateTaskMeta,
} from '../lib/data';
import { majorToMinor, minorToMajor } from '../lib/money';
import { useSessionStore } from '../stores/session';
import { useTeamStore } from '../stores/team';
import type { PointAccount, TaskHistoryEntry, TaskItem, TeamList, TeamMember } from '../types/domain';

const router = useRouter();
const sessionStore = useSessionStore();
const teamStore = useTeamStore();

const lists = ref<TeamList[]>([]);
const members = ref<TeamMember[]>([]);
const memberAccounts = ref<PointAccount[]>([]);
const personalTasks = ref<TaskItem[]>([]);
const teamTasks = ref<TaskItem[]>([]);
const isBusy = ref(false);
const isLoadingTasks = ref(false);
const pageError = ref('');

// Admin member view: which member's personal tasks to show (null = current user's own view)
const viewingMemberId = ref<string | null>(null);
const memberPersonalTasks = ref<TaskItem[]>([]);
let unsubscribeMemberPersonalTasks: (() => void) | null = null;
// All personal tasks across the team (admin only, for counting)
const allTeamPersonalTasks = ref<TaskItem[]>([]);
let unsubscribeAllPersonalTasks: (() => void) | null = null;

const showCreateTodo = ref(false);
const selectedTaskId = ref<string | null>(null);
const assignUserId = ref('');
const editRecurringRule = ref('');
const taskTitle = ref('');
const taskDescription = ref('');
const taskPointsMajor = ref('0.00');
const taskRecurringRule = ref('');
const taskVisibility = ref<'personal' | 'shared'>('personal');
const taskAssigneeUserId = ref('');
const draggingTaskId = ref('');
const draggingTaskVisibility = ref<'personal' | 'shared' | ''>('');
const activeDropLane = ref<'personal' | 'shared' | ''>('');

let unsubscribeLists: (() => void) | null = null;
let unsubscribeMembers: (() => void) | null = null;
let unsubscribeAccounts: (() => void) | null = null;
let unsubscribePersonalTasks: (() => void) | null = null;
let unsubscribeTeamTasks: (() => void) | null = null;

const activeTeamId = computed(() => teamStore.activeTeamId);
const activeTeam = computed(() => teamStore.activeTeam);
const currentUserId = computed(() => sessionStore.user?.uid ?? '');
const currentUserLabel = computed(() => {
  const user = sessionStore.user;
  return user?.displayName || user?.email?.split('@')[0] || user?.uid || 'Unknown user';
});

const pointsSymbol = computed(() => activeTeam.value?.pointsUnit.symbol ?? '');
const activeBalanceMinor = computed(() => teamStore.activeAccount?.balanceMinor ?? 0);
const balanceLabel = computed(() => {
  const major = minorToMajor(activeBalanceMinor.value);
  return pointsSymbol.value ? `${pointsSymbol.value}${major}` : major;
});

const activeListId = computed(() => lists.value[0]?.id ?? '');

// When an admin is viewing a member, personal lane shows that member's tasks;
// shared lane filters team tasks to that member's assignments.
const personalTodos = computed(() => {
  const tasks = viewingMemberId.value ? memberPersonalTasks.value : personalTasks.value;
  return tasks.filter(t => t.status !== 'done');
});
const sharedTodos = computed(() => {
  let tasks = teamTasks.value.filter(t => t.status !== 'done');
  if (viewingMemberId.value) {
    tasks = tasks.filter(t => t.assigneeUserId === viewingMemberId.value);
  }
  return tasks;
});
const doneTasks = computed(() => {
  const personal = viewingMemberId.value ? memberPersonalTasks.value : personalTasks.value;
  return [...personal, ...teamTasks.value]
    .filter(t => t.status === 'done')
    .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0));
});
const allKnownTasks = computed(() => [...personalTasks.value, ...teamTasks.value]);
const isDraggingTask = computed(() => Boolean(draggingTaskId.value));
const showPersonalLane = computed(() => personalTodos.value.length > 0 || isDraggingTask.value);
const selectedTask = computed(() => allKnownTasks.value.find(t => t.id === selectedTaskId.value) ?? null);

const memberBalanceById = computed(() => {
  const map = new Map<string, number>();
  for (const acc of memberAccounts.value) {
    map.set(acc.userId, acc.balanceMinor);
  }
  return map;
});

// Outstanding task count per member:
// Uses allTeamPersonalTasks (admin subscription) + assigned team tasks.
const memberOutstandingById = computed(() => {
  const map = new Map<string, number>();
  for (const member of members.value) {
    const personal = allTeamPersonalTasks.value.filter(
      t => t.ownerUserId === member.userId && t.status !== 'done'
    ).length;
    const team = teamTasks.value.filter(
      t => t.assigneeUserId === member.userId && t.status !== 'done'
    ).length;
    const total = personal + team;
    if (total > 0) map.set(member.userId, total);
  }
  return map;
});

const viewingMember = computed(() =>
  viewingMemberId.value ? members.value.find(m => m.userId === viewingMemberId.value) ?? null : null,
);

const viewMemberTasks = (memberId: string) => {
  if (unsubscribeMemberPersonalTasks) {
    unsubscribeMemberPersonalTasks();
    unsubscribeMemberPersonalTasks = null;
  }
  if (viewingMemberId.value === memberId) {
    viewingMemberId.value = null;
    memberPersonalTasks.value = [];
    return;
  }
  viewingMemberId.value = memberId;
  memberPersonalTasks.value = [];
  unsubscribeMemberPersonalTasks = subscribeTasks(
    activeTeamId.value,
    memberId,
    'personal',
    (tasks) => { memberPersonalTasks.value = tasks; },
    (msg) => { pageError.value = msg; },
  );
};

const memberNameById = computed(() => {
  const map = new Map<string, string>();
  for (const member of members.value) {
    map.set(member.userId, member.displayName || member.email || member.userId);
  }
  return map;
});

const formatTaskPoints = (task: TaskItem) => {
  const major = minorToMajor(task.pointsMinor);
  return pointsSymbol.value ? `${pointsSymbol.value}${major}` : major;
};

const timeAgo = (date: Date | null): string => {
  if (!date) return '—';
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
};

const historyEventLabel = (entry: TaskHistoryEntry): string => {
  switch (entry.event) {
    case 'created': return 'Created';
    case 'assigned':
      if (!entry.detail || entry.detail === 'unassigned') return 'Unassigned';
      return `Assigned to ${memberNameById.value.get(entry.detail) || entry.detail}`;
    case 'repeat_changed':
      if (!entry.detail || entry.detail === 'none') return 'Repeat removed';
      return `Repeat: ${recurringLabel(entry.detail) || entry.detail}`;
    case 'visibility_changed':
      return entry.detail === 'shared' ? 'Moved to Team' : 'Moved to Personal';
    case 'status_change':
    default:
      switch (entry.status) {
        case 'done': return 'Completed';
        case 'todo': return 'Reopened';
        case 'in_progress': return 'In Progress';
        default: return entry.status ?? 'Updated';
      }
  }
};

const recurringLabel = (rule: string): string => {
  switch (rule) {
    case 'every_day': return 'Daily';
    case 'weekdays': return 'Weekdays';
    case 'weekly': return 'Weekly';
    case 'every_3_days': return 'Every 3 days';
    default: return '';
  }
};

const assignmentLabel = (task: TaskItem) => {
  const assigneeId = task.assigneeUserId || '';
  if (!assigneeId) return 'Unassigned';
  return memberNameById.value.get(assigneeId) || assigneeId;
};

const hasTaskPoints = (task: TaskItem) => task.pointsMinor > 0;

const restartSubscriptions = () => {
  if (unsubscribeLists) {
    unsubscribeLists();
    unsubscribeLists = null;
  }

  if (unsubscribePersonalTasks) {
    unsubscribePersonalTasks();
    unsubscribePersonalTasks = null;
  }

  if (unsubscribeMembers) {
    unsubscribeMembers();
    unsubscribeMembers = null;
  }

  if (unsubscribeAccounts) {
    unsubscribeAccounts();
    unsubscribeAccounts = null;
  }

  if (unsubscribeAllPersonalTasks) {
    unsubscribeAllPersonalTasks();
    unsubscribeAllPersonalTasks = null;
    allTeamPersonalTasks.value = [];
  }

  if (unsubscribeTeamTasks) {
    unsubscribeTeamTasks();
    unsubscribeTeamTasks = null;
  }

  if (unsubscribeMemberPersonalTasks) {
    unsubscribeMemberPersonalTasks();
    unsubscribeMemberPersonalTasks = null;
  }
  viewingMemberId.value = null;
  memberPersonalTasks.value = [];

  if (!activeTeamId.value || !currentUserId.value) return;

  isLoadingTasks.value = true;
  let personalLoaded = false;
  let teamLoaded = false;

  const checkLoaded = () => {
    if (personalLoaded && teamLoaded) isLoadingTasks.value = false;
  };

  unsubscribeLists = subscribeLists(
    activeTeamId.value,
    (nextLists) => {
      lists.value = nextLists.filter((list) => !list.archivedAt);
    },
    (message) => {
      pageError.value = message;
    },
  );

  unsubscribeMembers = subscribeTeamMembers(
    activeTeamId.value,
    (nextMembers) => {
      members.value = nextMembers;
      if (taskAssigneeUserId.value === undefined) {
        taskAssigneeUserId.value = '';
      }
    },
    (message) => {
      pageError.value = message;
    },
  );

  if (teamStore.isAdmin) {
    unsubscribeAccounts = subscribePointAccounts(
      activeTeamId.value,
      (accounts) => { memberAccounts.value = accounts; },
      (message) => { console.warn('[admin] subscribePointAccounts error:', message); },
    );
    unsubscribeAllPersonalTasks = subscribeAllPersonalTasks(
      activeTeamId.value,
      (tasks) => { allTeamPersonalTasks.value = tasks; },
      (message) => { console.warn('[admin] subscribeAllPersonalTasks error:', message); },
    );
  }

  unsubscribePersonalTasks = subscribeTasks(
    activeTeamId.value,
    currentUserId.value,
    'personal',
    (nextTasks) => {
      personalTasks.value = nextTasks;
      if (!personalLoaded) { personalLoaded = true; checkLoaded(); }
    },
    (message) => {
      pageError.value = message;
      isLoadingTasks.value = false;
    },
  );

  unsubscribeTeamTasks = subscribeTasks(
    activeTeamId.value,
    currentUserId.value,
    'shared',
    (nextTasks) => {
      teamTasks.value = nextTasks;
      if (!teamLoaded) { teamLoaded = true; checkLoaded(); }
    },
    (message) => {
      pageError.value = message;
      isLoadingTasks.value = false;
    },
  );
};

watch(
  () => [activeTeamId.value, currentUserId.value],
  () => {
    pageError.value = '';
    restartSubscriptions();
  },
  { immediate: true },
);

// When admin role resolves after initial load, start admin-only subscriptions
watch(
  () => teamStore.isAdmin,
  (isAdmin) => {
    if (!isAdmin || !activeTeamId.value) return;
    if (!unsubscribeAccounts) {
      unsubscribeAccounts = subscribePointAccounts(
        activeTeamId.value,
        (accounts) => { memberAccounts.value = accounts; },
        (message) => { console.warn('[admin] subscribePointAccounts error:', message); },
      );
    }
    if (!unsubscribeAllPersonalTasks) {
      unsubscribeAllPersonalTasks = subscribeAllPersonalTasks(
        activeTeamId.value,
        (tasks) => { allTeamPersonalTasks.value = tasks; },
        (message) => { console.warn('[admin] subscribeAllPersonalTasks error:', message); },
      );
    }
  },
);

// Once teams finish loading, redirect to welcome if the user has no team at all
watch(
  () => ({ loading: teamStore.loadingTeams, count: teamStore.teams.length }),
  ({ loading, count }) => {
    if (!loading && count === 0 && currentUserId.value) {
      router.replace('/');
    }
  },
);

const closeCreateTodo = () => {
  showCreateTodo.value = false;
  taskTitle.value = '';
  taskDescription.value = '';
  taskPointsMajor.value = '0.00';
  taskRecurringRule.value = '';
  taskVisibility.value = 'personal';
  taskAssigneeUserId.value = currentUserId.value;
};

const createTodo = async () => {
  if (!activeTeamId.value || !currentUserId.value) return;

  if (!taskTitle.value.trim()) {
    pageError.value = 'Task title is required.';
    return;
  }

  if (!activeListId.value) {
    pageError.value = 'This team has no active list yet.';
    return;
  }

  pageError.value = '';
  isBusy.value = true;

  try {
    await createTask(activeTeamId.value, currentUserId.value, {
      listId: activeListId.value,
      title: taskTitle.value,
      description: taskDescription.value,
      visibility: taskVisibility.value,
      assigneeUserId:
        taskVisibility.value === 'shared'
          ? (taskAssigneeUserId.value || currentUserId.value)
          : currentUserId.value,
      pointsMinor: majorToMinor(taskPointsMajor.value),
      cooldownHours: 0,
      recurringRule: taskRecurringRule.value,
      dueAt: null,
    });

    closeCreateTodo();
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : 'Unable to create todo.';
  } finally {
    isBusy.value = false;
  }
};

const toggleTodoDone = async (task: TaskItem) => {
  if (!activeTeamId.value || !currentUserId.value) return;

  const nextStatus = task.status === 'done' ? 'todo' : 'done';
  const prevStatus = task.status;
  pageError.value = '';

  // Optimistic update — move the task immediately in the UI
  task.status = nextStatus;

  try {
    await setTaskStatus(activeTeamId.value, task.id, currentUserId.value, nextStatus);
  } catch (error) {
    task.status = prevStatus; // revert on failure
    pageError.value = error instanceof Error ? error.message : 'Unable to update todo status.';
  }
};

const deleteTodo = async (taskId: string) => {
  if (!activeTeamId.value) return;

  try {
    await removeTask(activeTeamId.value, taskId);
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : 'Unable to delete todo.';
  }
};

const openTaskDetails = (task: TaskItem) => {
  selectedTaskId.value = task.id;
  assignUserId.value = task.assigneeUserId || currentUserId.value;
  editRecurringRule.value = task.recurringRule || '';
};

const closeTaskDetails = () => {
  selectedTaskId.value = null;
};

const unassignTask = async (task: TaskItem) => {
  if (!activeTeamId.value) return;
  pageError.value = '';
  try {
    await setTaskAssignee(activeTeamId.value, task.id, '', currentUserId.value);
    if (selectedTask.value?.id === task.id) {
      assignUserId.value = '';
    }
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : 'Unable to unassign task.';
  }
};

const saveRecurringRule = async () => {
  if (!selectedTask.value || !activeTeamId.value) return;
  pageError.value = '';
  try {
    await updateTaskMeta(activeTeamId.value, selectedTask.value.id, currentUserId.value, {
      title: selectedTask.value.title,
      description: selectedTask.value.description,
      assigneeUserId: selectedTask.value.assigneeUserId,
      pointsMinor: selectedTask.value.pointsMinor,
      cooldownHours: selectedTask.value.cooldownHours,
      recurringRule: editRecurringRule.value,
      dueAt: selectedTask.value.dueAt,
    });
    // Firestore listener will update selectedTask automatically
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : 'Unable to save.';
  }
};

const assignTaskQuick = async (task: TaskItem, assigneeUserId: string) => {
  if (!activeTeamId.value || !assigneeUserId) return;

  pageError.value = '';

  try {
    await setTaskAssignee(activeTeamId.value, task.id, assigneeUserId, currentUserId.value);

    if (selectedTask.value?.id === task.id) {
      assignUserId.value = assigneeUserId;
    }
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : 'Unable to assign task.';
  }
};

const onTodoDragStart = (event: DragEvent, task: TaskItem) => {
  if (task.ownerUserId !== currentUserId.value) return;
  event.dataTransfer?.setData('text/plain', task.id);
  draggingTaskId.value = task.id;
  draggingTaskVisibility.value = task.visibility;
};

const onTodoDragEnd = () => {
  draggingTaskId.value = '';
  draggingTaskVisibility.value = '';
  activeDropLane.value = '';
};

const onTodoLaneDragOver = (lane: 'personal' | 'shared', event: DragEvent) => {
  if (!draggingTaskId.value) return;
  event.preventDefault();
  activeDropLane.value = lane;
};

const onTodoLaneDragLeave = () => {
  activeDropLane.value = '';
};

const onTodoLaneDrop = async (lane: 'personal' | 'shared', event: DragEvent) => {
  event.preventDefault();

  const taskId = draggingTaskId.value;
  const sourceVisibility = draggingTaskVisibility.value;
  onTodoDragEnd();

  if (!activeTeamId.value || !currentUserId.value || !taskId || !sourceVisibility) return;
  if (sourceVisibility === lane) return;

  const task = allKnownTasks.value.find((entry) => entry.id === taskId);
  if (!task || task.ownerUserId !== currentUserId.value) return;

  try {
    await setTaskVisibility(activeTeamId.value, taskId, lane);
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : 'Unable to move todo.';
  }
};

const closeAllOpenMenus = () => {
  if (typeof document === 'undefined') return;

  const openMenus = document.querySelectorAll('details[open]');
  openMenus.forEach((entry) => {
    (entry as HTMLDetailsElement).open = false;
  });
};

const handleDocumentClick = (event: MouseEvent) => {
  if (draggingTaskId.value) return;
  const target = event.target as Node | null;
  if (!target) return;

  const insideMenu = target instanceof Element && target.closest('details');
  if (insideMenu) return;

  closeAllOpenMenus();
};

onMounted(() => {
  document.addEventListener('click', handleDocumentClick);
});

onUnmounted(() => {
  document.removeEventListener('click', handleDocumentClick);
  if (unsubscribeLists) unsubscribeLists();
  if (unsubscribeMembers) unsubscribeMembers();
  if (unsubscribeAccounts) unsubscribeAccounts();
  if (unsubscribeAllPersonalTasks) unsubscribeAllPersonalTasks();
  if (unsubscribePersonalTasks) unsubscribePersonalTasks();
  if (unsubscribeTeamTasks) unsubscribeTeamTasks();
  if (unsubscribeMemberPersonalTasks) unsubscribeMemberPersonalTasks();
});
</script>

<template>
  <main class="team-home">
    <header class="dashboard-header">
      <h1 class="page-title">Todo</h1>

      <div class="header-account-block">
        <div class="account-info">
          <p class="account-user">{{ currentUserLabel }}</p>
          <button class="balance-link"
                  type="button"
                  @click="router.push('/team/balance')">
            {{ balanceLabel }}
          </button>
        </div>
        <details class="account-more-menu">
          <summary aria-label="Account menu">&#8942;</summary>
          <div class="task-more-popover context-menu">
            <button v-if="teamStore.isAdmin"
                    class="context-menu-item"
                    type="button"
                    @click="router.push('/team/settings')">
              Settings
            </button>
            <button class="context-menu-item"
                    type="button"
                    @click="sessionStore.logout().then(() => router.replace('/'))">Sign Out</button>
          </div>
        </details>
      </div>
    </header>

    <!-- Admin: member balance tiles -->
    <section v-if="teamStore.isAdmin && members.length"
             class="member-tiles-section">
      <div class="member-tiles-scroll">
        <button v-for="member in members"
                :key="member.userId"
                class="member-tile"
                :class="{ 'member-tile-active': viewingMemberId === member.userId }"
                type="button"
                @click="viewMemberTasks(member.userId)">
          <span class="member-tile-name">{{ member.displayName || member.email || 'Member' }}</span>
          <span class="member-tile-balance">
            {{ pointsSymbol }}{{ minorToMajor(memberBalanceById.get(member.userId) ?? 0) }}
          </span>
          <span v-if="(memberOutstandingById.get(member.userId) ?? 0) > 0"
                class="member-tile-count">
            {{ memberOutstandingById.get(member.userId) }} open
          </span>
        </button>
      </div>
    </section>

    <p v-if="pageError"
       class="error-text">{{ pageError }}</p>

    <div v-if="isLoadingTasks || teamStore.loadingTeams"
         class="lanes-loading">
      <span class="spinner"></span>
    </div>

    <template v-else>
      <div v-if="viewingMemberId && showPersonalLane"
           class="todos-divider">
        <span class="divider-label">{{ viewingMember?.displayName || viewingMember?.email || 'Member' }}</span>
        <span class="divider-sub">personal tasks</span>
      </div>

      <section v-if="showPersonalLane"
               class="todo-lane"
               :class="{ 'todo-lane-drop': activeDropLane === 'personal', 'todo-lane-empty': !personalTodos.length }"
               @dragover="onTodoLaneDragOver('personal', $event)"
               @dragleave="onTodoLaneDragLeave"
               @drop="onTodoLaneDrop('personal', $event)">

        <ul v-if="personalTodos.length"
            class="todo-list compact-list"
            style="position:relative">
          <TransitionGroup name="task-list">
            <li v-for="task in personalTodos"
                :key="task.id"
                class="todo-item-row"
                :class="{ 'todo-item-row--done': task.status === 'done' }"
                draggable="true"
                @click="openTaskDetails(task)"
                @dragstart="onTodoDragStart($event, task)"
                @dragend="onTodoDragEnd">
              <input class="task-checkbox"
                     type="checkbox"
                     :checked="task.status === 'done'"
                     @click.stop
                     @change="toggleTodoDone(task)" />
              <div class="todo-main">
                <div class="todo-top-row">
                  <p class="task-title">{{ task.title }}</p>

                  <details class="task-more-menu"
                           @click.stop>
                    <summary aria-label="More actions">&#8942;</summary>
                    <div class="task-more-popover context-menu">
                      <button class="context-menu-item"
                              type="button"
                              @click="deleteTodo(task.id)">Delete</button>
                    </div>
                  </details>
                </div>

                <div class="task-tags">
                  <p v-if="hasTaskPoints(task)"
                     class="points-chip">{{ formatTaskPoints(task) }}</p>
                  <span v-if="task.recurringRule"
                        class="tag-chip repeat-chip">{{ recurringLabel(task.recurringRule) }}</span>
                  <details class="assignment-menu"
                           @click.stop>
                    <summary class="assignment-chip">{{ assignmentLabel(task) }}</summary>
                    <div class="task-more-popover context-menu">
                      <button class="context-menu-item"
                              type="button"
                              @click="unassignTask(task)">Unassign</button>
                      <button class="context-menu-item"
                              type="button"
                              @click="assignTaskQuick(task, currentUserId)">
                        Assign to me
                      </button>
                      <button v-for="member in members.filter((entry) => entry.userId !== currentUserId)"
                              :key="`assign-${task.id}-${member.userId}`"
                              class="context-menu-item"
                              type="button"
                              @click="assignTaskQuick(task, member.userId)">
                        {{ member.displayName || member.email || member.userId }}
                      </button>
                    </div>
                  </details>
                </div>
              </div>
            </li>
          </TransitionGroup>
        </ul>

        <div v-else-if="isDraggingTask"
             class="lane-empty-drop"></div>
      </section>

      <div v-if="showPersonalLane"
           class="todos-divider">
        <span class="divider-label">Team</span>
        <span v-if="viewingMemberId"
              class="divider-sub">assigned to {{ viewingMember?.displayName || viewingMember?.email || 'member'
          }}</span>
      </div>

      <section class="todo-lane"
               :class="{ 'todo-lane-drop': activeDropLane === 'shared', 'todo-lane-empty': !sharedTodos.length }"
               @dragover="onTodoLaneDragOver('shared', $event)"
               @dragleave="onTodoLaneDragLeave"
               @drop="onTodoLaneDrop('shared', $event)">

        <ul v-if="sharedTodos.length"
            class="todo-list compact-list"
            style="position:relative">
          <TransitionGroup name="task-list">
            <li v-for="task in sharedTodos"
                :key="task.id"
                class="todo-item-row"
                :class="{ 'todo-item-row--done': task.status === 'done' }"
                :draggable="task.ownerUserId === currentUserId"
                @click="openTaskDetails(task)"
                @dragstart="onTodoDragStart($event, task)"
                @dragend="onTodoDragEnd">
              <input class="task-checkbox"
                     type="checkbox"
                     :checked="task.status === 'done'"
                     @click.stop
                     @change="toggleTodoDone(task)" />
              <div class="todo-main">
                <div class="todo-top-row">
                  <p class="task-title">{{ task.title }}</p>

                  <details v-if="task.ownerUserId === currentUserId"
                           class="task-more-menu"
                           @click.stop>
                    <summary aria-label="More actions">&#8942;</summary>
                    <div class="task-more-popover context-menu">
                      <button class="context-menu-item"
                              type="button"
                              @click="deleteTodo(task.id)">Delete</button>
                    </div>
                  </details>
                </div>

                <div class="task-tags">
                  <p v-if="hasTaskPoints(task)"
                     class="points-chip">{{ formatTaskPoints(task) }}</p>
                  <span v-if="task.recurringRule"
                        class="tag-chip repeat-chip">{{ recurringLabel(task.recurringRule) }}</span>
                  <details class="assignment-menu"
                           @click.stop>
                    <summary class="assignment-chip">{{ assignmentLabel(task) }}</summary>
                    <div class="task-more-popover context-menu">
                      <button class="context-menu-item"
                              type="button"
                              @click="unassignTask(task)">Unassign</button>
                      <button class="context-menu-item"
                              type="button"
                              @click="assignTaskQuick(task, currentUserId)">
                        Assign to me
                      </button>
                      <button v-for="member in members.filter((entry) => entry.userId !== currentUserId)"
                              :key="`assign-${task.id}-${member.userId}`"
                              class="context-menu-item"
                              type="button"
                              @click="assignTaskQuick(task, member.userId)">
                        {{ member.displayName || member.email || member.userId }}
                      </button>
                    </div>
                  </details>
                </div>
              </div>
            </li>
          </TransitionGroup>
        </ul>

        <div v-else-if="isDraggingTask"
             class="lane-empty-drop"></div>
      </section>

      <div v-if="doneTasks.length"
           class="todos-divider">
        <span class="divider-label">Done</span>
      </div>

      <ul v-if="doneTasks.length"
          class="todo-list compact-list done-list"
          style="position:relative">
        <TransitionGroup name="task-done">
          <li v-for="task in doneTasks"
              :key="task.id"
              class="todo-item-row todo-item-row--done"
              @click="openTaskDetails(task)">
            <input class="task-checkbox"
                   type="checkbox"
                   :checked="true"
                   @click.stop
                   @change="toggleTodoDone(task)" />
            <div class="todo-main">
              <div class="todo-top-row">
                <p class="task-title">{{ task.title }}</p>
                <details v-if="task.ownerUserId === currentUserId"
                         class="task-more-menu"
                         @click.stop>
                  <summary aria-label="More actions">&#8942;</summary>
                  <div class="task-more-popover context-menu">
                    <button class="context-menu-item"
                            type="button"
                            @click="deleteTodo(task.id)">Delete</button>
                  </div>
                </details>
              </div>
              <div class="task-tags">
                <p v-if="hasTaskPoints(task)"
                   class="points-chip">{{ formatTaskPoints(task) }}</p>
                <span v-if="task.recurringRule"
                      class="tag-chip repeat-chip">{{ recurringLabel(task.recurringRule) }}</span>
                <span class="assignment-chip">{{ assignmentLabel(task) }}</span>
              </div>
            </div>
          </li>
        </TransitionGroup>
      </ul>

    </template>

    <button class="fab-add"
            type="button"
            @click="showCreateTodo = true">+</button>

    <div v-if="showCreateTodo"
         class="modal-backdrop"
         @click.self="closeCreateTodo">
      <section class="modal-card">
        <h2>Add New TODO</h2>

        <form class="form"
              @submit.prevent="createTodo">
          <div>
            <label class="field-label">Visibility</label>
            <select v-model="taskVisibility"
                    class="field">
              <option value="personal">Personal</option>
              <option value="shared">Team</option>
            </select>
          </div>
          <div v-if="taskVisibility === 'shared'">
            <label class="field-label">Assign to</label>
            <select v-model="taskAssigneeUserId"
                    class="field">
              <option value="">Unassigned</option>
              <option v-for="member in members"
                      :key="`create-assignee-${member.userId}`"
                      :value="member.userId">
                {{ member.displayName || member.email || member.userId }}
              </option>
            </select>
          </div>
          <input v-model="taskTitle"
                 class="field"
                 type="text"
                 placeholder="Task title"
                 required />
          <textarea v-model="taskDescription"
                    class="field"
                    rows="3"
                    placeholder="Task description"></textarea>
          <input v-model="taskPointsMajor"
                 class="field"
                 type="number"
                 step="0.01"
                 min="0"
                 placeholder="Points" />
          <div>
            <label class="field-label">Repeat</label>
            <select v-model="taskRecurringRule"
                    class="field">
              <option value="">No repeat</option>
              <option value="every_day">Every day</option>
              <option value="weekdays">Weekdays</option>
              <option value="weekly">Weekly</option>
              <option value="every_3_days">Every 3 days</option>
            </select>
          </div>

          <div class="button-row">
            <button class="btn btn-primary"
                    type="submit"
                    :disabled="isBusy">Create</button>
            <button class="btn btn-ghost"
                    type="button"
                    @click="closeCreateTodo">Cancel</button>
          </div>
        </form>
      </section>
    </div>

    <div v-if="selectedTask"
         class="modal-backdrop"
         @click.self="closeTaskDetails">
      <section class="modal-card">
        <button class="modal-close"
                type="button"
                aria-label="Close"
                @click="closeTaskDetails">&#x2715;</button>
        <h2>{{ selectedTask.title }}</h2>

        <div class="task-tags">
          <p v-if="hasTaskPoints(selectedTask)"
             class="points-chip">{{ formatTaskPoints(selectedTask) }}</p>
          <span v-if="selectedTask.recurringRule"
                class="tag-chip repeat-chip">{{ recurringLabel(selectedTask.recurringRule)
                }}</span>
          <span class="assignment-chip">{{ assignmentLabel(selectedTask) }}</span>
          <span class="tag-chip">{{ selectedTask.visibility === 'shared' ? 'Team' : 'Personal' }}</span>
        </div>

        <p v-if="selectedTask.description"
           class="task-sub details-description">{{ selectedTask.description }}</p>

        <div class="form">
          <label class="field-label">Repeat</label>
          <div class="inline-form">
            <select v-model="editRecurringRule"
                    class="field">
              <option value="">No repeat</option>
              <option value="every_day">Every day</option>
              <option value="weekdays">Weekdays</option>
              <option value="weekly">Weekly</option>
              <option value="every_3_days">Every 3 days</option>
            </select>
            <button class="btn btn-secondary"
                    type="button"
                    @click="saveRecurringRule">Save</button>
          </div>
        </div>

        <div class="task-history">
          <h4 class="task-history-heading">History</h4>
          <ul v-if="selectedTask.statusHistory.length"
              class="task-history-list">
            <li v-for="(entry, i) in [...selectedTask.statusHistory].reverse()"
                :key="i"
                class="task-history-entry">
              <span :class="`history-status history-status--${entry.event}`">{{ historyEventLabel(entry) }}</span>
              <span class="history-meta">
                by {{ memberNameById.get(entry.changedBy) || entry.changedBy }}
                &middot;
                {{ entry.changedAt ? timeAgo(entry.changedAt) : '—' }}
              </span>
            </li>
          </ul>
          <p v-if="!selectedTask.statusHistory.length"
             class="task-meta">No history yet.</p>
        </div>
      </section>
    </div>
  </main>
</template>
