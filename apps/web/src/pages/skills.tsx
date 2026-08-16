import { SKILL_KINDS, type CreateSkillInput, type SkillDto } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileCode, Plus, Sparkles } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { CreatePanel } from "../components/ui/create-panel";
import { DeleteAction } from "../components/ui/delete-action";
import { useConfirm } from "../components/ui/confirm";
import { EmptyState, InlineError, SkeletonRows } from "../components/ui/feedback";
import { Field, Input, Select, Textarea } from "../components/ui/form";
import { IconTile, toneFor } from "../components/ui/icon-tile";
import { Page, PageHeader } from "../components/ui/page";
import { Panel } from "../components/ui/panel";
import { CountChip, StatusPill } from "../components/ui/pill";
import { Table, TableCard, TD, TH, THead, TR } from "../components/ui/table";
import { useProjectGate } from "../hooks/use-project";
import { NoProject, ProjectPending } from "./project-states";

/**
 * Skills are reusable instruction blocks, so the index is a table rather than a
 * grid: an operator scanning this screen is looking for the one slug an agent
 * references, not reading each skill's prose.
 *
 * The screen used to carry two near-black buttons — "New skill" in the header
 * and "New skill" again in the empty state — which made neither of them the
 * primary action. The header keeps the solid one on every configuration screen
 * in the app; an empty state's control is the same action reached a second way,
 * so it is outline.
 */
export function SkillsPage(): React.JSX.Element {
  const { project, pending, absent } = useProjectGate();
  const queryClient = useQueryClient();
  const projectId = project?.id;
  const [creating, setCreating] = useState(false);

  const confirm = useConfirm();

  const skills = useQuery({
    queryKey: ["skills", projectId],
    queryFn: () => api.skills(projectId!),
    enabled: Boolean(projectId),
  });

  const installBuiltIns = useMutation({
    mutationFn: () => api.installBuiltInSkills(projectId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["skills", projectId] }),
  });

  /**
   * Bulk creation is worth a beat, even when it cannot destroy anything.
   *
   * The server inserts with `onConflictDoNothing` on the slug, so a skill you
   * have edited is left exactly as it is — and that is precisely what the
   * dialog has to say, because the operator's fear when they see "install" is
   * that it will overwrite their work. A confirmation that only says "are you
   * sure?" would leave them no better informed than the button did.
   */
  const confirmInstall = (): void =>
    confirm({
      kind: "warn",
      title: "Install the built-in skills?",
      body: (
        <>
          This adds the skills that ship with AgentOS to this project. A skill you have already
          written or edited is left untouched — installing only fills in the ones that are
          missing, and it is safe to run again.
        </>
      ),
      confirmLabel: "Install built-ins",
      onConfirm: () => installBuiltIns.mutate(),
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
        meta={list.length > 0 ? <CountChip>{list.length}</CountChip> : undefined}
        actions={
          <>
            <Button
              variant="outline"
              onClick={confirmInstall}
              disabled={installBuiltIns.isPending}
            >
              <Download />
              {installBuiltIns.isPending ? "Installing…" : "Install built-ins"}
            </Button>
            <Button variant="solid" onClick={() => setCreating(true)}>
              <Plus />
              New skill
            </Button>
          </>
        }
      />

      {/* Installing the built-ins is a mutation like any other, and it used to
          fail in silence — the button simply stopped saying "Installing…". */}
      {installBuiltIns.isError ? (
        <InlineError>Unable to install the built-in skills.</InlineError>
      ) : null}

      <CreatePanel
        open={creating}
        onClose={() => setCreating(false)}
        title="New skill"
        description="Add reusable instructions or a file reference for agents."
        submitLabel="Create"
        pending={create.isPending}
        disabled={!name || !slug}
        incomplete="A name and a slug are required."
        error={create.isError ? "Skill creation failed." : null}
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required>
            {(id) => (
              <Input id={id} value={name} onChange={(event) => setName(event.target.value)} />
            )}
          </Field>
          <Field label="Slug" required>
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
                placeholder="Enter the instructions provided to the agent"
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
            hint="Install the built-in skills or create reusable instructions for agents."
            action={
              <Button variant="outline" onClick={() => setCreating(true)}>
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
                <TH>Skill</TH>
                <TH>Kind</TH>
                <TH>Body / file</TH>
                <TH aria-label="Actions" />
              </tr>
            </THead>
            <tbody>
              {list.map((skill: SkillDto) => (
                <TR key={skill.id}>
                  {/* Identity first: the glyph, the name, then the slug an agent
                      actually references. The slug had its own column, which put
                      a grey machine value in the eye's path before the name. */}
                  <TD className="max-w-[18rem]">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <IconTile tone={toneFor(skill.id)} size="sm">
                        {skill.kind === "file" ? <FileCode /> : <Sparkles />}
                      </IconTile>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink">{skill.name}</p>
                        <p className="machine truncate text-xs text-ink-muted">{skill.slug}</p>
                      </div>
                    </div>
                  </TD>
                  {/* A kind is a category, not a state, so it stays neutral. */}
                  <TD>
                    <StatusPill tone="neutral">{skill.kind}</StatusPill>
                  </TD>
                  <TD
                    className={`max-w-[22rem] truncate text-xs text-ink-faint ${
                      skill.kind === "file" ? "machine" : ""
                    }`}
                    title={(skill.kind === "prompt" ? skill.body : skill.filePath) ?? undefined}
                  >
                    {skill.kind === "prompt" ? skill.body : skill.filePath}
                  </TD>
                  <TD className="w-0 text-right">
                    <DeleteAction
                      what={skill.name}
                      body={
                        <>
                          This skill will be removed from assigned agents in new sessions.
                          Referenced files will not be deleted.
                        </>
                      }
                      onDelete={() => api.deleteSkill(project.id, skill.id)}
                      invalidate={[
                        ["skills", project.id],
                        ["agents", project.id],
                      ]}
                    />
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
