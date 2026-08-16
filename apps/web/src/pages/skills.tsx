import { SKILL_KINDS, type CreateSkillInput, type SkillDto } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Sparkles } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { CreatePanel } from "../components/ui/create-panel";
import { EmptyState, SkeletonRows } from "../components/ui/feedback";
import { Field, Input, Select, Textarea } from "../components/ui/form";
import { Page, PageHeader } from "../components/ui/page";
import { Panel } from "../components/ui/panel";
import { StatusPill } from "../components/ui/pill";
import { Table, TableCard, TD, TH, THead, TR } from "../components/ui/table";
import { useProjectGate } from "../hooks/use-project";
import { NoProject, ProjectPending } from "./project-states";

export function SkillsPage(): React.JSX.Element {
  const { project, pending, absent } = useProjectGate();
  const queryClient = useQueryClient();
  const projectId = project?.id;
  const [creating, setCreating] = useState(false);

  const skills = useQuery({
    queryKey: ["skills", projectId],
    queryFn: () => api.skills(projectId!),
    enabled: Boolean(projectId),
  });

  const create = useMutation({
    mutationFn: (body: CreateSkillInput) => api.createSkill(projectId!, body),
    onSuccess: () => {
      setCreating(false);
      void queryClient.invalidateQueries({ queryKey: ["skills", projectId] });
    },
  });

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [kind, setKind] = useState<CreateSkillInput["kind"]>("prompt");
  const [body, setBody] = useState("");
  const [filePath, setFilePath] = useState("");

  if (absent) {
    return <NoProject />;
  }
  if (pending || !project) {
    return <ProjectPending />;
  }

  const list = skills.data ?? [];

  return (
    <Page>
      <PageHeader
        icon={<Sparkles />}
        title="Skills"
        meta={list.length > 0 ? `${list.length} available` : undefined}
        actions={
          <Button variant="solid" onClick={() => setCreating(true)}>
            <Plus />
            New skill
          </Button>
        }
      />

      <CreatePanel
        open={creating}
        onClose={() => setCreating(false)}
        title="New skill"
        description="Something an agent can be handed at run time."
        submitLabel="Create"
        pending={create.isPending}
        disabled={!name || !slug}
        error={create.isError ? "Could not create it." : null}
        onSubmit={async () => {
          await create.mutateAsync({
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
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Name">
            {(id) => (
              <Input id={id} value={name} onChange={(event) => setName(event.target.value)} />
            )}
          </Field>
          <Field label="Slug">
            {(id) => (
              <Input
                id={id}
                className="machine"
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
              />
            )}
          </Field>
          <Field label="Kind">
            {(id) => (
              <Select
                id={id}
                value={kind}
                onChange={(event) => setKind(event.target.value as CreateSkillInput["kind"])}
              >
                {SKILL_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        {/* The skill *is* this text, and a single-line input made anything
            longer than a sentence impossible to read while writing it. */}
        {kind === "prompt" ? (
          <Field label="Prompt body">
            {(id) => (
              <Textarea
                id={id}
                rows={10}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="What this skill tells the agent to do."
              />
            )}
          </Field>
        ) : (
          <Field label="File path">
            {(id) => (
              <Input
                id={id}
                className="machine"
                placeholder="/path/to/file"
                value={filePath}
                onChange={(event) => setFilePath(event.target.value)}
              />
            )}
          </Field>
        )}
      </CreatePanel>

      {skills.isLoading ? (
        <Panel>
          <SkeletonRows />
        </Panel>
      ) : list.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Sparkles />}
            title="No skills yet"
            hint="Create one for agents to use."
            action={
              <Button variant="solid" onClick={() => setCreating(true)}>
                <Plus />
                New skill
              </Button>
            }
          />
        </Panel>
      ) : (
        <TableCard>
          <Table>
            <THead>
              <tr>
                <TH>Name</TH>
                <TH>Slug</TH>
                <TH>Kind</TH>
                <TH>Body / file</TH>
              </tr>
            </THead>
            <tbody>
              {list.map((skill: SkillDto) => (
                <TR key={skill.id}>
                  <TD className="font-medium">{skill.name}</TD>
                  <TD className="machine text-xs text-ink-muted">{skill.slug}</TD>
                  <TD>
                    <StatusPill>{skill.kind}</StatusPill>
                  </TD>
                  <TD className="max-w-xs truncate text-xs text-ink-faint">
                    {skill.kind === "prompt" ? skill.body : skill.filePath}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableCard>
      )}
    </Page>
  );
}
