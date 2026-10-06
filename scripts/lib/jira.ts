import type { Item, JiraInfo, Release } from '../../shared/types/snapshot.ts';
import { STATUS_CATEGORIES } from '../../shared/utils/snapshot.ts';

export interface JiraConfig {
  /** e.g. 'spacetoco.atlassian.net' */
  site: string;
  email: string;
  /** Scoped API token with read:jira-work. */
  token: string;
  projects: string[];
  /** Skips the tenant_info lookup when set. */
  cloudId?: string;
}

export interface JiraIssue {
  key: string;
  fields: Record<string, unknown> & {
    summary: string;
    status: { name: string, statusCategory: { key: string } };
    fixVersions: { name: string }[];
    assignee: { displayName: string } | null;
  };
}

interface JiraVersion {
  name: string;
  released: boolean;
  archived?: boolean;
  releaseDate?: string;
}

interface JiraSprint {
  name: string;
  state?: string;
  startDate?: string;
}

export interface JiraResult {
  releases: Release[];
  currentRelease: string | null;
  issues: Map<string, { summary: string, jira: JiraInfo }>;
  /** Keys asked for that Jira doesn't know (typos, wrong prefix, or no permission). */
  missingKeys: string[];
}

// ---------- pure helpers ----------

/** Active sprint, else the most recently started one. */
export const pickSprint = (sprints: JiraSprint[] | null | undefined): string | undefined => {
  if (!sprints?.length) return undefined;
  const active = sprints.find((s) => s.state?.toLowerCase() === 'active');
  if (active) return active.name;
  return [...sprints].sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''))[0]!.name;
};

export const mapIssue = (issue: JiraIssue, sprintFieldId?: string): { summary: string, jira: JiraInfo } => {
  const { fields } = issue;
  const category = fields.status.statusCategory.key;
  const sprint = sprintFieldId ? pickSprint(fields[sprintFieldId] as JiraSprint[] | null) : undefined;
  return {
    summary: fields.summary,
    jira: {
      status: fields.status.name,
      // Jira can report 'undefined' for a broken status; treat it as not started.
      statusCategory: (STATUS_CATEGORIES as readonly string[]).includes(category)
        ? category as JiraInfo['statusCategory']
        : 'new',
      fixVersions: fields.fixVersions.map((v) => v.name),
      ...(sprint && { sprint }),
      ...(fields.assignee && { assignee: fields.assignee.displayName }),
    },
  };
};

/** Versions across projects, de-duplicated by name, archived dropped, ordered by release date then name. */
export const toReleases = (versions: JiraVersion[]): Release[] => {
  const byName = new Map<string, Release>();
  for (const v of versions) {
    if (v.archived || byName.has(v.name)) continue;
    byName.set(v.name, {
      name: v.name,
      released: v.released,
      ...(v.releaseDate && { releaseDate: v.releaseDate }),
    });
  }
  return [...byName.values()].sort((a, b) => (
    (a.releaseDate ?? '9999').localeCompare(b.releaseDate ?? '9999')
    || a.name.localeCompare(b.name, undefined, { numeric: true })
  ));
};

/** Earliest unreleased version. */
export const currentReleaseOf = (releases: Release[]): string | null => releases.find((r) => !r.released)?.name ?? null;

/**
 * Fill in Jira data on items, flag keys Jira doesn't know, and add release tickets that aren't in the git window:
 * with empty presence (`addSyncedPresence` then fills in repos where they're already released).
 */
export const applyJira = (items: Item[], result: JiraResult): Item[] => {
  const missing = new Set(result.missingKeys);
  const enriched = items.map((item): Item => {
    if (item.kind !== 'ticket') return item;
    if (missing.has(item.id)) {
      return {
        ...item,
        invalidKey: true,
        warnings: [...new Set([...item.warnings, 'invalid-key' as const])],
      };
    }
    const issue = result.issues.get(item.id);
    return issue ? {
      ...item,
      title: issue.summary,
      jira: issue.jira,
    } : item;
  });

  const seen = new Set(items.map((i) => i.id));
  for (const [key, issue] of result.issues) {
    if (seen.has(key)) continue;
    enriched.push({
      id: key,
      kind: 'ticket',
      title: issue.summary,
      jira: issue.jira,
      prs: [],
      presence: {},
      hotfix: false,
      warnings: [],
    });
  }
  return enriched;
};

