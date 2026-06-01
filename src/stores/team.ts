import { defineStore } from "pinia";
import { computed, ref } from "vue";

import {
  subscribePointAccount,
  subscribeTeam,
  subscribeTeamMember,
  subscribeUserTeams,
} from "../lib/data";
import type {
  PointAccount,
  Team,
  TeamMember,
  UserTeamSummary,
} from "../types/domain";

const ACTIVE_TEAM_KEY = "daily-grind:active-team-id";

export const useTeamStore = defineStore("team", () => {
  const teams = ref<UserTeamSummary[]>([]);
  const activeTeamId = ref<string>(localStorage.getItem(ACTIVE_TEAM_KEY) ?? "");
  const activeTeam = ref<Team | null>(null);
  const activeMember = ref<TeamMember | null>(null);
  const activeAccount = ref<PointAccount | null>(null);
  const loadingTeams = ref(false);
  const error = ref("");

  let unsubscribeTeams: (() => void) | null = null;
  let unsubscribeTeam: (() => void) | null = null;
  let unsubscribeMember: (() => void) | null = null;
  let unsubscribeAccount: (() => void) | null = null;

  const role = computed(() => activeMember.value?.role ?? "member");
  const isAdmin = computed(() => role.value === "admin");

  const setActiveTeam = (teamId: string) => {
    activeTeamId.value = teamId;
    localStorage.setItem(ACTIVE_TEAM_KEY, teamId);
  };

  const clearActiveTeam = () => {
    activeTeamId.value = "";
    activeTeam.value = null;
    activeMember.value = null;
    activeAccount.value = null;
    localStorage.removeItem(ACTIVE_TEAM_KEY);

    if (unsubscribeTeam) unsubscribeTeam();
    if (unsubscribeMember) unsubscribeMember();
    if (unsubscribeAccount) unsubscribeAccount();

    unsubscribeTeam = null;
    unsubscribeMember = null;
    unsubscribeAccount = null;
  };

  const watchUserTeams = (userId: string) => {
    console.log("[team] watchUserTeams called", userId);
    loadingTeams.value = true;

    if (unsubscribeTeams) unsubscribeTeams();

    unsubscribeTeams = subscribeUserTeams(
      userId,
      (nextTeams) => {
        console.log(
          "[team] subscribeUserTeams returned",
          nextTeams.length,
          "teams",
          nextTeams,
        );
        teams.value = nextTeams;
        loadingTeams.value = false;

        if (!nextTeams.length) {
          clearActiveTeam();
          return;
        }

        const hasActive = nextTeams.some(
          (team) => team.teamId === activeTeamId.value,
        );
        console.log(
          "[team] hasActive",
          hasActive,
          "activeTeamId",
          activeTeamId.value,
        );
        if (!hasActive) {
          setActiveTeam(nextTeams[0].teamId);
        }

        // Directly start team context — don't rely on external watcher timing
        console.log(
          "[team] calling watchTeamContext directly",
          userId,
          activeTeamId.value,
        );
        watchTeamContext(userId, activeTeamId.value);
      },
      (message) => {
        console.error("[team] subscribeUserTeams ERROR", message);
        error.value = message;
        loadingTeams.value = false;
      },
    );
  };

  const watchTeamContext = (userId: string, teamId: string) => {
    console.log("[team] watchTeamContext called", userId, teamId);
    if (!teamId) return;

    if (unsubscribeTeam) unsubscribeTeam();
    if (unsubscribeMember) unsubscribeMember();
    if (unsubscribeAccount) unsubscribeAccount();

    unsubscribeTeam = subscribeTeam(
      teamId,
      (team) => {
        activeTeam.value = team;
      },
      (message) => {
        error.value = message;
      },
    );

    unsubscribeMember = subscribeTeamMember(
      teamId,
      userId,
      (member) => {
        activeMember.value = member;
      },
      (message) => {
        error.value = message;
      },
    );

    unsubscribeAccount = subscribePointAccount(
      teamId,
      userId,
      (account) => {
        activeAccount.value = account;
      },
      (message) => {
        error.value = message;
      },
    );
  };

  const cleanup = () => {
    if (unsubscribeTeams) unsubscribeTeams();
    if (unsubscribeTeam) unsubscribeTeam();
    if (unsubscribeMember) unsubscribeMember();
    if (unsubscribeAccount) unsubscribeAccount();
  };

  return {
    teams,
    activeTeamId,
    activeTeam,
    activeMember,
    activeAccount,
    loadingTeams,
    error,
    role,
    isAdmin,
    setActiveTeam,
    clearActiveTeam,
    watchUserTeams,
    watchTeamContext,
    cleanup,
  };
});
