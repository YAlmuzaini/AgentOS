import type { CreateRepoInput, RepoDto } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitBranch, Plus } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { CreatePanel } from "../components/ui/create-panel";
import { EmptyState, SkeletonRows } from "../components/ui/feedback";
import { Field, Input, Select } from "../components/ui/form";
import { Page, PageHeader } from "../components/ui/page";
import { Panel } from "../components/ui/panel";
import { StatusPill } from "../components/ui/pill";
import { Table, TableCard, TD, TH, THead, TR } from "../components/ui/table";
import { useActiveProject } from "../hooks/use-project";
import { NoProject } from "./tasks";

export function ReposPage(): React.JSX.Element {
  const { project } = useActiveProject();
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
  const [credentialSecretId, setCredentialSecretId] = useState("");

  if (!project) {
    return <NoProject />;
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

      <CreatePanel
        open={creating}
        onClose={() => setCreating(false)}
        title="New repo"
        description="Mounted into the session container; commits are the only thing that survives it."
        submitLabel="Create"
        pending={create.isPending}
        disabled={!name || !remoteUrl || !mountPath}
        error={create.isError ? "Could not create it." : null}
        onSubmit={() => {
          create.mutate({
            name,
            remoteUrl,
            mountPath,
            defaultBranch: defaultBranch || "main",
            credentialSecretId: credentialSecretId || null,
          });
          setName("");
          setRemoteUrl("");
          setMountPath("/repo");
          setDefaultBranch("main");
          setCredentialSecretId("");
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
          <Field label="Credential" className="sm:col-span-2">
            {(id) => (
              <Select
                id={id}
                value={credentialSecretId}
                onChange={(event) => setCredentialSecretId(event.target.value)}
              >
                <option value="">no credential…</option>
                {(secrets.data ?? []).map((secret) => (
                  <option key={secret.id} value={secret.id}>
                    {secret.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
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
                <TH>Credential</TH>
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
                    {repo.credentialSecretId
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
