import { createRouter, createWebHistory } from "vue-router";

import { useSessionStore } from "../stores/session";
import AdminSettingsView from "../views/AdminSettingsView.vue";
import BalanceView from "../views/BalanceView.vue";
import CreateTeamView from "../views/CreateTeamView.vue";
import JoinTeamView from "../views/JoinTeamView.vue";
import LoginView from "../views/LoginView.vue";
import TeamHomeView from "../views/TeamHomeView.vue";
import WelcomeView from "../views/WelcomeView.vue";

declare module "vue-router" {
  interface RouteMeta {
    requiresAuth?: boolean;
    guestOnly?: boolean;
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "welcome",
      component: WelcomeView,
      meta: { guestOnly: true },
    },
    {
      path: "/join",
      name: "join-team",
      component: JoinTeamView,
      meta: { guestOnly: true },
    },
    {
      path: "/login",
      name: "login",
      component: LoginView,
      meta: { guestOnly: true },
    },
    {
      path: "/create",
      name: "create-team",
      component: CreateTeamView,
      meta: { guestOnly: true },
    },
    {
      path: "/team",
      name: "team-home",
      component: TeamHomeView,
      meta: { requiresAuth: true },
    },
    {
      path: "/team/balance",
      name: "team-balance",
      component: BalanceView,
      meta: { requiresAuth: true },
    },
    {
      path: "/team/settings",
      name: "team-settings",
      component: AdminSettingsView,
      meta: { requiresAuth: true },
    },
  ],
});

router.beforeEach(async (to) => {
  const sessionStore = useSessionStore();

  // Wait for Firebase auth to resolve on cold load before making decisions
  await sessionStore.waitForBoot();

  const loggedIn = !!sessionStore.user;

  if (to.meta.requiresAuth && !loggedIn) {
    return { path: "/", replace: true };
  }

  if (to.meta.guestOnly && loggedIn) {
    return { path: "/team", replace: true };
  }
});

export default router;
