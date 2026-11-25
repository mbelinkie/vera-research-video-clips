import { delimiter, dirname, isAbsolute } from "node:path";

export function desktopToolSearchPath(
  executablePaths: string[],
  inheritedPath: string | undefined,
): string {
  const entries = [
    ...executablePaths.filter(isAbsolute).map(dirname),
    ...(inheritedPath?.split(delimiter) ?? []),
  ].filter(Boolean);
  return [...new Set(entries)].join(delimiter);
}
