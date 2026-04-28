import { createRouter, createWebHistory } from "vue-router";
import HomePage from "./views/HomePage.vue";
import EventPage from "./views/EventPage.vue";
import ProfilePage from "./views/ProfilePage.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "home", component: HomePage },
    { path: "/profile", name: "profile", component: ProfilePage },
    { path: "/event/:slug", name: "event", component: EventPage },
  ],
});

export default router;
