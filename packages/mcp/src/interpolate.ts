import { ConfigError } from "@banglaclaw/shared";

const VAR = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Expands `${VAR}` references so secrets for MCP servers stay in the environment, not the config file. */
export function interpolate(value: string, env: NodeJS.ProcessEnv, where: string): string {
  return value.replace(VAR, (_match, name: string) => {
    const resolved = env[name];
    if (resolved === undefined || resolved === "") {
      throw new ConfigError(`${where} references \${${name}}, which is not set`);
    }
    return resolved;
  });
}

export function interpolateMap(values: Record<string, string>, env: NodeJS.ProcessEnv, where: string): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, interpolate(v, env, `${where}.${k}`)]));
}
