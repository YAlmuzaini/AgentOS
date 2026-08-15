import type { AgentDto, TaskTemplateDto } from "@agentos/shared";
import { useState } from "react";

export function CreateAutomationForm(props: {
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
  }) => void;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [cron, setCron] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [shape, setShape] = useState<"inline" | "template">("inline");
  const [agentId, setAgentId] = useState("");
  const [taskName, setTaskName] = useState("");
  const [taskBody, setTaskBody] = useState("");
  const [taskTemplateId, setTaskTemplateId] = useState("");
  const [variableRows, setVariableRows] = useState<Array<{ key: string; value: string }>>([]);

  return (
    <form
      className="space-y-2 rounded-md border border-edge bg-surface-raised p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name || !cron) return;
        const templateVariables = Object.fromEntries(
          variableRows.filter((row) => row.key.trim()).map((row) => [row.key, row.value]),
        );
        props.onCreate({
          name,
          cron,
          timezone,
          agentId: shape === "inline" ? agentId || null : null,
          taskTemplateId: shape === "template" ? taskTemplateId || null : null,
          taskName: shape === "inline" ? taskName : "",
          taskBody: shape === "inline" ? taskBody : "",
          templateVariables: shape === "template" ? templateVariables : {},
        });
        setName("");
        setCron("");
        setTaskName("");
        setTaskBody("");
        setVariableRows([]);
      }}
    >
      <div className="grid gap-2 md:grid-cols-3">
        <input
          className="rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm"
          placeholder="name (kebab-case)"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <input
          className="rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm machine"
          placeholder="cron, e.g. 0 9 * * *"
          value={cron}
          onChange={(event) => setCron(event.target.value)}
        />
        <input
          className="rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm"
          placeholder="timezone"
          value={timezone}
          onChange={(event) => setTimezone(event.target.value)}
        />
      </div>

      <div className="flex gap-3 text-xs text-ink-muted">
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            checked={shape === "inline"}
            onChange={() => setShape("inline")}
          />
          inline task
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            checked={shape === "template"}
            onChange={() => setShape("template")}
          />
          from template
        </label>
      </div>

      {shape === "inline" ? (
        <div className="space-y-2">
          <select
            className="w-full rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm"
            value={agentId}
            onChange={(event) => setAgentId(event.target.value)}
          >
            <option value="">assign agent…</option>
            {props.agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
          <input
            className="w-full rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm"
            placeholder="Task name"
            value={taskName}
            onChange={(event) => setTaskName(event.target.value)}
          />
          <textarea
            className="w-full rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm"
            placeholder="Task body"
            rows={3}
            value={taskBody}
            onChange={(event) => setTaskBody(event.target.value)}
          />
        </div>
      ) : (
        <div className="space-y-2">
          <select
            className="w-full rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm"
            value={taskTemplateId}
            onChange={(event) => setTaskTemplateId(event.target.value)}
          >
            <option value="">choose template…</option>
            {props.templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
          <div className="space-y-1.5">
            {variableRows.map((row, index) => (
              <div key={index} className="flex gap-2">
                <input
                  className="w-1/3 rounded-sm border border-edge bg-surface-sunken px-2 py-1 text-sm"
                  placeholder="key"
                  value={row.key}
                  onChange={(event) => {
                    const next = [...variableRows];
                    next[index] = { ...row, key: event.target.value };
                    setVariableRows(next);
                  }}
                />
                <input
                  className="flex-1 rounded-sm border border-edge bg-surface-sunken px-2 py-1 text-sm"
                  placeholder="value"
                  value={row.value}
                  onChange={(event) => {
                    const next = [...variableRows];
                    next[index] = { ...row, value: event.target.value };
                    setVariableRows(next);
                  }}
                />
                <button
                  className="rounded-sm bg-edge px-2 py-1 text-xs hover:bg-edge-strong"
                  type="button"
                  onClick={() => setVariableRows(variableRows.filter((_, i) => i !== index))}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              className="rounded-sm bg-edge px-2 py-1 text-xs hover:bg-edge-strong"
              type="button"
              onClick={() => setVariableRows([...variableRows, { key: "", value: "" }])}
            >
              + add variable
            </button>
          </div>
        </div>
      )}

      <button className="rounded-sm bg-edge px-3 py-1.5 text-sm hover:bg-edge-strong" type="submit">
        Create
      </button>
    </form>
  );
}
