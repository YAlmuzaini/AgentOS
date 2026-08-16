import type { FilesystemGrant, RepoAccess, RepoDto } from "@agentos/shared";
import { REPO_PERMISSIONS } from "@agentos/shared";
import { Plus, X } from "lucide-react";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/form";
import { Input, Select } from "../components/ui/form";
import { MicroLabel } from "../components/ui/panel";

/**
 * The two grants that are lists of objects rather than lists of ids.
 *
 * Both decide what a session can reach, so they are edited explicitly rather
 * than inferred: a repo carries a mount path and whether the agent may push,
 * and a folder grant carries read/write/delete separately. Getting either
 * wrong is the difference between an agent that can read a directory and one
 * that can empty it.
 */
export function RepoAccessField({
  value,
  repos,
  onChange,
}: {
  value: RepoAccess[];
  repos: RepoDto[];
  onChange: (next: RepoAccess[]) => void;
}): React.JSX.Element {
  const ungranted = repos.filter((repo) => !value.some((access) => access.repoId === repo.id));

  return (
    <div className="space-y-2">
      {value.length === 0 ? (
        <p className="text-xs text-ink-faint">
          No repositories. The agent cannot see any code, and its prompt will not mention one.
        </p>
      ) : null}

      {value.map((access, index) => {
        const repo = repos.find((candidate) => candidate.id === access.repoId);
        return (
          <div key={access.repoId} className="flex items-center gap-2 rounded-md border border-edge p-2">
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
              {repo?.name ?? access.repoId}
            </span>
            <Input
              className="machine w-40"
              value={access.mountPath}
              aria-label={`Mount path for ${repo?.name ?? "repo"}`}
              onChange={(event) =>
                onChange(
                  value.map((entry, i) =>
                    i === index ? { ...entry, mountPath: event.target.value } : entry,
                  ),
                )
              }
            />
            <Select
              className="w-32"
              value={access.permissions}
              aria-label={`Permissions for ${repo?.name ?? "repo"}`}
              onChange={(event) =>
                onChange(
                  value.map((entry, i) =>
                    i === index
                      ? { ...entry, permissions: event.target.value as RepoAccess["permissions"] }
                      : entry,
                  ),
                )
              }
            >
              {REPO_PERMISSIONS.map((permission) => (
                <option key={permission} value={permission}>
                  {permission}
                </option>
              ))}
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${repo?.name ?? "repo"}`}
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              <X />
            </Button>
          </div>
        );
      })}

      {ungranted.length > 0 ? (
        <Select
          value=""
          aria-label="Grant a repository"
          onChange={(event) => {
            const repo = repos.find((candidate) => candidate.id === event.target.value);
            if (repo) {
              onChange([
                ...value,
                { repoId: repo.id, mountPath: repo.mountPath, permissions: "git-read" },
              ]);
            }
          }}
        >
          <option value="">Grant a repository…</option>
          {ungranted.map((repo) => (
            <option key={repo.id} value={repo.id}>
              {repo.name}
            </option>
          ))}
        </Select>
      ) : null}
    </div>
  );
}

export function FilesystemGrantField({
  value,
  onChange,
}: {
  value: FilesystemGrant[];
  onChange: (next: FilesystemGrant[]) => void;
}): React.JSX.Element {
  const set = (index: number, patch: Partial<FilesystemGrant>): void =>
    onChange(value.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-faint">
        The agent's own <span className="machine">/agents/&lt;name&gt;/</span> folder is always
        readable and writable. Everything else has to be listed here.
      </p>

      {value.map((grant, index) => (
        <div key={index} className="space-y-2 rounded-md border border-edge p-2">
          <div className="flex items-center gap-2">
            <Input
              className="machine flex-1"
              value={grant.folderPath}
              placeholder="/shared/wiki/"
              aria-label="Folder path"
              onChange={(event) => set(index, { folderPath: event.target.value })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${grant.folderPath}`}
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              <X />
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {(["canRead", "canWrite", "canDelete"] as const).map((permission) => (
              <label key={permission} className="flex items-center gap-1.5 text-xs text-ink-muted">
                <Checkbox
                  checked={grant[permission]}
                  onCheckedChange={(checked) => set(index, { [permission]: checked === true })}
                />
                {permission.replace("can", "").toLowerCase()}
              </label>
            ))}
          </div>
        </div>
      ))}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() =>
          onChange([
            ...value,
            { folderPath: "/", canRead: true, canWrite: false, canDelete: false },
          ])
        }
      >
        <Plus />
        Add folder
      </Button>
    </div>
  );
}

/** A checkbox list for the grants that are simply sets of ids. */
export function IdListField({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ id: string; label: string }>;
  value: string[];
  onChange: (next: string[]) => void;
}): React.JSX.Element {
  if (options.length === 0) {
    return <p className="text-xs text-ink-faint">No {label} exist in this project yet.</p>;
  }
  return (
    <div className="space-y-1.5">
      <MicroLabel>{label}</MicroLabel>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {options.map((option) => (
          <label key={option.id} className="flex items-center gap-1.5 text-[13px] text-ink-muted">
            <Checkbox
              checked={value.includes(option.id)}
              onCheckedChange={(checked) =>
                onChange(
                  checked === true
                    ? [...value, option.id]
                    : value.filter((id) => id !== option.id),
                )
              }
            />
            {option.label}
          </label>
        ))}
      </div>
    </div>
  );
}
