import type {
  CreateRepoInput,
  GithubInstallationDto,
  RepoDto,
  SecretRefDto,
} from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderGit2, GitBranch, KeyRound, Plus } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { CreatePanel } from "../components/ui/create-panel";
import { DeleteAction } from "../components/ui/delete-action";
import { EmptyState, SkeletonRows } from "../components/ui/feedback";
import { Field, Input } from "../components/ui/form";
import { IconTile, toneFor } from "../components/ui/icon-tile";
import { Meta, MetaRow } from "../components/ui/meta";
import { Page, PageHeader } from "../components/ui/page";
import { Panel } from "../components/ui/panel";
import { CountChip, StatusPill } from "../components/ui/pill";
import { Table, TableCard, TD, TH, THead, TR } from "../components/ui/table";
import { useProjectGate } from "../hooks/use-project";
import { GithubPanel } from "./github-panel";
import { NoProject, ProjectPending } from "./project-states";
import { RepoSourceField, type RepoSource } from "./repo-source-field";

export function ReposPage(): React.JSX.Element {
  const { project, pending, absent } = useProjectGate();
  const queryClient = useQueryClient();
  const projectId = project?.id;
  const [creating, setCreating] = useState(false);

  const repos = useQuery({
    queryKey: ["repos", projectId],
    queryFn: () => api.repos(projectId!),
    enabled: Boolean(projectId),
  });

  const secrets = useQuery({
    queryKey: ["secrets", projectId],
    queryFn: () => api.secrets(projectId!),
    enabled: Boolean(projectId),
  });

  const github = useQuery({
    queryKey: ["github-status", projectId],
    queryFn: () => api.githubStatus(projectId!),
    enabled: Boolean(projectId),
  });

  const create = useMutation({
    mutationFn: (body: CreateRepoInput) => api.createRepo(projectId!, body),
    onSuccess: () => {
      setCreating(false);
      void queryClient.invalidateQueries({ queryKey: ["repos", projectId] });
    },
  });

  const [name, setName] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [mountPath, setMountPath] = useState("/repo");
  const [defaultBranch, setDefaultBranch] = useState("main");
  // Defaults to the first connected installation, because that is the safer of
  // the two credentials and an operator who connected one meant to use it.
  const [source, setSource] = useState<RepoSource>({
    installationId: "",
    credentialSecretId: "",
  });
  const installations = github.data?.installations ?? [];
  const effectiveSource: RepoSource =
    source.installationId || source.credentialSecretId || installations.length === 0
      ? source
      : { installationId: installations[0]!.id, credentialSecretId: "" };

  if (absent) {
    return <NoProject />;
  }
  if (pending || !project) {
    return <ProjectPending />;
  }

  const list = repos.data ?? [];

  return (
    <Page>
      <PageHeader
        icon={<GitBranch />}
        title="Repositories"
        meta={list.length > 0 ? <CountChip>{list.length}</CountChip> : undefined}
        actions={
          <Button variant="solid" onClick={() => setCreating(true)}>
            <Plus />
            New repository
          </Button>
        }
      />

      <GithubPanel projectId={project.id} />

      <CreatePanel
        open={creating}
        onClose={() => setCreating(false)}
        title="New repository"
        description="The repository is cloned into each authorized session. Persist changes by pushing commits."
        submitLabel="Create"
        pending={create.isPending}
        disabled={!name || !remoteUrl || !mountPath}
        incomplete="A name, a remote URL and a mount path are required."
        error={create.isError ? "Repository creation failed." : null}
        onSubmit={async () => {
          await create.mutateAsync({
            name,
            remoteUrl,
            mountPath,
            defaultBranch: defaultBranch || "main",
            githubInstallationId: effectiveSource.installationId || null,
            credentialSecretId: effectiveSource.credentialSecretId || null,
          });
          setName("");
          setRemoteUrl("");
          setMountPath("/repo");
          setDefaultBranch("main");
          setSource({ installationId: "", credentialSecretId: "" });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            {(id) => (
              <Input id={id} value={name} onChange={(event) => setName(event.target.value)} />
            )}
          </Field>
          <Field label="Remote URL">
            {(id) => (
              <Input
                id={id}
                className="machine"
                placeholder="https://github.com/…"
                value={remoteUrl}
                onChange={(event) => setRemoteUrl(event.target.value)}
              />
            )}
          </Field>
          <Field label="Mount path">
            {(id) => (
              <Input
                id={id}
                className="machine"
                value={mountPath}
                onChange={(event) => setMountPath(event.target.value)}
              />
            )}
          </Field>
          <Field label="Default branch">
            {(id) => (
              <Input
                id={id}
                className="machine"
                value={defaultBranch}
                onChange={(event) => setDefaultBranch(event.target.value)}
              />
            )}
          </Field>
          <RepoSourceField
            projectId={project.id}
            installations={installations}
            value={effectiveSource}
            onChange={setSource}
            onPickRepo={(repo) => {
              // GitHub is the authority on all three: a hand-typed remote is
              // how a repo ends up cloning the wrong default branch.
              setRemoteUrl(repo.cloneUrl);
              setDefaultBranch(repo.defaultBranch);
              const short = repo.fullName.split("/").pop() ?? repo.fullName;
              setName(short);
              setMountPath(`/${short}`);
            }}
            secrets={secrets.data ?? []}
          />
        </div>
      </CreatePanel>

      {repos.isLoading ? (
        <Panel>
          <SkeletonRows />
        </Panel>
      ) : list.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<GitBranch />}
            title="No repositories yet"
            hint="Connect GitHub or add a remote repository, then grant access to the required agents."
            action={
              <Button variant="outline" onClick={() => setCreating(true)}>
                <Plus />
                New repository
              </Button>
            }
          />
        </Panel>
      ) : (
        <TableCard>
          <Table>
            <THead>
              <tr>
                <TH>Repository</TH>
                <TH>Mount path</TH>
                <TH>Branch</TH>
                <TH>Auth</TH>
                <TH aria-label="Actions" />
              </tr>
            </THead>
            <tbody>
              {list.map((repo: RepoDto) => (
                <TR key={repo.id}>
                  {/* The remote is the repo's real identity, so it sits under
                      the name rather than in a column of its own where it
                      truncated to the host and told the operator nothing. */}
                  <TD className="max-w-[20rem]">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <IconTile tone={toneFor(repo.id)} size="sm">
                        <FolderGit2 />
                      </IconTile>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink">{repo.name}</p>
                        <p
                          className="machine truncate text-xs text-ink-muted"
                          title={repo.remoteUrl}
                        >
                          {repo.remoteUrl}
                        </p>
                      </div>
                    </div>
                  </TD>
                  <TD className="machine max-w-[12rem] truncate text-xs text-ink-muted">
                    {repo.mountPath}
                  </TD>
                  {/* A branch name is a machine value, not a status. */}
                  <TD>
                    <StatusPill tone="neutral" className="machine">
                      {repo.defaultBranch}
                    </StatusPill>
                  </TD>
                  <TD className="max-w-[14rem]">
                    <RepoAuth
                      repo={repo}
                      installations={installations}
                      secrets={secrets.data ?? []}
                    />
                  </TD>
                  <TD className="w-0 text-right">
                    <DeleteAction
                      what={repo.name}
                      body={
                        <>
                          The remote repository will not be deleted. This removes the mount and all
                          agent access to <span className="machine">{repo.mountPath}</span>.
                        </>
                      }
                      onDelete={() => api.deleteRepo(project.id, repo.id)}
                      invalidate={[
                        ["repos", project.id],
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

/**
 * Which credential clones this repo, as one fact rather than a hand-built
 * "GitHub · login" string. An installation and a stored token are different
 * kinds of answer — one is short-lived and scoped, the other is not — so they
 * get different glyphs, and an unresolved id falls back to the machine font
 * because at that point the id is all the operator has to go on.
 */
function RepoAuth({
  repo,
  installations,
  secrets,
}: {
  repo: RepoDto;
  installations: GithubInstallationDto[];
  secrets: SecretRefDto[];
}): React.JSX.Element {
  if (repo.githubInstallationId) {
    const installation = installations.find((i) => i.id === repo.githubInstallationId);
    return (
      <MetaRow>
        <Meta icon={<GitBranch />} title="Short-lived token from a GitHub App installation">
          GitHub
        </Meta>
        <Meta machine={!installation?.accountLogin}>
          {installation?.accountLogin ?? repo.githubInstallationId}
        </Meta>
      </MetaRow>
    );
  }

  if (repo.credentialSecretId) {
    const secret = secrets.find((s) => s.id === repo.credentialSecretId);
    return (
      <MetaRow>
        <Meta icon={<KeyRound />} machine={!secret} title={repo.credentialSecretId}>
          {secret?.name ?? repo.credentialSecretId}
        </Meta>
      </MetaRow>
    );
  }

  return <span className="text-xs text-ink-faint">none</span>;
}
