import { execFileSync } from "node:child_process";
import { lstatSync } from "node:fs";

const aclPrelude = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$path = $env:MEDOTA2_PRIVATE_PATH
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
`;

function windowsAcl(path: string, script: string): void {
  try {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(
          aclPrelude +
            "\ntry {\n" +
            script +
            "\n} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }",
          "utf16le",
        ).toString("base64"),
      ],
      {
        env: { ...process.env, MEDOTA2_PRIVATE_PATH: path },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 15_000,
      },
    );
  } catch (error) {
    const detail = (error as { stderr?: Buffer }).stderr
      ?.toString("utf8")
      .trim();
    throw new Error(
      `Windows private-file ACL check failed for ${path}: ${detail || "unable to inspect permissions"}`,
    );
  }
}

/** Windows has no POSIX 0600: protect the parent before writing private bytes. */
export function protectPrivateDirectory(path: string): void {
  const metadata = lstatSync(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    throw new Error("Private state must use a real directory.");
  if (process.platform !== "win32") return;
  windowsAcl(
    path,
    `
if ([IO.File]::GetAttributes($path) -band [IO.FileAttributes]::ReparsePoint) { throw 'Private directory is a reparse point.' }
$existing = [IO.Directory]::GetAccessControl($path)
if ($existing.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'Private directory is not owned by the current user.' }
# Reapplying an identical inheritable DACL propagates through the entire state tree.
# Inspect on every call, but avoid that expensive write when it is already protected.
$rules = @($existing.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
if ($existing.AreAccessRulesProtected -and $rules.Count -eq 1) {
  $current = $rules[0]
  if ($current.IdentityReference.Value -eq $sid.Value -and
      $current.AccessControlType -eq 'Allow' -and
      $current.FileSystemRights -eq [Security.AccessControl.FileSystemRights]::FullControl -and
      $current.InheritanceFlags -eq ([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit) -and
      $current.PropagationFlags -eq [Security.AccessControl.PropagationFlags]::None -and
      -not $current.IsInherited) { return }
}
$acl = New-Object Security.AccessControl.DirectorySecurity
# The owner was verified above. Only change the DACL: an owner can do that
# without WRITE_OWNER, which inherited Modify permissions do not include.
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')
$acl.AddAccessRule($rule)
[IO.Directory]::SetAccessControl($path, $acl)
`,
  );
}

export function assertPrivateRegularFile(path: string): void {
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw new Error("Private receipt must be a regular file.");
  if (process.platform !== "win32") {
    if (
      (metadata.mode & 0o777) !== 0o600 ||
      (typeof process.getuid === "function" &&
        metadata.uid !== process.getuid())
    )
      throw new Error(
        "Private receipt must be a 0600 file owned by the current user.",
      );
    return;
  }
  // Read the actual DACL on every admission; do not cache permission decisions.
  windowsAcl(
    path,
    `
foreach ($target in @($path, [IO.Path]::GetDirectoryName($path))) {
  $attributes = [IO.File]::GetAttributes($target)
  if ($attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Private path is a reparse point.' }
  $acl = if ($attributes -band [IO.FileAttributes]::Directory) { [IO.Directory]::GetAccessControl($target) } else { [IO.File]::GetAccessControl($target) }
  if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'Private path is not owned by the current user.' }
  $hasOwner = $false
  foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -ne 'Allow') { continue }
    $identity = $rule.IdentityReference.Value
    if ($identity -notin @($sid.Value, 'S-1-5-18', 'S-1-5-32-544')) { throw 'Private path grants access to another principal.' }
    if ($identity -eq $sid.Value -and ($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::ReadAndExecute)) { $hasOwner = $true }
  }
  if (-not $hasOwner) { throw 'Private path does not grant owner access.' }
}
`,
  );
}
