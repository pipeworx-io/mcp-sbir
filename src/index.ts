interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * SBIR MCP — wraps the SBIR.gov public API (free, no auth)
 *
 * Tools:
 * - sbir_search_awards: search SBIR/STTR awards by keyword, agency, year, company, state
 * - sbir_get_award: get a single award by ID
 * - sbir_search_solicitations: search open SBIR/STTR solicitations
 * - sbir_company_awards: get all awards for a specific company
 * - sbir_agency_stats: get award counts by agency
 */


const BASE_URL = 'https://api.sbir.gov/public/api';
const UA = { 'User-Agent': 'Pipeworx/1.0 (gateway.pipeworx.io)' };

const MAJOR_AGENCIES = ['DOD', 'HHS', 'NASA', 'NSF', 'DOE', 'USDA'];

const tools: McpToolExport['tools'] = [
  {
    name: 'sbir_search_awards',
    description:
      'Search SBIR/STTR awards by keyword, agency, year, company, or state. Returns awards with company name, award amount, agency, topic, abstract, year, and phase.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        keyword: {
          type: 'string',
          description: 'Search term to match against award titles, abstracts, and topics',
        },
        agency: {
          type: 'string',
          description:
            'Filter by funding agency (e.g., "DOD", "HHS", "NASA", "NSF", "DOE", "USDA")',
        },
        year: {
          type: 'number',
          description: 'Filter by award year (e.g., 2024)',
        },
        company: {
          type: 'string',
          description: 'Filter by company name',
        },
        state: {
          type: 'string',
          description: 'Filter by 2-letter US state code (e.g., "CA", "MA")',
        },
        limit: {
          type: 'number',
          description: 'Number of results to return (default 20, max 100)',
        },
      },
      required: ['keyword'],
    },
  },
  {
    name: 'sbir_get_award',
    description:
      'Get details for a single SBIR/STTR award by its award ID. Returns full award information including company, amount, agency, abstract, and phase.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        award_id: {
          type: 'string',
          description: 'The unique award ID',
        },
      },
      required: ['award_id'],
    },
  },
  {
    name: 'sbir_search_solicitations',
    description:
      'Search SBIR/STTR solicitations (funding opportunities). Returns topics with description, agency, and open/close dates.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        keyword: {
          type: 'string',
          description: 'Search term to match against solicitation topics and descriptions',
        },
        agency: {
          type: 'string',
          description:
            'Filter by agency (e.g., "DOD", "HHS", "NASA", "NSF", "DOE", "USDA")',
        },
        open_only: {
          type: 'boolean',
          description: 'Only return currently open solicitations (default true)',
        },
        limit: {
          type: 'number',
          description: 'Number of results to return (default 20)',
        },
      },
      required: ['keyword'],
    },
  },
  {
    name: 'sbir_company_awards',
    description:
      'Get all SBIR/STTR awards for a specific company. Returns the full list of awards with amounts, agencies, topics, and phases.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        company: {
          type: 'string',
          description: 'Company name to search for',
        },
        limit: {
          type: 'number',
          description: 'Number of results to return (default 50)',
        },
      },
      required: ['company'],
    },
  },
  {
    name: 'sbir_agency_stats',
    description:
      'Get SBIR/STTR award counts by agency. If an agency is specified, returns the count for that agency. Otherwise returns counts for all major agencies (DOD, HHS, NASA, NSF, DOE, USDA).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agency: {
          type: 'string',
          description:
            'Specific agency to get count for (e.g., "DOD", "NASA"). Omit to get counts for all major agencies.',
        },
      },
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'sbir_search_awards':
      return searchAwards(
        args.keyword as string,
        args.agency as string | undefined,
        args.year as number | undefined,
        args.company as string | undefined,
        args.state as string | undefined,
        args.limit as number | undefined,
      );
    case 'sbir_get_award':
      return getAward(args.award_id as string);
    case 'sbir_search_solicitations':
      return searchSolicitations(
        args.keyword as string,
        args.agency as string | undefined,
        args.open_only as boolean | undefined,
        args.limit as number | undefined,
      );
    case 'sbir_company_awards':
      return companyAwards(args.company as string, args.limit as number | undefined);
    case 'sbir_agency_stats':
      return agencyStats(args.agency as string | undefined);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

interface SbirAward {
  company: string;
  award_amount: number | null;
  agency: string;
  branch: string | null;
  topic_code: string | null;
  award_title: string;
  abstract: string | null;
  award_year: number | string | null;
  phase: string | null;
  program: string | null;
  award_id: string | null;
  state: string | null;
  city: string | null;
}

