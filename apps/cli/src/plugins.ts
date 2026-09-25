import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PLUGIN_API_VERSION, type BanglaClawPlugin } from "@banglaclaw/plugin-sdk";
import { ConfigError, type LoadedConfig } from "@banglaclaw/shared";

export interface LoadedPlugin {
  plugin: BanglaClawPlugin;
  specifier: string;
}

function resolveSpecifier(specifier: string, baseDir: string): string {
  if (specifier.startsWith(".") || isAbsolute(specifier)) {
    const path = resolve(baseDir, specifier);
    // A directory is loaded through its package.json "exports"/"main" (or index.js).
    const file = existsSync(join(path, "package.json")) ? createRequire(join(path, "package.json")).resolve(path) : path;
    return pathToFileURL(file).href;
  }
  // Installed package, resolved from the config file's directory.
  return pathToFileURL(createRequire(join(baseDir, "noop.js")).resolve(specifier)).href;
}

/**
 * Loads `plugins` from config (docs/23). Plugins run in-process with full privileges:
 * install only code you trust. Invalid plugins fail startup with a ConfigError.
 */
export async function loadPlugins(loaded: LoadedConfig): Promise<LoadedPlugin[]> {
  const out: LoadedPlugin[] = [];
  const names = new Set<string>();
  for (const specifier of loaded.config.plugins) {
    let mod: { default?: unknown };
    try {
      mod = (await import(resolveSpecifier(specifier, loaded.baseDir))) as { default?: unknown };
    } catch (error) {
      throw new ConfigError(`Cannot load plugin "${specifier}": ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    const plugin = mod.default as BanglaClawPlugin | undefined;
    if (plugin === undefined || typeof plugin !== "object" || typeof plugin.name !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(plugin.name)) {
      throw new ConfigError(`Plugin "${specifier}" must default-export definePlugin({ name, version, … })`);
    }
    if ((plugin.apiVersion ?? PLUGIN_API_VERSION) > PLUGIN_API_VERSION) {
      throw new ConfigError(`Plugin ${plugin.name} needs plugin API v${plugin.apiVersion}; this BanglaClaw supports v${PLUGIN_API_VERSION}`);
    }
    if (names.has(plugin.name)) throw new ConfigError(`Plugin ${plugin.name} is configured twice`);
    names.add(plugin.name);
    out.push({ plugin, specifier });
  }
  return out;
}
