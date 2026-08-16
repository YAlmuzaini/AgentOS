import type { AgentDto, TaskTemplateDto } from "@agentos/shared";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "../components/ui/button";
import { CreatePanel } from "../components/ui/create-panel";
import { CheckboxField, Field, Input, Select, Textarea } from "../components/ui/form";
import { MicroLabel } from "../components/ui/panel";

export function CreateAutomationForm(props: {
  open: boolean;
  onClose: () => void;
  pending: boolean;
  agents: AgentDto[];
  templates: TaskTemplateDto[];
  onCreate: (body: {
    name: string;
    cron: string;
    timezone: string;
    agentId: string | null;
    taskTemplateId: string | null;
    taskName: string;
    taskBody: string;
    templateVariables: Record<string, string>;
    enabled: boolean;
  }) => void | Promise<void>;
}): React.JSX.Element | null {
  const [name, setName] = useState("");
  const [cron, setCron] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  // Off by default. An automation created to be inspected used to arm its
  // schedule the moment it existed, and the next cron occurrence spent money.
  const [enabled, setEnabled] = useState(false);
  const [shape, setShape] = useState<"inline" | "template">("inline");
  const [agentId, setAgentId] = useState("");
  const [taskName, setTaskName] = useState("");
  const [taskBody, setTaskBody] = useState("");
  const [taskTemplateId, setTaskTemplateId] = useState("");
  const [variableRows, setVariableRows] = useState<Array<{ key: string; value: string }>>([]);

  return (
    <CreatePanel
      open={props.open}
      onClose={props.onClose}
      title="New automation"
      description="Create tasks automatically on a cron schedule."
      submitLabel="Create"
      pending={props.pending}
      disabled={!name || !cron}
      onSubmit={async () => {
        const templateVariables = Object.fromEntries(
          variableRows.filter((row) => row.key.trim()).map((row) => [row.key, row.value]),
        );
        // Awaited: a rejected create must leave every field where it was.
        await props.onCreate({
          name,
          cron,
          timezone,
          agentId: shape === "inline" ? agentId || null : null,
          taskTemplateId: shape === "template" ? taskTemplateId || null : null,
          taskName: shape === "inline" ? taskName : "",
          taskBody: shape === "inline" ? taskBody : "",
          templateVariables: shape === "template" ? templateVariables : {},
          enabled,
        });
        setName("");
        setCron("");
        setTaskName("");
        setTaskBody("");
        setVariableRows([]);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Name">
          {(id) => (
            <Input
              id={id}
              placeholder="kebab-case"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <Field label="Cron">
          {(id) => (
            <Input
              id={id}
              className="machine"
              placeholder="0 9 * * *"
              value={cron}
              onChange={(event) => setCron(event.target.value)}
            />
          )}
        </Field>
        <Field label="Timezone">
          {(id) => (
            <Input
              id={id}
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
            />
          )}
        </Field>
      </div>

      {/* Off unless asked for. Every occurrence of an armed schedule starts an
          agent and spends credits, and an automation is usually created to be
          looked at before it is trusted. */}
      <CheckboxField
        tone="gate"
        label="Enable immediately. Each occurrence starts an agent session and consumes API credits."
        checked={enabled}
        onCheckedChange={setEnabled}
      />

      {/* A segmented control rather than radios: two exclusive shapes, and the
          fields below swap wholesale between them. */}
      <div>
        <MicroLabel className="mb-1.5">Task source</MicroLabel>
        <div
          role="radiogroup"
          aria-label="Task source"
          className="inline-flex rounded-control border border-edge bg-sunken p-0.5"
        >
          {(["inline", "template"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={shape === option}
              onClick={() => setShape(option)}
              className={`rounded-[6px] px-3 py-1 text-[13px] transition-colors ${
                shape === option
                  ? "bg-panel font-medium text-ink shadow-lift"
                  : "text-ink-muted hover:text-ink"
              }`}
            >
              {option === "inline" ? "Define task" : "Use template"}
            </button>
          ))}
        </div>
      </div>

      {shape === "inline" ? (
        <div className="space-y-4">
          <Field label="Assign to">
            {(id) => (
              <Select id={id} value={agentId} onChange={(event) => setAgentId(event.target.value)}>
                <option value="">Select an agent</option>
                {props.agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Task name">
            {(id) => (
              <Input
                id={id}
                value={taskName}
                onChange={(event) => setTaskName(event.target.value)}
              />
            )}
          </Field>
          <Field label="Task body">
            {(id) => (
              <Textarea
                id={id}
                rows={3}
                value={taskBody}
                onChange={(event) => setTaskBody(event.target.value)}
              />
            )}
          </Field>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Template">
            {(id) => (
              <Select
                id={id}
                value={taskTemplateId}
                onChange={(event) => setTaskTemplateId(event.target.value)}
              >
                <option value="">Select a template</option>
                {props.templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <div className="space-y-2">
            <MicroLabel>Template variables</MicroLabel>
            {variableRows.map((row, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  className="machine w-1/3"
                  placeholder="key"
                  aria-label={`Variable ${index + 1} key`}
                  value={row.key}
                  onChange={(event) => {
                    const next = [...variableRows];
                    next[index] = { ...row, key: event.target.value };
                    setVariableRows(next);
                  }}
                />
                <Input
                  className="flex-1"
                  placeholder="value"
                  aria-label={`Variable ${index + 1} value`}
                  value={row.value}
                  onChange={(event) => {
                    const next = [...variableRows];
                    next[index] = { ...row, value: event.target.value };
                    setVariableRows(next);
                  }}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove variable"
                  onClick={() => setVariableRows(variableRows.filter((_, i) => i !== index))}
                >
                  <X />
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setVariableRows([...variableRows, { key: "", value: "" }])}
            >
              <Plus />
              Add variable
            </Button>
          </div>
        </div>
      )}
    </CreatePanel>
  );
}
