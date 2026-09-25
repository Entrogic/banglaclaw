import { BanglaClawError, type AuditAction } from "@banglaclaw/shared";
import type { GlobalOptions } from "../bootstrap.js";
import { load, openPostgres } from "../bootstrap.js";
import { emit, empty, print, printAlways, success, warn } from "../ui/output.js";
import { withSpinner } from "../ui/spinner.js";
import { table } from "../ui/table.js";
import { c, statusCell, sym } from "../ui/theme.js";
import { limit, messageView, withAuth, withDesk, withPersistent } from "./shared.js";
import { printMessage } from "./session.js";

const actor = () => ({ actorId: "cli", actorName: process.env.USER ?? "cli" });

export async function keyCreate(options: GlobalOptions & { user: string; name: string; role?: string; scopes: string }): Promise<void> {
  if (options.role !== undefined && !["user", "operator", "admin"].includes(options.role)) throw new BanglaClawError("INVALID_ROLE", "--role must be user, operator or admin");
  const scopes = options.scopes.split(",").map((s) => s.trim()).filter((s) => s !== "");
  if (scopes.length === 0 || scopes.some((s) => s !== "read" && s !== "run")) throw new BanglaClawError("INVALID_SCOPES", "--scopes must be a comma-separated list of read, run");
  await withAuth(options, async (auth, services) => {
    const issued = await auth.issueKey(options.user, options.name, options.role as "user" | "operator" | "admin" | undefined, scopes as ("read" | "run")[]);
    await services.audit.record({ action: "key.created", outcome: "success", ...actor(), target: issued.key.id, metadata: { user: issued.user.name, role: issued.user.role, scopes: issued.key.scopes } });
    emit({ id: issued.key.id, name: issued.key.name, scopes: issued.key.scopes, user: issued.user.name, role: issued.user.role, token: issued.token }, () => {
      success(`Created key ${c.bold(issued.key.id)} "${issued.key.name}" [${issued.key.scopes.join(",")}] for ${issued.user.role} ${c.bold(issued.user.name)}`);
      printAlways(c.yellow("  Store this token now — it cannot be shown again:"));
      printAlways(`  ${issued.token}`);
    });
  });
}

export async function keyList(options: GlobalOptions & { user?: string }): Promise<void> {
  await withAuth(options, async (auth) => {
    const users = new Map((await auth.store.listUsers()).map((u) => [u.id, u]));
    let userId: string | undefined;
    if (options.user !== undefined) {
      userId = (await auth.store.findUserByName(options.user))?.id;
      if (userId === undefined) throw new BanglaClawError("USER_NOT_FOUND", `User not found: ${options.user}`);
    }
    // Never expose the stored hash.
    const keys = (await auth.store.listApiKeys(userId !== undefined ? { userId } : {})).map(({ hash: _hash, ...k }) => ({
      ...k,
      user: users.get(k.userId)?.name ?? k.userId,
      role: users.get(k.userId)?.role ?? "user",
      status: k.revokedAt !== undefined ? "revoked" : "active",
    }));
    emit(keys, (list) =>
      list.length === 0
        ? empty("No API keys.")
        : print(
            table(list, [
              { header: "KEY", value: (k) => k.id, color: (t) => c.bold(t) },
              { header: "STATUS", value: (k) => k.status, color: statusCell },
              { header: "USER", value: (k) => k.user },
              { header: "ROLE", value: (k) => k.role },
              { header: "NAME", value: (k) => k.name },
              { header: "SCOPES", value: (k) => k.scopes.join(",") },
              { header: "LAST USED", value: (k) => k.lastUsedAt?.toISOString() ?? "never", color: (t) => c.dim(t) },
            ]),
          ),
    );
  });
}

export async function keyRevoke(id: string, options: GlobalOptions): Promise<void> {
  await withAuth(options, async (auth, services) => {
    if (!(await auth.store.revokeApiKey(id))) throw new BanglaClawError("KEY_NOT_FOUND", `No active key with id ${id}`);
    await services.audit.record({ action: "key.revoked", outcome: "success", ...actor(), target: id });
    emit({ revoked: id }, () => success(`Revoked key ${id}`));
  });
}

