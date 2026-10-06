// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Item } from '../../shared/types/snapshot';
import { applyJira, currentReleaseOf, mapIssue, pickSprint, readJira, toReleases, type JiraIssue } from './jira';

// Made-up data in the shape of Jira Cloud v3 responses.
const issue = (key: string, over: Partial<JiraIssue['fields']> = {}): JiraIssue => ({
  key,
  fields: {
    summary: `Summary of ${key}`,
    status: {
      name: 'In QA',
      statusCategory: { key: 'indeterminate' },
    },
    fixVersions: [{ name: '2.0.0' }],
    assignee: { displayName: 'Alex Example' },
    customfield_10020: [
      {
        name: 'Sprint 1',
        state: 'closed',
        startDate: '2026-09-01',
      },
      {
        name: 'Sprint 2',
        state: 'active',
        startDate: '2026-09-15',
      },
    ],
    ...over,
  },
});

const gitItem = (id: string, kind: Item['kind'] = 'ticket'): Item => ({
  id,
  kind,
  title: 'from git',
  prs: [],
  presence: { app: { develop: 'merged' } },
  hotfix: false,
  warnings: kind === 'untracked' ? ['untracked'] : [],
});

describe('pickSprint', () => {
  it('prefers the active sprint, else the latest started, case-insensitively', () => {
    expect(pickSprint([{
      name: 'A',
      state: 'CLOSED',
      startDate: '2026-01-01',
    }, {
      name: 'B',
      state: 'ACTIVE',
    }])).toBe('B');
    expect(pickSprint([{
      name: 'A',
      state: 'closed',
      startDate: '2026-01-01',
    }, {
      name: 'B',
      state: 'closed',
      startDate: '2026-02-01',
    }]))
      .toBe('B');
    expect(pickSprint(null)).toBeUndefined();
  });
});

describe('mapIssue', () => {
  it('maps the fields the dashboard uses', () => {
    expect(mapIssue(issue('DEV-1'), 'customfield_10020')).toEqual({
      summary: 'Summary of DEV-1',
      jira: {
        status: 'In QA',
        statusCategory: 'indeterminate',
        fixVersions: ['2.0.0'],
        sprint: 'Sprint 2',
        assignee: 'Alex Example',
      },
    });
  });

  it('omits sprint and assignee when absent, and treats an unknown status category as new', () => {
    const { jira } = mapIssue(issue('DEV-1', {
      assignee: null,
      status: {
        name: 'Odd',
        statusCategory: { key: 'undefined' },
      },
    }));
    expect(jira).toEqual({
      status: 'Odd',
      statusCategory: 'new',
      fixVersions: ['2.0.0'],
    });
  });
});

describe('releases', () => {
  const releases = toReleases([
    {
      name: '2.1.0',
      released: false,
      releaseDate: '2026-11-01',
    },
    {
      name: '1.9.0',
      released: true,
      releaseDate: '2026-09-01',
    },
    {
      name: '2.0.0',
      released: false,
      releaseDate: '2026-10-15',
    },
    {
      name: '2.0.0',
      released: false,
      releaseDate: '2026-10-15',
    }, // same version in the BUG project
    {
      name: 'Backlog',
      released: false,
    },
    {
      name: '1.0.0',
      released: true,
      archived: true,
    },
  ]);

  it('dedupes by name, drops archived, orders by date then name', () => {
    expect(releases.map((r) => r.name)).toEqual(['1.9.0', '2.0.0', '2.1.0', 'Backlog']);
  });

  it('picks the earliest unreleased version as current', () => {
    expect(currentReleaseOf(releases)).toBe('2.0.0');
    expect(currentReleaseOf([])).toBeNull();
  });
});

