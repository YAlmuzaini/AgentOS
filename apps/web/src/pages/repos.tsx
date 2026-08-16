import type { CreateRepoInput, RepoDto } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitBranch, Plus } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { CreatePanel } from "../components/ui/create-panel";
import { EmptyState, SkeletonRows } from "../components/ui/feedback";
import { Field, Input } from "../components/ui/form";
import { Page, PageHeader } from "../components/ui/page";
import { Panel } from "../components/ui/panel";
import { StatusPill } from "../components/ui/pill";
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
        title="Repos"
        meta={list.length > 0 ? `${list.length} mounted` : undefined}
        actions={
          <Button variant="solid" onClick={() => setCreating(true)}>
            <Plus />
            New repo
          </Button>
        }
      />

      <GithubPanel projectId={project.id} />

      <CreatePanel
        open={creating}
        onClose={() => setCreating(false)}
        title="New repo"
        description="Mounted into the session container; commits are the only thing that survives it."
        submitLabel="Create"
        pending={create.isPending}
        disabled={!name || !remoteUrl || !mountPath}
        error={create.isError ? "Could not create it." : null}
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
            title="No repos yet"
            hint="Add one for agents to work in."
            action={
              <Button variant="solid" onClick={() => setCreating(true)}>
                <Plus />
                New repo
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
                <TH>Remote</TH>
                <TH>Mount path</TH>
                <TH>Branch</TH>
                <TH>Auth</TH>
              </tr>
            </THead>
            <tbody>
              {list.map((repo: RepoDto) => (
                <TR key={repo.id}>
                  <TD className="font-medium">{repo.name}</TD>
                  <TD className="machine max-w-xs truncate text-xs text-ink-muted">
                    {repo.remoteUrl}
                  </TD>
                  <TD className="machine text-xs text-ink-muted">{repo.mountPath}</TD>
                  <TD>
                    <StatusPill>{repo.defaultBranch}</StatusPill>
                  </TD>
                  <TD className="text-xs text-ink-faint">
                    {repo.githubInstallationId
                      ? `GitHub · ${
                          installations.find((i) => i.id === repo.githubInstallationId)
                            ?.accountLogin ?? "app"
                        }`
                      : repo.credentialSecretId
                        ? (secrets.data?.find((s) => s.id === repo.credentialSecretId)?.name ??
                          repo.credentialSecretId)
                        : "none"}
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