export async function auditList(options: GlobalOptions & { action?: string; limit: string }): Promise<void> {
  await withPersistent(options, "The audit log", async (services) => {
    const events = await services.audit.list({ ...(options.action !== undefined && { action: options.action as AuditAction }), limit: limit(options.limit) });
    emit(events, (list) =>
      list.length === 0
        ? empty("No audit events.")
        : print(
            table(list, [
              { header: "TIME", value: (e) => e.at.toISOString(), color: (t) => c.dim(t) },
              { header: "ACTION", value: (e) => e.action, color: (t) => c.bold(t) },
              { header: "OUTCOME", value: (e) => e.outcome, color: statusCell },
              { header: "ACTOR", value: (e) => e.actorName ?? e.actorId ?? "-" },
              { header: "TARGET", value: (e) => e.target ?? "" },
              { header: "DETAILS", value: (e) => [e.ip, e.metadata !== undefined ? JSON.stringify(e.metadata) : ""].filter(Boolean).join(" "), color: (t) => c.dim(t), shrink: true },
            ]),
          ),
    );
  });
}

export async function handoffList(options: GlobalOptions): Promise<void> {
  await withDesk(options, async (desk, services) => {
    const queue = await Promise.all((await desk.queue()).map(async (s) => ({ ...s, messages: await services.sessions.countMessages(s.id) })));
    emit(queue, (list) =>
      list.length === 0
        ? empty("No conversations are waiting for a human.")
        : print(
            table(list, [
              { header: "SESSION", value: (s) => s.id, color: (t) => c.bold(t) },
              { header: "CHANNEL", value: (s) => s.channel },
              { header: "WAITING", value: (s) => (s.handoffAt !== undefined ? `${Math.round((Date.now() - s.handoffAt.getTime()) / 60_000)} min` : "?"), align: "right" },
              { header: "MSGS", value: (s) => String(s.messages), align: "right" },
              { header: "REASON", value: (s) => s.handoffReason ?? "", color: (t) => c.yellow(t), shrink: true },
            ]),
          ),
    );
  });
}

export async function handoffShow(id: string, options: GlobalOptions & { limit: string }): Promise<void> {
  await withDesk(options, async (desk) => {
    const { session, messages } = await desk.get(id, limit(options.limit));
    const views = messages.map(messageView);
    emit({ session, messages: views }, () => {
      print(`${c.bold(session.id)} ${c.dim(`${session.channel} · ${session.status}${session.handoffReason !== undefined ? ` · ${session.handoffReason}` : ""}`)}`);
      print();
      for (const m of views) if (m.role !== "tool") printMessage(m);
    });
  });
}

export async function handoffReply(id: string, text: string, options: GlobalOptions & { as: string }): Promise<void> {
  await withDesk(options, async (desk) => {
    const result = await desk.reply(id, options.as, text);
    emit(result, (r) => (r.delivered ? success("Sent to the user and stored") : warn("Stored in the session; the channel could not deliver it (API clients read it from the messages endpoint)")));
  });
}

export async function handoffRelease(id: string, options: GlobalOptions & { as: string }): Promise<void> {
  await withDesk(options, async (desk) => {
    const session = await desk.release(id, options.as);
    emit({ session }, () => success(`Session ${id} is back with the bot`));
  });
}

export async function dbMigrate(options: GlobalOptions): Promise<void> {
  const postgres = openPostgres(load(options));
  try {
    const status = await withSpinner("Applying migrations…", async () => {
      await postgres.migrate();
      return postgres.migrationStatus();
    });
    emit(status, (s) => success(`Database migrated (${s.applied}/${s.available} migrations, checkpoint tables ready)`));
  } finally {
    await postgres.close();
  }
}

export async function dbStatus(options: GlobalOptions): Promise<void> {
  const postgres = openPostgres(load(options));
  try {
    await postgres.ping();
    const { applied, available } = await postgres.migrationStatus();
    const upToDate = applied >= available;
    emit({ applied, available, upToDate }, () =>
      print(`${upToDate ? c.green(sym.ok) : c.yellow(sym.warn)} ${applied}/${available} migrations applied${upToDate ? "" : c.dim(" — run `banglaclaw db migrate`")}`),
    );
    if (!upToDate) process.exitCode = 1;
  } finally {
    await postgres.close();
  }
}