describe('applyJira', () => {
  const result = {
    releases: [],
    currentRelease: null,
    issues: new Map([
      ['DEV-1', mapIssue(issue('DEV-1'))],
      ['DEV-9', mapIssue(issue('DEV-9', {
        status: {
          name: 'To Do',
          statusCategory: { key: 'new' },
        },
      }))],
    ]),
    missingKeys: ['DEV-404'],
  };
  const items = applyJira([gitItem('DEV-1'), gitItem('DEV-404'), gitItem('pr-7', 'untracked')], result);
  const byId = new Map(items.map((i) => [i.id, i]));

  it('takes the title and Jira data for known tickets', () => {
    expect(byId.get('DEV-1')!.title).toBe('Summary of DEV-1');
    expect(byId.get('DEV-1')!.jira?.status).toBe('In QA');
  });

  it('flags keys Jira does not know', () => {
    expect(byId.get('DEV-404')!.invalidKey).toBe(true);
    expect(byId.get('DEV-404')!.warnings).toEqual(['invalid-key']);
  });

  it('leaves untracked items alone', () => {
    expect(byId.get('pr-7')!.jira).toBeUndefined();
  });

  it('adds release tickets that are on no branch yet', () => {
    const added = byId.get('DEV-9')!;
    expect(added.presence).toEqual({});
    expect(added.prs).toEqual([]);
  });
});

describe('readJira', () => {
  it('calls the api.atlassian.com gateway and finds unknown keys from what bulkfetch leaves out', async () => {
    const calls: { url: string, body?: unknown }[] = [];
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
    const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (url.endsWith('/_edge/tenant_info')) return json({ cloudId: 'cloud-1' });
      if (url.endsWith('/field')) return json([{
        id: 'customfield_10020',
        schema: { custom: 'com.pyxis.greenhopper.jira:gh-sprint' },
      }]);
      if (url.endsWith('/project/DEV/versions')) return json([{
        name: '2.0.0',
        released: false,
        releaseDate: '2026-10-15',
      }]);
      if (url.endsWith('/project/BUG/versions')) return json([{
        name: '1.9.0',
        released: true,
        releaseDate: '2026-09-01',
      }]);
      if (url.endsWith('/issue/bulkfetch')) return json({
        issues: [issue('DEV-1')],
        issueErrors: [],
      });
      if (url.endsWith('/search/jql')) {
        const token = (calls.at(-1)!.body as { nextPageToken?: string }).nextPageToken;
        return json(token ? {
          issues: [issue('BUG-3')],
          isLast: true,
        } : {
          issues: [issue('DEV-2')],
          nextPageToken: 'p2',
        });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    const result = await readJira({
      site: 'example.atlassian.net',
      email: 'a@example.com',
      token: 't',
      projects: ['DEV', 'BUG'],
    }, ['DEV-1', 'DEV-404', 'EC-5'], fakeFetch);

    expect(calls.filter((c) => c.url.includes('/rest/api/3/')).every((c) => c.url.startsWith('https://api.atlassian.com/ex/jira/cloud-1/'))).toBe(true);
    expect(calls.find((c) => c.url.endsWith('/issue/bulkfetch'))!.body).toMatchObject({ issueIdsOrKeys: ['DEV-1', 'DEV-404'] });
    expect(result.missingKeys).toEqual(['DEV-404']);
    expect([...result.issues.keys()].sort()).toEqual(['BUG-3', 'DEV-1', 'DEV-2']);
    expect(result.issues.get('DEV-1')!.jira.sprint).toBe('Sprint 2');
    expect(result.currentRelease).toBe('2.0.0');
  });

  it('throws with the status when Jira refuses', async () => {
    const fakeFetch = (async (input: string | URL) => (String(input).endsWith('tenant_info')
      ? new Response(JSON.stringify({ cloudId: 'c' }))
      : new Response('Unauthorized', { status: 401 }))) as typeof fetch;
    await expect(readJira({
      site: 's',
      email: 'e',
      token: 't',
      projects: ['DEV'],
    }, [], fakeFetch)).rejects.toThrow('401');
  });
});