function formatAward(a: Record<string, unknown>): SbirAward {
  return {
    company: (a.firm ?? a.company ?? '') as string,
    award_amount: (a.award_amount ?? a.awardAmount ?? null) as number | null,
    agency: (a.agency ?? '') as string,
    branch: (a.branch ?? null) as string | null,
    topic_code: (a.topic_code ?? a.topicCode ?? null) as string | null,
    award_title: (a.award_title ?? a.awardTitle ?? '') as string,
    abstract: (a.abstract ?? null) as string | null,
    award_year: (a.award_year ?? a.awardYear ?? null) as number | string | null,
    phase: (a.phase ?? null) as string | null,
    program: (a.program ?? null) as string | null,
    award_id: (a.award_id ?? a.awardId ?? null) as string | null,
    state: (a.state ?? null) as string | null,
    city: (a.city ?? null) as string | null,
  };
}

async function searchAwards(
  keyword: string,
  agency?: string,
  year?: number,
  company?: string,
  state?: string,
  limit?: number,
) {
  const rows = Math.min(limit ?? 20, 100);
  const params = new URLSearchParams({ keyword, rows: String(rows) });
  if (agency) params.set('agency', agency);
  if (year) params.set('year', String(year));
  if (company) params.set('company', company);
  if (state) params.set('state', state);

  const res = await fetch(`${BASE_URL}/awards.json?${params}`, { headers: UA });
  if (!res.ok) throw new Error(`SBIR API error: ${res.status} ${res.statusText}`);

  const data = (await res.json()) as Record<string, unknown>[];
  return {
    keyword,
    count: data.length,
    awards: data.map(formatAward),
  };
}

async function getAward(awardId: string) {
  const params = new URLSearchParams({ awardId });
  const res = await fetch(`${BASE_URL}/awards.json?${params}`, { headers: UA });
  if (!res.ok) throw new Error(`SBIR API error: ${res.status} ${res.statusText}`);

  const data = (await res.json()) as Record<string, unknown>[];
  if (!data || data.length === 0) {
    throw new Error(`Award not found: ${awardId}`);
  }

  return formatAward(data[0]);
}

async function searchSolicitations(
  keyword: string,
  agency?: string,
  openOnly?: boolean,
  limit?: number,
) {
  const rows = Math.min(limit ?? 20, 100);
  const params = new URLSearchParams({ keyword, rows: String(rows) });
  if (agency) params.set('agency', agency);
  if (openOnly !== false) params.set('open', '1');

  const res = await fetch(`${BASE_URL}/solicitations.json?${params}`, { headers: UA });
  if (!res.ok) throw new Error(`SBIR API error: ${res.status} ${res.statusText}`);

  const data = (await res.json()) as Record<string, unknown>[];
  return {
    keyword,
    open_only: openOnly !== false,
    count: data.length,
    solicitations: data.map((s) => ({
      topic_title: (s.topic_title ?? s.topicTitle ?? '') as string,
      description: (s.description ?? s.sbir_topic_description ?? null) as string | null,
      agency: (s.agency ?? '') as string,
      branch: (s.branch ?? null) as string | null,
      program: (s.program ?? null) as string | null,
      phase: (s.phase ?? null) as string | null,
      topic_number: (s.topic_number ?? s.topicNumber ?? null) as string | null,
      solicitation_id: (s.solicitation_id ?? s.solicitationId ?? null) as string | null,
      open_date: (s.open_date ?? s.openDate ?? null) as string | null,
      close_date: (s.close_date ?? s.closeDate ?? null) as string | null,
      url: (s.url ?? s.solicitation_url ?? null) as string | null,
    })),
  };
}

async function companyAwards(company: string, limit?: number) {
  const rows = Math.min(limit ?? 50, 100);
  const params = new URLSearchParams({ company, rows: String(rows) });

  const res = await fetch(`${BASE_URL}/awards.json?${params}`, { headers: UA });
  if (!res.ok) throw new Error(`SBIR API error: ${res.status} ${res.statusText}`);

  const data = (await res.json()) as Record<string, unknown>[];
  return {
    company,
    count: data.length,
    awards: data.map(formatAward),
  };
}

async function agencyStats(agency?: string) {
  if (agency) {
    const params = new URLSearchParams({ agency, rows: '0' });
    const res = await fetch(`${BASE_URL}/awards.json?${params}`, { headers: UA });
    if (!res.ok) throw new Error(`SBIR API error: ${res.status} ${res.statusText}`);

    const data = (await res.json()) as Record<string, unknown>[] | { numFound?: number };
    const count = Array.isArray(data) ? data.length : ((data.numFound ?? 0) as number);
    return { agency, award_count: count };
  }

  // Parallel calls for all major agencies
  const results = await Promise.all(
    MAJOR_AGENCIES.map(async (ag) => {
      const params = new URLSearchParams({ agency: ag, rows: '1' });
      const res = await fetch(`${BASE_URL}/awards.json?${params}`, { headers: UA });
      if (!res.ok) return { agency: ag, award_count: null, error: `HTTP ${res.status}` };

      const data = (await res.json()) as Record<string, unknown>[] | { numFound?: number };
      const count = Array.isArray(data) ? data.length : ((data.numFound ?? 0) as number);
      return { agency: ag, award_count: count };
    }),
  );

  return { agencies: results };
}

export default { tools, callTool, meter: { credits: 5 } } satisfies McpToolExport;
