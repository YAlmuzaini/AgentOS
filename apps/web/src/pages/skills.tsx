import {
  CATEGORIES,
  CATEGORY_LABELS,
  SKILL_KINDS,
  type Category,
  type CreateSkillInput,
  type SkillDto,
} from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { Download, FileCode, Plus, SearchX, Sparkles } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { countByCategory } from "../components/ui/category-filter";
import { CreatePanel } from "../components/ui/create-panel";
import { DeleteAction } from "../components/ui/delete-action";
import { useConfirm } from "../components/ui/confirm";
import { EmptyState, InlineError, SkeletonRows } from "../components/ui/feedback";
import { FilterBar } from "../components/ui/filter-bar";
import { Field, Input, Select, Textarea } from "../components/ui/form";
import { IconTile, toneFor } from "../components/ui/icon-tile";
import { Page, PageHeader } from "../components/ui/page";
import { Panel } from "../components/ui/panel";
import { CountChip, StatusPill } from "../components/ui/pill";
import { Table, TableCard, TD, TH, THead, TR } from "../components/ui/table";
import { useProjectGate } from "../hooks/use-project";
import { useUrlSelection } from "../hooks/use-url-selection";
import { matchesAll, queryTerms } from "../lib/search";
import { NoProject, ProjectPending } from "./project-states";
import { ProvenanceInline } from "../components/provenance";

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
  const [filter, setFilter] = useState<Category | null>(null);
  // Typing does not touch the URL — a query is a glance, and putting every
  // keystroke in the address bar would make the back button undo a letter. But
  // an arriving `?q=` does win, because that is an agent's skill chip saying
  // which row it meant. Same rule as `?id=`, so the same hook.
  const { q: queryFromUrl } = useSearch({ strict: false }) as { q?: string };
  const [selectedQuery, setQuery] = useUrlSelection(queryFromUrl);
  const query = selectedQuery ?? "";

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
   * The server never replaces a skill's text, and it only refreshes the
   * description and category of skills it installed itself. That distinction is
   * precisely what the dialog has to carry, because the operator's fear when
   * they see "install" is that it will overwrite their work. A confirmation
   * that only says "are you sure?" leaves them no better informed than the
   * button did.
   */
  const confirmInstall = (): void =>
    confirm({
      kind: "warn",
      title: "Install the built-in skills?",
      body: (
        <>
          This adds the skills that ship with AgentOS to this project.{" "}
          <strong className="font-medium text-ink">No skill's instructions are replaced</strong> —
          your edits to a body stay, and a skill you wrote yourself is untouched on every field.
          Installing fills in what is missing and refreshes the description and category of the
          built-ins it installed before. It is safe to run again.
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
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<Category>("general");
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
  // Counts stay on the whole library rather than on the search result: a chip
  // whose number drops as you type is a chip that vanishes mid-word, taking the
  // row's layout and the current selection with it.
  const counts = countByCategory(list, CATEGORIES);
  const terms = queryTerms(query);
  const filtering = terms.length > 0 || filter !== null;
  const shown = list.filter(
    (skill) =>
      (!filter || skill.category === filter) &&
      // Everything the table already shows, and nothing it does not: the body
      // of a prompt skill is a page of instructions, and searching it would
      // return rows whose match is nowhere on screen.
      matchesAll(
        terms,
        skill.name,
        skill.slug,
        skill.description,
        skill.kind,
        skill.filePath,
        CATEGORY_LABELS[skill.category],
      ),
  );

  const clearFilters = (): void => {
    setQuery("");
    setFilter(null);
  };

  return (
    <Page>
      <PageHeader
        icon={<Sparkles />}
        title="Skills"
        meta={
          list.length === 0 ? undefined : filtering ? (
            // While a filter is on, the honest number is how many are on screen,
            // with the library size beside it so the narrowing is visible.
            <CountChip>
              {shown.length} of {list.length}
            </CountChip>
          ) : (
            <CountChip>{list.length}</CountChip>
          )
        }
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
            description,
            category,
            kind,
            body,
            filePath: kind === "file" ? filePath || null : null,
          });
          setName("");
          setSlug("");
          setDescription("");
          setCategory("general");
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
          <Field label="Category">
            {(id) => (
              <Select
                id={id}
                value={category}
                onChange={(event) => setCategory(event.target.value as Category)}
              >
                {CATEGORIES.map((entry) => (
                  <option key={entry} value={entry}>
                    {CATEGORY_LABELS[entry]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        {/* What it does and when it applies — the line an operator reads while
            deciding whether to grant it to an agent. */}
        <Field label="Description" hint="What this skill does, and when to use it.">
          {(id) => (
            <Input
              id={id}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Runs the repository's checks and pastes the real output before finishing."
            />
          )}
        </Field>
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

      {/* One control, two ways in: narrow by word, or narrow by kind. A library
          of one needs neither. */}
      {list.length > 1 ? (
        <FilterBar
          query={query}
          onQueryChange={setQuery}
          label="Search skills"
          placeholder="Search skills…"
          counts={counts}
          category={filter}
          onCategoryChange={setFilter}
          total={list.length}
        />
      ) : null}

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
      ) : shown.length === 0 ? (
        // A filter that finds nothing has to say what it was looking for and
        // offer the way back, or the screen reads as an empty project.
        <Panel>
          <EmptyState
            icon={<SearchX />}
            title={query.trim() ? `No skills match “${query.trim()}”` : "No skills in this category"}
            hint="The search covers a skill's name, slug, description, kind and file path."
            action={
              <Button variant="outline" onClick={clearFilters}>
                Clear filters
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
                <TH>Category</TH>
                <TH>Kind</TH>
                <TH>What it is for</TH>
                <TH aria-label="Actions" />
              </tr>
            </THead>
            <tbody>
              {shown.map((skill: SkillDto) => (
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
                  {/* Both of these are facts with no state attached, so both
                      stay neutral — the tinted tones mean something here. */}
                  <TD>
                    <StatusPill tone="neutral">{CATEGORY_LABELS[skill.category]}</StatusPill>
                  </TD>
                  <TD>
                    <StatusPill tone="neutral">{skill.kind}</StatusPill>
                  </TD>
                  {/* The description if there is one, and the content itself
                      when there is not — a skill written before the column
                      existed still has to say something here. */}
                  <TD
                    className={`max-w-[22rem] truncate text-xs text-ink-faint ${
                      !skill.description && skill.kind === "file" ? "machine" : ""
                    }`}
                    title={
                      skill.description ||
                      (skill.kind === "prompt" ? skill.body : skill.filePath) ||
                      undefined
                    }
                  >
                    {skill.description ||
                      (skill.kind === "prompt" ? skill.body : skill.filePath)}
                    <span className="mt-1 block"><ProvenanceInline value={skill.provenance} /></span>
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
