// The orchestrator's decision prompt is reconstructed from Danny Postma's
// AgentOS talk — not his verbatim prompt.

import Anthropic from "@anthropic-ai/sdk";
import type { DodItem } from "@agentos/shared";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../config/config";

export const GOAL_EVALUATOR = Symbol("GOAL_EVALUATOR");

export interface GoalEvaluationInput {
  title: string;
  spec: string;
  definitionOfDone: DodItem[];
  progressLog: string;
  lastSessionSummary: string;
  /** Agent names the orchestrator is allowed to dispatch. */
  allowedAgents: string[];
}

export interface GoalEvaluation {
  /** Ids of checklist items now satisfied. */
  satisfiedIds: string[];
  /** Next specialist to dispatch, or null when the goal is finished. */
  nextAgent: string | null;
  /** What that specialist should do next, in one or two sentences. */
  brief: string;
  /** True when every checkbox is satisfied. */
  complete: boolean;
  reasoning: string;
}

/**
 * The orchestrator is control-plane code, not a chat agent (SPEC §8). It calls
 * a model only to make one structured decision — which checkboxes are now
 * satisfied, and who runs next — and never to do the specialist's work.
 */
export interface GoalEvaluator {
  evaluate(input: GoalEvaluationInput): Promise<GoalEvaluation>;
}

const DECISION_SCHEMA = {
  type: "object",
  properties: {
    satisfied_ids: {
      type: "array",
      items: { type: "string" },
      description: "Ids of definition-of-done items that the evidence shows are now satisfied.",
    },
    next_agent: {
      type: ["string", "null"],
      description: "Name of the next specialist to dispatch, or null if the goal is complete.",
    },
    brief: { type: "string", description: "One or two sentences telling that specialist what to do." },
    complete: { type: "boolean" },
    reasoning: { type: "string" },
  },
  required: ["satisfied_ids", "next_agent", "brief", "complete", "reasoning"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You are the AgentOS goal orchestrator.

Read the progress log, the definition of done, and the last session summary.
Decide two things: which definition-of-done items the evidence shows are now
satisfied, and which specialist agent should run next.

Only mark an item satisfied when the progress log contains evidence for it.
Absence of a complaint is not evidence. If you cannot tell, leave it unticked.

Choose the next agent only from the allowed list. Do not do the specialist's
work yourself — your output is a decision, not an implementation.`;

@Injectable()
export class ModelGoalEvaluator implements GoalEvaluator {
  private readonly logger = new Logger(ModelGoalEvaluator.name);
  private readonly client: Anthropic;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.client = new Anthropic(
      config.ANTHROPIC_API_KEY ? { apiKey: config.ANTHROPIC_API_KEY } : {},
    );
  }

  async evaluate(input: GoalEvaluationInput): Promise<GoalEvaluation> {
    const response = await this.client.messages.create({
      model: "claude-opus-5",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "high",
        format: { type: "json_schema", schema: DECISION_SCHEMA as unknown as Record<string, unknown> },
      },
      messages: [{ role: "user", content: renderDecisionInput(input) }],
    });

    if (response.stop_reason === "refusal") {
      throw new Error("goal evaluation was refused by the model's safety classifiers");
    }

    const text = response.content.find((block) => block.type === "text");
    if (!text || text.type !== "text") {
      throw new Error("goal evaluation returned no decision");
    }

    const decision = JSON.parse(text.text) as {
      satisfied_ids: string[];
      next_agent: string | null;
      brief: string;
      complete: boolean;
      reasoning: string;
    };

    const nextAgent =
      decision.next_agent && input.allowedAgents.includes(decision.next_agent)
        ? decision.next_agent
        : null;
    if (decision.next_agent && !nextAgent) {
      // SPEC §22.14: the orchestrator cannot dispatch outside the allow list.
      this.logger.warn(
        `orchestrator chose "${decision.next_agent}", which is not on the allowed list; stopping instead`,
      );
    }

    return {
      satisfiedIds: decision.satisfied_ids,
      nextAgent,
      brief: decision.brief,
      complete: decision.complete,
      reasoning: decision.reasoning,
    };
  }
}

function renderDecisionInput(input: GoalEvaluationInput): string {
  const checklist = input.definitionOfDone
    .map((item) => `- [${item.done ? "x" : " "}] (${item.id}) ${item.text}`)
    .join("\n");

  return [
    `# Goal\n${input.title}`,
    `\n# Specification\n${input.spec}`,
    `\n# Definition of done\n${checklist}`,
    `\n# Progress log\n${input.progressLog.trim() || "(nothing yet)"}`,
    `\n# Last session\n${input.lastSessionSummary.trim() || "(no session has run yet)"}`,
    `\n# Agents you may dispatch\n${input.allowedAgents.join(", ")}`,
  ].join("\n");
}
