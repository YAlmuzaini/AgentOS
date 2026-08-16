import type { FilesystemGrant, RepoAccess, RepoDto } from "@agentos/shared";
import { REPO_PERMISSIONS } from "@agentos/shared";
import { Plus, ShieldCheck, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/form";
import { Input, Select } from "../components/ui/form";
import { Well } from "../components/ui/panel";

/**
 * What an empty grant list means.
 *
 * Least privilege with default deny is the first non-negotiable property in
 * PRODUCT.md, and an empty list is the state where it is holding — so it gets a
 * sentence rather than a blank box. "No repositories." reads as a gap in the
 * form; "this agent cannot see any code" reads as the answer.
 */
export function DenyNote({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <Well className="flex items-start gap-2 px-3 py-2">
      <ShieldCheck aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ink-faint" />
      <span className="text-xs leading-relaxed text-ink-muted">{children}</span>
    </Well>
  );
}

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
        <DenyNote>
          {repos.length === 0
            ? "This project has no repositories yet. Add one under Repositories, then grant it here."
            : "No repository access assigned."}
        </DenyNote>
      ) : null}

      {value.map((access, index) => {
        const repo = repos.find((candidate) => candidate.id === access.repoId);
        return (
          // `rounded-md` was a third radius. Two only: 8px controls, 10px panels.
          // Two rows rather than one, matching the filesystem grant beside it:
          // the name and the remove on top, the two things that decide what the
          // grant actually permits underneath. On one row the mount path and
          // the permission select ran out of the 32rem drawer at phone width.
          <div key={access.repoId} className="space-y-2 rounded-control border border-edge p-2">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                {repo?.name ?? access.repoId}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                title={`Remove ${repo?.name ?? "repo"}`}
                aria-label={`Remove ${repo?.name ?? "repo"}`}
                onClick={() => onChange(value.filter((_, i) => i !== index))}
              >
                <X />
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="machine min-w-0 flex-1"
                value={access.mountPath}
                placeholder="/workspace/repo"
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
                className="w-36"
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
            </div>
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
      {value.length === 0 ? (
        <DenyNote>
          Access is limited to <span className="machine">/agents/&lt;name&gt;/</span>. All other
          filesystem access is denied.
        </DenyNote>
      ) : (
        <p className="text-xs leading-relaxed text-ink-faint">
          <span className="machine">/agents/&lt;name&gt;/</span> is always available. Add any other
          required folders below.
        </p>
      )}

      {value.map((grant, index) => (
        // `rounded-md` was a third radius. Two only: 8px controls, 10px panels.
        <div key={index} className="space-y-2 rounded-control border border-edge p-2">
          <div className="flex items-center gap-2">
            <Input
              className="machine min-w-0 flex-1"
              value={grant.folderPath}
              placeholder="/shared/wiki/"
              aria-label="Folder path"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => set(index, { folderPath: event.target.value })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title={`Remove ${grant.folderPath || "this folder"}`}
              aria-label={`Remove ${grant.folderPath || "this folder"}`}
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              <X />
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {(["canRead", "canWrite", "canDelete"] as const).map((permission) => (
              <label
                key={permission}
                className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-muted transition-colors hover:text-ink"
              >
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

/**
 * A checkbox list for the grants that are simply sets of ids.
 *
 * The heading is the caller's, not this component's: each of these now sits
 * under a section that already names the wall and says what it controls, and
 * the field printing its own caption underneath repeated the same word twice.
 */
export function IdListField({
  label,
  options,
  value,
  onChange,
  none,
  empty,
}: {
  label: string;
  options: Array<{ id: string; label: string }>;
  value: string[];
  onChange: (next: string[]) => void;
  /** What granting nothing means — the default-deny state, said out loud. */
  none: ReactNode;
  /** What to say when the project has nothing to grant yet. */
  empty: ReactNode;
}): React.JSX.Element {
  if (options.length === 0) {
    return <DenyNote>{empty}</DenyNote>;
  }
  return (
    <div className="space-y-2">
      <div role="group" aria-label={label} className="flex flex-wrap gap-x-4 gap-y-2">
        {options.map((option) => (
          <label
            key={option.id}
            className="flex cursor-pointer items-center gap-1.5 text-[13px] text-ink-muted transition-colors hover:text-ink"
          >
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
      {value.length === 0 ? <DenyNote>{none}</DenyNote> : null}
    </div>
  );
}
