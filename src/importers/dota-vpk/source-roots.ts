import { resolve } from "node:path";

// Readers still verify the pinned commit and recorded file hashes at each root.
// A newly imported local snapshot can coexist with an older applied data bundle.
export function pinnedVpkRoots(commit: string): string[] {
  if (!/^[a-f0-9]{40}$/u.test(commit)) return [];
  return [
    ...new Set(
      [
        resolve(
          process.env.DOTA_VPK_WORKTREE_ROOT || ".medota2/cache/worktrees",
          commit,
        ),
        resolve(".medota2/cache/worktrees", commit),
        process.env.DOTA_VPK_UPDATES_PATH,
      ].filter((root): root is string => Boolean(root)),
    ),
  ];
}
