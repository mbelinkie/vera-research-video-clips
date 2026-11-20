/**
 * Per-user LaunchAgents for the Mac pilot (#53). No root, no system daemons.
 *
 * Secrets never appear in a plist: every job receives only the path of the
 * private env file and reads credentials from it at start. launchd restarts
 * the API and tunnel after a crash and on login; backups and restore drills
 * run on a calendar at reduced CPU and I/O priority.
 */
export const LABEL_PREFIX = "com.vera-research.pilot";
export type PilotJob = "api" | "tunnel" | "backup" | "drill";
export const PILOT_JOBS: readonly PilotJob[] = [
  "api",
  "tunnel",
  "backup",
  "drill",
];
export const labelFor = (job: PilotJob) => `${LABEL_PREFIX}.${job}`;

export type LaunchdSettings = {
  nodePath: string;
  repoRoot: string;
  envFile: string;
  logDir: string;
  /** PATH for jobs; must include PostgreSQL client tools and cloudflared. */
  path: string;
  cloudflaredPath: string;
  tunnelConfig: string;
  backupHour: number;
  drillWeekday: number;
};

const escapeXml = (value: string) =>
  value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");

function assertSafe(settings: LaunchdSettings): void {
  for (const [name, value] of Object.entries(settings))
    if (typeof value === "string" && (!value || /[\0\n\r]/u.test(value)))
      throw new Error(`Invalid launchd setting ${name}`);
  for (const name of [
    "nodePath",
    "repoRoot",
    "envFile",
    "logDir",
    "cloudflaredPath",
    "tunnelConfig",
  ] as const)
    if (!settings[name].startsWith("/"))
      throw new Error(`launchd setting ${name} must be an absolute path`);
  if (
    !Number.isInteger(settings.backupHour) ||
    settings.backupHour < 0 ||
    settings.backupHour > 23
  )
    throw new Error("Backup hour must be 0-23");
  if (
    !Number.isInteger(settings.drillWeekday) ||
    settings.drillWeekday < 0 ||
    settings.drillWeekday > 6
  )
    throw new Error("Drill weekday must be 0-6 (Sunday = 0)");
}

const array = (values: string[]) =>
  `<array>${values.map((v) => `<string>${escapeXml(v)}</string>`).join("")}</array>`;

export function renderPlist(job: PilotJob, settings: LaunchdSettings): string {
  assertSafe(settings);
  const host = (command: string) => [
    settings.nodePath,
    "--import",
    "tsx",
    `${settings.repoRoot}/scripts/pilot-host/cli.ts`,
    command,
  ];
  const program =
    job === "tunnel"
      ? [
          settings.cloudflaredPath,
          "tunnel",
          "--no-autoupdate",
          "--config",
          settings.tunnelConfig,
          "run",
        ]
      : host(job === "api" ? "run-api" : job);
  const always = job === "api" || job === "tunnel";
  const schedule =
    job === "backup"
      ? `<key>StartCalendarInterval</key><dict><key>Hour</key><integer>${settings.backupHour}</integer><key>Minute</key><integer>15</integer></dict>`
      : job === "drill"
        ? `<key>StartCalendarInterval</key><dict><key>Weekday</key><integer>${settings.drillWeekday}</integer><key>Hour</key><integer>${(settings.backupHour + 1) % 24}</integer><key>Minute</key><integer>15</integer></dict>`
        : "";
  // The API and backup jobs rotate their own logs; launchd only captures
  // early crashes. cloudflared logs are small and rotated by `pilot status`.
  const log = `${settings.logDir}/${job}.launchd.log`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
<key>Label</key><string>${labelFor(job)}</string>
<key>ProgramArguments</key>${array(program)}
<key>WorkingDirectory</key><string>${escapeXml(settings.repoRoot)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${escapeXml(settings.path)}</string><key>PILOT_ENV_FILE</key><string>${escapeXml(settings.envFile)}</string></dict>
<key>StandardOutPath</key><string>${escapeXml(log)}</string>
<key>StandardErrorPath</key><string>${escapeXml(log)}</string>
<key>Umask</key><integer>63</integer>
${
  always
    ? "<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>15</integer><key>ExitTimeOut</key><integer>40</integer><key>ProcessType</key><string>Standard</string>"
    : `<key>RunAtLoad</key><false/>${schedule}<key>Nice</key><integer>10</integer><key>LowPriorityIO</key><true/><key>ProcessType</key><string>Background</string>`
}
</dict>
</plist>
`;
}
