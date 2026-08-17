import type { CreateHandoffInput, Provenance, ResourceSlot } from "@agentos/shared";
import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents";
import { goals } from "./goals";
import { projects } from "./projects";
import { sessions } from "./sessions";
import { tasks } from "./tasks";

export const blueprintInstallations = pgTable(
  "blueprint_installations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    blueprintSlug: text("blueprint_slug").notNull(),
    version: text("version").notNull(),
    provenance: jsonb("provenance").$type<Provenance>().notNull(),
    installedAt: timestamp("installed_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("blueprint_installations_project_slug_key").on(table.projectId, table.blueprintSlug)],
);

export const packInstallations = pgTable(
  "pack_installations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    packSlug: text("pack_slug").notNull(),
    version: text("version").notNull(),
    provenance: jsonb("provenance").$type<Provenance>().notNull(),
    installedAt: timestamp("installed_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("pack_installations_project_slug_key").on(table.projectId, table.packSlug)],
);

export const preflightChecks = pgTable(
  "preflight_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id"),
    runnerPreference: text("runner_preference").notNull(),
    ready: text("ready").notNull(),
    findings: jsonb("findings").$type<Array<{ code: string; severity: string; message: string; subjectType: string; subjectId: string | null; action: string | null }>>().notNull().default(sql`'[]'::jsonb`),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("preflight_checks_project_checked_idx").on(table.projectId, table.checkedAt)],
);

export const projectResourceSlots = pgTable(
  "project_resource_slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    blueprintSlug: text("blueprint_slug").notNull(),
    slotKey: text("slot_key").notNull(),
    definition: jsonb("definition").$type<ResourceSlot>().notNull(),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("project_resource_slots_project_key").on(table.projectId, table.slotKey)],
);

export const goalDecisions = pgTable(
  "goal_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id").notNull().references(() => goals.id, { onDelete: "cascade" }),
    backend: text("backend").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    eligibleAgents: jsonb("eligible_agents").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    selectedAgents: jsonb("selected_agents").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    inputHash: text("input_hash").notNull(),
    durationMs: integer("duration_ms").notNull(),
    status: text("status").notNull().default("success"),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("goal_decisions_goal_created_idx").on(table.goalId, table.createdAt)],
);

type HandoffPayload = Pick<
  CreateHandoffInput,
  "outcome" | "evidence" | "verification" | "fileIds" | "commitShas" | "branch" | "risks" | "blockers" | "decisionsRequired" | "recommendedNextRole" | "nextStepBrief"
>;

export const handoffs = pgTable(
  "handoffs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id").references(() => goals.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
    fromAgentId: uuid("from_agent_id").notNull().references(() => agents.id, { onDelete: "restrict" }),
    payload: jsonb("payload").$type<HandoffPayload>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("handoffs_project_created_idx").on(table.projectId, table.createdAt),
    index("handoffs_task_idx").on(table.taskId, table.createdAt),
    index("handoffs_goal_idx").on(table.goalId, table.createdAt),
  ],
);
