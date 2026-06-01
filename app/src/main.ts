import { createPinia } from "pinia";
import { registerSW } from "virtual:pwa-register";
import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";
import { useSessionStore } from "./stores/session";
import "./style.css";

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);

// Start the Firebase auth observer before any router guard can run
useSessionStore(pinia).init();

app.use(router);
app.mount("#app");

registerSW({
  immediate: true,
});
