import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { Layout } from "./app/layout";
import { ActivityPage } from "./pages/activity";
import { AgentsPage } from "./pages/agents";
import { AutomationsPage } from "./pages/automations";
import { EnvironmentPage } from "./pages/environment";
import { FilesPage } from "./pages/files";
import { GoalsPage } from "./pages/goals";
import { InboxPage } from "./pages/inbox";
import { McpsPage } from "./pages/mcps";
import { ReposPage } from "./pages/repos";
import { SecretsPage } from "./pages/secrets";
import { SessionsPage } from "./pages/sessions";
import { SettingsPage } from "./pages/settings";
import { SkillsPage } from "./pages/skills";
import { TasksPage } from "./pages/tasks";
import { TriggersPage } from "./pages/triggers";

const rootRoute = createRootRoute({ component: Layout });

// Routes are declared one by one rather than through a helper: TanStack infers
// the literal path of each route, and that inference is what makes <Link to>
// type-checked across the app.
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/tasks" });
  },
});

const tasksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tasks",
  component: TasksPage,
  // `?new` is how the top bar's create button opens the dialog from any screen,
  // so there is one create control in the app rather than one per surface.
  // Returning the key only when it is on keeps `?new=false` out of the URL:
  // an omitted flag is the closed state, and the bare /tasks stays clean.
  validateSearch: (search: Record<string, unknown>): { new?: true } =>
    search.new === true || search.new === "true" || search.new === "1" ? { new: true } : {},
});

const agentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/agents",
  component: AgentsPage,
});

const sessionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sessions",
  component: SessionsPage,
});

const inboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/inbox",
  component: InboxPage,
});

const goalsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/goals",
  component: GoalsPage,
});

const activityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/activity",
  component: ActivityPage,
});

const skillsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/skills",
  component: SkillsPage,
});

const filesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/files",
  component: FilesPage,
});

const mcpsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/mcps",
  component: McpsPage,
});

const reposRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/repos",
  component: ReposPage,
});

const environmentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/environment",
  component: EnvironmentPage,
});

const secretsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/secrets",
  component: SecretsPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

const triggersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/triggers",
  component: TriggersPage,
});

const automationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/automations",
  component: AutomationsPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  tasksRoute,
  agentsRoute,
  sessionsRoute,
  inboxRoute,
  goalsRoute,
  activityRoute,
  skillsRoute,
  filesRoute,
  mcpsRoute,
  reposRoute,
  environmentRoute,
  secretsRoute,
  triggersRoute,
  automationsRoute,
  settingsRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
