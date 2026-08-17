import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { Layout } from "./app/layout";
import { ActivityPage } from "./pages/activity";
import { DashboardPage } from "./pages/dashboard";
import { AgentDetailPage } from "./pages/agent-detail-page";
import { AgentsPage } from "./pages/agents";
import { AutomationsPage } from "./pages/automations";
import { EnvironmentPage } from "./pages/environment";
import { FilesPage } from "./pages/files";
import { GoalsPage } from "./pages/goals";
import { InboxPage } from "./pages/inbox";
import { McpsPage } from "./pages/mcps";
import { NotFoundPage } from "./pages/not-found";
import { ProjectSettingsPage } from "./pages/project-settings";
import { ReposPage } from "./pages/repos";
import { RouteErrorPage } from "./pages/route-error";
import { SecretsPage } from "./pages/secrets";
import { SessionsPage } from "./pages/sessions";
import { SettingsPage } from "./pages/settings";
import { SkillsPage } from "./pages/skills";
import { TasksPage } from "./pages/tasks";
import { TemplatesPage } from "./pages/templates";
import { TriggersPage } from "./pages/triggers";

// The 404 hangs off the root route so it renders *inside* the shell: an
// operator who mistypes a path should still have the rail, the top bar and a
// way out, not a bare sheet with two words on it.
const rootRoute = createRootRoute({
  component: Layout,
  notFoundComponent: NotFoundPage,
  // Without this, a screen that throws while rendering leaves a blank white
  // sheet and a console warning nobody operating the product is reading.
  errorComponent: ({ error }) => <RouteErrorPage error={error} />,
});

// Routes are declared one by one rather than through a helper: TanStack infers
// the literal path of each route, and that inference is what makes <Link to>
// type-checked across the app.
// The app opens on the overview: what ran, what broke, what is parked on you.
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: DashboardPage,
});


/**
 * `?id=` — how the command palette opens the thing you actually searched for.
 *
 * Validated rather than trusted: the router parses search values as JSON, so a
 * hand-typed id can arrive as a number, an object, or anything else. Only a
 * plain non-empty string is accepted, and everything else degrades to the bare
 * list rather than crashing the page.
 */
function idSearch(search: Record<string, unknown>): { id?: string } {
  return typeof search.id === "string" && search.id.length > 0 ? { id: search.id } : {};
}

const tasksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tasks",
  component: TasksPage,
  // `?new` is how the top bar's create button opens the dialog from any screen,
  // so there is one create control in the app rather than one per surface.
  // Returning the key only when it is on keeps `?new=false` out of the URL:
  // an omitted flag is the closed state, and the bare /tasks stays clean.
  // The router parses search values as JSON, so a hand-typed `?new=1` arrives
  // as the number 1 and `?new=true` as a boolean. Accept the lot.
  validateSearch: (search: Record<string, unknown>): { new?: true; id?: string } => ({
    ...(search.new === true || search.new === "true" || search.new === "1" || search.new === 1
      ? { new: true as const }
      : {}),
    ...idSearch(search),
  }),
});

/**
 * One agent, one address.
 *
 * The detail used to be `/agents?id=…` rendered by the index component, which
 * meant the grid and the agent were the same route: the browser could not tell
 * them apart, going back from an agent re-rendered the whole index, and the
 * address of an agent read like a filter. `?id=` still works — it redirects
 * below — so every link an operator already sent still lands.
 */
const agentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/agents",
  component: AgentsPage,
  validateSearch: idSearch,
  beforeLoad: ({ search }) => {
    if (search.id) {
      throw redirect({ to: "/agents/$agentId", params: { agentId: search.id }, replace: true });
    }
  },
});

const agentDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/agents/$agentId",
  component: AgentDetailPage,
});

const sessionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sessions",
  component: SessionsPage,
  validateSearch: idSearch,
});

const inboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/inbox",
  component: InboxPage,
  // The open message is in the URL, so a push notification can deep-link to
  // the question it is about rather than to the top of a list.
  validateSearch: idSearch,
});

const goalsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/goals",
  component: GoalsPage,
  validateSearch: idSearch,
});

const activityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/activity",
  component: ActivityPage,
});

const templatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/templates",
  component: TemplatesPage,
});

const skillsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/skills",
  component: SkillsPage,
  // Skills have no detail screen to deep-link to, so `?q=` is the way in: an
  // agent's skill chip lands here with the slug already in the filter.
  validateSearch: (search: Record<string, unknown>): { q?: string } =>
    typeof search.q === "string" && search.q ? { q: search.q } : {},
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

/**
 * The gear beside the project name. Deliberately a sibling of `/settings`
 * rather than a child: the two pages are different scopes, and nesting one
 * under the other would say they are the same thing at different depths.
 */
const projectSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/project",
  component: ProjectSettingsPage,
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
  agentDetailRoute,
  sessionsRoute,
  inboxRoute,
  goalsRoute,
  activityRoute,
  templatesRoute,
  skillsRoute,
  filesRoute,
  mcpsRoute,
  reposRoute,
  environmentRoute,
  secretsRoute,
  triggersRoute,
  automationsRoute,
  settingsRoute,
  projectSettingsRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
