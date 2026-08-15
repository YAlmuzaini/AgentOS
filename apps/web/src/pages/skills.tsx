import { SKILL_KINDS, type CreateSkillInput, type SkillDto } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { useActiveProject } from "../hooks/use-project";

export function SkillsPage(): React.JSX.Element {
  const { project } = useActiveProject();
  const queryClient = useQueryClient();
  const projectId = project?.id;

  const skills = useQuery({
    queryKey: ["skills", projectId],
    queryFn: () => api.skills(projectId!),
    enabled: Boolean(projectId),
  });

  const create = useMutation({
    mutationFn: (body: CreateSkillInput) => api.createSkill(projectId!, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["skills", projectId] }),
  });

  if (!project) {
    return <p className="text-sm text-ink-muted">No project yet. Run `pnpm db:seed`.</p>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Skills</h1>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
            <tr>
              <th className="py-2">Name</th>
              <th>Slug</th>
              <th>Kind</th>
              <th>Body / file</th>
            </tr>
          </thead>
          <tbody>
            {(skills.data ?? []).map((skill: SkillDto) => (
              <tr key={skill.id} className="border-t border-edge">
                <td className="py-2">{skill.name}</td>
                <td className="machine text-xs text-ink-muted">{skill.slug}</td>
                <td className="text-ink-muted">{skill.kind}</td>
                <td className="max-w-xs truncate text-xs text-ink-faint">
                  {skill.kind === "prompt" ? skill.body : skill.filePath}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {skills.data?.length === 0 ? (
          <p className="py-2 text-sm text-ink-muted">No skills yet. Create one for agents to use.</p>
        ) : null}
      </div>

      <CreateSkillForm onCreate={(body) => create.mutate(body)} />
    </div>
  );
}

function CreateSkillForm(props: { onCreate: (body: CreateSkillInput) => void }): React.JSX.Element {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [kind, setKind] = useState<CreateSkillInput["kind"]>("prompt");
  const [body, setBody] = useState("");
  const [filePath, setFilePath] = useState("");

  return (
    <form
      className="grid gap-2 rounded-md border border-edge bg-surface-raised p-3 md:grid-cols-[1fr_1fr_auto_1fr_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name || !slug) return;
        props.onCreate({
          name,
          slug,
          kind,
          body,
          filePath: kind === "file" ? filePath || null : null,
        });
        setName("");
        setSlug("");
        setBody("");
        setFilePath("");
      }}
    >
      <input
        className="rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm"
        placeholder="Name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <input
        className="rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm"
        placeholder="slug"
        value={slug}
        onChange={(event) => setSlug(event.target.value)}
      />
      <select
        className="rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm"
        value={kind}
        onChange={(event) => setKind(event.target.value as CreateSkillInput["kind"])}
      >
        {SKILL_KINDS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
      {kind === "prompt" ? (
        <input
          className="rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm"
          placeholder="Prompt body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      ) : (
        <input
          className="rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm"
          placeholder="/path/to/file"
          value={filePath}
          onChange={(event) => setFilePath(event.target.value)}
        />
      )}
      <button className="rounded-sm bg-edge px-3 py-1.5 text-sm hover:bg-edge-strong" type="submit">
        Create
      </button>
    </form>
  );
}