// ---------- API ----------

const FIELDS = ['summary', 'status', 'fixVersions', 'assignee'];
/** Read-only by design: the only POSTs allowed are Jira's read endpoints that take a body. */
const READ_ONLY_POSTS = ['/issue/bulkfetch', '/search/jql'];
const BULK_LIMIT = 100;

export const readJira = async (config: JiraConfig, keys: string[], fetchImpl: typeof fetch = fetch): Promise<JiraResult> => {
  const request = async <T>(url: string, init?: RequestInit): Promise<T> => {
    const method = init?.method ?? 'GET';
    if (method !== 'GET' && !(method === 'POST' && READ_ONLY_POSTS.some((p) => url.endsWith(p)))) {
      throw new Error(`Refusing Jira ${method} ${new URL(url).pathname}: this tool never writes to Jira.`);
    }
    const res = await fetchImpl(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${config.email}:${config.token}`).toString('base64')}`,
      },
    });
    if (!res.ok) throw new Error(`Jira ${method} ${new URL(url).pathname} failed: ${res.status} ${await res.text()}`);
    return res.json() as Promise<T>;
  };

  // Scoped tokens only work through the api.atlassian.com gateway, which needs the site's cloudId.
  const cloudId = config.cloudId ?? (await (await fetchImpl(`https://${config.site}/_edge/tenant_info`)).json() as { cloudId: string }).cloudId;
  const api = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3`;

  const fields = await request<{ id: string, schema?: { custom?: string } }[]>(`${api}/field`);
  const sprintFieldId = fields.find((f) => f.schema?.custom === 'com.pyxis.greenhopper.jira:gh-sprint')?.id;
  const issueFields = sprintFieldId ? [...FIELDS, sprintFieldId] : FIELDS;

  const versions = (await Promise.all(config.projects.map((p) => request<JiraVersion[]>(`${api}/project/${p}/versions`)))).flat();
  const releases = toReleases(versions);

  const issues = new Map<string, { summary: string, jira: JiraInfo }>();

  // Keys found in git. bulkfetch silently omits keys that don't exist, which is how invalid keys are found.
  const projectKeys = keys.filter((k) => config.projects.includes(k.split('-')[0]!));
  for (let i = 0; i < projectKeys.length; i += BULK_LIMIT) {
    const { issues: found } = await request<{ issues: JiraIssue[] }>(`${api}/issue/bulkfetch`, {
      method: 'POST',
      body: JSON.stringify({
        issueIdsOrKeys: projectKeys.slice(i, i + BULK_LIMIT),
        fields: issueFields,
      }),
    });
    for (const issue of found) issues.set(issue.key, mapIssue(issue, sprintFieldId));
  }
  // ponytail: an issue moved to another project comes back under its new key, so its old key reads as missing.
  // Map old → new via `expand: ['changelog']` if moved tickets turn up in practice.
  const missingKeys = projectKeys.filter((k) => !issues.has(k));

  // Tickets in any unreleased version, so future work shows up before it reaches a branch.
  let nextPageToken: string | undefined;
  do {
    const page = await request<{ issues: JiraIssue[], nextPageToken?: string }>(`${api}/search/jql`, {
      method: 'POST',
      body: JSON.stringify({
        jql: `project in (${config.projects.join(', ')}) AND fixVersion in unreleasedVersions()`,
        fields: issueFields,
        maxResults: 100,
        ...(nextPageToken && { nextPageToken }),
      }),
    });
    for (const issue of page.issues) issues.set(issue.key, mapIssue(issue, sprintFieldId));
    nextPageToken = page.nextPageToken ?? undefined;
  } while (nextPageToken);

  return {
    releases,
    currentRelease: currentReleaseOf(releases),
    issues,
    missingKeys,
  };
};
