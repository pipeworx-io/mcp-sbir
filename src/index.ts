interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Was this failure OUR OWN web service? — the other half of `internal-db-class.ts`.
 *
 * fleet #1089 pulled failures from our own Postgres out of `upstream_down` by
 * keying on the SQLSTATE inside PostgREST's four-key error envelope. That
 * covered the majority and structurally could not cover the rest: the rest
 * never reach Postgres, so they carry no SQLSTATE. What was left, measured over
 * the 24h to 2026-09-02T15:00Z (fleet #1096):
 *
 *     5  pipeworx-catalog  get_pack_tools     Pipeworx catalog error: 522 — error code: 522
 *     3  fleet             fleet_list_open …  upstream_down: Fleet task queue did not respond within 25s
 *
 * 521/522/523/526 are Cloudflare saying its edge could not reach an ORIGIN, and
 * in both of those rows the origin is ours — `gateway.pipeworx.io` for the
 * catalog pack (it self-fetches when the gateway hasn't injected a manifest),
 * our own Supabase for fleet. There is no third party anywhere in either call.
 * Same defect as #1089: our own outage filed under `upstream_down`, the one
 * class that means "the source is unreachable and there is nothing for us to
 * fix", which is why the problem-tools triage skips it.
 *
 * WHY NOT A WORDING RULE. The obvious fix is to match `fleet db error:` and
 * `Pipeworx catalog error:` in classifyToolError. Each is emitted from exactly
 * one site today, so it would work today. It would also rot the first time
 * somebody rewords a label — silently, and in the direction of hiding our own
 * outage, which is worse than the bug being fixed. Every prose rule in
 * error-class.ts has needed widening as packs invented new wording (#409/#450/
 * #584); that history is most of that file's comment budget.
 *
 * WHAT THIS KEYS ON INSTEAD: **the host the call actually reached.** A URL's
 * hostname is a fact about the call, not a guess about its prose. Two
 * consequences that a pack-level flag could not give us, and the reason the
 * flag was rejected:
 *
 *   - It describes the CALL, not the pack. `govcon-intel` fans out to our own
 *     Supabase AND to genuine third parties; `court-listener` holds our cache
 *     in Supabase and fetches courtlistener.com. An `internallyHosted: true` on
 *     either pack would relabel a real third-party outage as ours — inventing
 *     work, which is the same class of error in the opposite direction.
 *   - It covers every future internal pack for free, instead of one declared
 *     slug at a time.
 *
 * WHY IT SURVIVES A REWORD. The marker below is not matched as a literal by two
 * separate files. `markInternalOrigin()` writes it and `internalHostMetricsClass()`
 * reads it, both from the single exported `INTERNAL_ORIGIN_MARKER` constant in
 * this module — so changing the wording changes both sides in the same edit and
 * cannot desynchronise them. The pack's own label (`fleet db error:`,
 * `Pipeworx catalog error:`) is not read at all: reword it freely, the class is
 * unaffected. That is the property `stripClassPrefix` lacked when it drifted
 * from its own classifier three times and needed a CI gate to hold them
 * together.
 *
 * WHERE THE 5xx TEST LIVES. `markInternalOrigin` is called from the places that
 * hold the real `Response` — `httpError`/`httpErrorMessage` and the timeout
 * branch of `fetchWithTimeout` in `shared/src/http.ts` — so "is this an
 * availability failure" is decided from the actual status code, never re-derived
 * by scraping a number out of a sentence. A 404 from our own registry for a slug
 * that does not exist is a caller's bad argument and is deliberately NOT marked.
 */

/**
 * OUR OWN web service was unreachable — not an upstream, and never `upstream_down`.
 *
 * ONE value, not three, unlike `internal_db_*`. That split existed because a
 * slow query, an exhausted pool and an unknown SQLSTATE have different owners
 * and different fixes. Here there is only one story to tell — an origin we run
 * did not answer the edge — and one owner. A bucket with no distinct owner per
 * value is decoration; #724 is what happens when a class holds several
 * situations, and inventing sub-values ahead of a reason to act on them
 * differently is the same mistake with the sign flipped.
 *
 * METRICS ONLY, exactly like PLATFORM_KEY_ERROR_CLASS and the internal_db
 * values. `classifyToolError` still answers `upstream_down` for the retry and
 * hint paths, which only care whether retrying or a sibling tool might work —
 * and it might. Nothing a caller sees or is charged changes here.
 *
 * READ SIDE: this value is in BROKEN_TOOL_CLASSES, FAULT_CLASSES and
 * ALL_ERROR_CLASSES in `workers/registry-api/src/index.ts`. All three, or it
 * lands on no dashboard — fleet #721 is the warning, where the #719 split
 * worked on the write side and was invisible for weeks.
 */
const INTERNAL_SERVICE_UNREACHABLE_CLASS = 'internal_service_unreachable';

/**
 * The token that carries "this origin is ours" from the call site to the
 * classifier.
 *
 * Appended to the error message rather than attached to the Error object,
 * because the object does not survive the trip: 275 packs return `{ error:
 * string }` instead of throwing, the gateway reads `observedError` as a string,
 * and the fleet pack rebuilds its error from a captured status + body across a
 * retry loop. A property on an Error would be dropped by every one of those
 * paths and the class would work in tests and vanish in production.
 *
 * WORDING IS LOAD-BEARING, same rule as labelAge's note in authority.ts. This
 * string is appended to a pack's thrown Error message (shared/src/http.ts),
 * and a thrown Error's message is exactly what the gateway hands back to the
 * caller as `content[0].text` when nothing rewrites it (workers/gateway/src
 * catches the throw and sets `rawResult.message = stripClassPrefix(error)`,
 * which does not touch this suffix) — so the original wording,
 * " [pipeworx-hosted origin — our own service, not a third party]", was not a
 * theoretical leak: it shipped live on pipeworx-catalog's 522s, 7 times in 6
 * hours on 2026-09-02 (see tests/golden-internal-service.test.ts), verbatim
 * naming Pipeworx as the host. check:hosting-claims never caught it because it
 * did not scan shared/ at all (task #2009). Reworded to describe the
 * OBSERVATION (the origin did not answer) without a claim about who runs it —
 * the identical fix labelAge got: drop the possessive, keep the fact.
 */
const INTERNAL_ORIGIN_MARKER = ' [origin did not respond — retry before concluding the named source is down]';

/**
 * Supabase's data plane for a project is `<ref>.supabase.co`, where the ref is
 * exactly twenty lowercase letters (ours is `pqauisounztsgdgfkhke`).
 *
 * Matching the shape rather than listing the ref keeps this correct when we add
 * a project — `supabaseEnv` on a pack entry already points some packs at a
 * second one — while still excluding `status.supabase.co`, which is Supabase's
 * own status page and emphatically not our database. Verified 2026-09-02 by
 * `grep -rhoE '[a-z0-9-]+\.supabase\.(co|in)' mcps shared workers scripts`: the
 * only real project ref anywhere in the tree is ours, the rest are doc
 * placeholders (`abc`, `xyz`, `example`) which this pattern also excludes. Same
 * finding internal-db-class.ts relies on for the PostgREST envelope being ours
 * by construction.
 */
const SUPABASE_PROJECT_HOST = /^[a-z]{20}\.supabase\.(co|in)$/;

/**
 * Is this a host WE run?
 *
 * Deliberately NOT including `*.workers.dev`: plenty of third-party APIs are
 * hosted on workers.dev, so the suffix says where something runs and not who
 * owns it. Every internal call we actually make goes to a `pipeworx.io`
 * hostname or to our Supabase project, both of which are ownership facts.
 *
 * `workers/gateway/src/provenance.ts`'s `OUR_HOSTS` answers the same
 * question and DOES include `workers.dev` — a documented divergence
 * (task #2051), not a bug to converge. That list decides what a response may
 * cite as a data SOURCE, where a false negative (citing our own worker as an
 * external source) is the hosting-disclosure leak this whole file exists to
 * prevent, so it errs broad. This one decides who gets BLAMED for a 5xx in
 * outage metrics read by on-call, where a false positive (crediting our own
 * infra with a third party's outage) hides the real failure, so it errs
 * narrow. Same suffix, opposite direction, because they are never called for
 * the same reason.
 *
 * Returns false on anything unparseable rather than throwing — this runs inside
 * an error path, and an error path that can itself throw turns a diagnosable
 * failure into a mystery.
 */
function isPipeworxOrigin(url: string | URL | undefined | null): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url instanceof URL ? url.href : url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'pipeworx.io' || host.endsWith('.pipeworx.io')) return true;
  return SUPABASE_PROJECT_HOST.test(host);
}

/**
 * Append the marker when this failure was OUR origin failing to answer.
 *
 * `status` is the HTTP status when there is one, and omitted for a timeout —
 * where there is no response at all, and "the origin did not answer" is the
 * whole observation. Statuses below 500 are left alone: a 404 from our own
 * registry for a slug that does not exist is the caller's argument, not our
 * outage, and marking it would put ordinary 404s on the incident dashboard.
 *
 * Idempotent, so a message that is wrapped and re-marked on the way up (the
 * fleet pack's retry loop re-throws through two layers) carries the marker once.
 */
function markInternalOrigin(
  message: string,
  url: string | URL | undefined | null,
  status?: number,
): string {
  if (status !== undefined && status < 500) return message;
  if (!isPipeworxOrigin(url)) return message;
  if (message.includes(INTERNAL_ORIGIN_MARKER)) return message;
  return message + INTERNAL_ORIGIN_MARKER;
}

/**
 * Which blob4 value a failure from our own web services books as, or undefined
 * if this is not one.
 *
 * Ordered AFTER `internalDbMetricsClass` at the call site: a PostgREST envelope
 * from our own Supabase is a strictly more specific statement about the same
 * row (which of our services, and why), and the two cannot disagree about
 * whether the failure is ours.
 */
function internalHostMetricsClass(error: string): string | undefined {
  return error.includes(INTERNAL_ORIGIN_MARKER) ? INTERNAL_SERVICE_UNREACHABLE_CLASS : undefined;
}


/**
 * One place to turn a failed `fetch` into an error a caller can act on.
 *
 * Nearly every pack was written the same way:
 *
 *     if (!res.ok) throw new Error(`Unsplash: ${res.status}`);
 *
 * which discards the response body — and the body is usually where the upstream
 * says what was actually wrong ("**symbol** not found: GBP", "parameter `year`
 * out of range", "unknown taxonomy id"). The caller gets a number, cannot
 * self-correct, and retries the same broken call. A 2026-07-31 sweep found this
 * shape in 481 of 1,400 packs, 47 of them PLATFORM-keyed.
 *
 * It also hides bugs one level down. Two of the first three packs audited had a
 * second defect that only existed because of this line: unsplash's rate-limit
 * branch sat BELOW a catch-all and was unreachable, and bea-gov parsed
 * `BEAAPI.Error.APIErrorDescription` below a `!res.ok` throw that made the
 * parsing dead code for every non-200.
 *
 * DELIBERATELY NOT A CLASSIFIER. It does not add `user_error:` /
 * `upstream_down:` prefixes. Those decide which tier a failure lands in, and the
 * `error` tier is what the daily problem-tools list is built from — it means
 * "Pipeworx has a defect". A 400 is genuinely ambiguous: often a caller's bad
 * argument, but sometimes a query WE built wrong (ted-eu comma-joined its CPV
 * values into something TED rejected, and that bug was found only because it sat
 * in `error`). Blanket-classifying 400s as caller mistakes would have hidden it.
 * A pack that KNOWS which it is should keep saying so explicitly; this helper is
 * for the 481 that say nothing at all.
 */

/** Longest upstream explanation we'll pass through. Enough for a real message,
 *  short enough that an HTML page or a stack trace can't swamp the error. */

const MAX_DETAIL = 300;

/**
 * Default bound for `fetchWithTimeout` when a pack doesn't state its own.
 *
 * 25s mirrors the number `epo-ops` landed on after measuring the real failure:
 * a degraded upstream that doesn't error, it just never answers, and a Worker
 * sits in `await fetch()` until ITS OWN execution budget kills the request —
 * which can take minutes, not seconds (epo_ops_search_patents measured 4-8
 * MINUTE hangs before this existed). 25s is short enough that a caller gets a
 * fast, actionable error instead of holding the connection, and long enough
 * that it doesn't false-trip on a merely-slow-but-alive upstream.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 25_000;

/**
 * Read the body of a failed response and fold it into a throwable Error.
 *
 * Usage — note the `await`, which is the one thing that makes this a mechanical
 * change rather than a drop-in:
 *
 *     if (!res.ok) throw await httpError(res, 'Unsplash');
 *
 * Safe to call on any non-ok response: a body that is missing, empty, unreadable
 * or HTML degrades to exactly the old `Name: 404` string rather than throwing
 * something new from inside the error path.
 */
async function httpError(res: Response, name: string): Promise<Error> {
  return new Error(await httpErrorMessage(res, name));
}

/** The message text without constructing an Error — for packs that need to wrap
 *  it in their own envelope or add an explicit classification prefix. */
async function httpErrorMessage(res: Response, name: string): Promise<string> {
  // The one place a 5xx from a host WE run gets stamped as ours. `res.url` is
  // the URL the fetch actually resolved to (after redirects), so this is a fact
  // about the call rather than a guess from the `name` the pack passed in —
  // reword that label freely, the class does not move. See
  // internal-host-class.ts; no-op for every third-party upstream, which is why
  // this touches 481 packs' error text and changes none of it.
  return markInternalOrigin(
    `${name}: ${res.status}${detailSuffix(await readDetail(res))}`,
    res.url,
    res.status,
  );
}

/**
 * Just the upstream's own explanation — no name, no status.
 *
 * For a pack that has already said both in its own sentence. epo-ops reads
 * `EPO rejected this search as too large (HTTP 413) — ${httpErrorMessage(…)}`,
 * which rendered as `… (HTTP 413) — EPO: 413.` once the XML detail was being
 * dropped: the upstream named twice, the status twice, and the one thing EPO
 * actually said ("Not enough characters before truncation character") nowhere
 * (fleet #712). Returns '' when the body carries nothing readable, so a caller
 * can fall back to its own wording.
 */
async function upstreamDetail(res: Response): Promise<string> {
  return readDetail(res);
}

/**
 * Read a SUCCESSFUL response as JSON, failing loudly when it isn't JSON.
 *
 * `httpError` above only ever runs on `!res.ok`, which leaves the nastier half
 * of the problem unhandled: an upstream that answers **HTTP 200 with an HTML
 * page**. A bot wall, a login redirect, a maintenance interstitial and a CDN
 * error page are all 200s, so `res.ok` is true, and `res.json()` then throws
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
 *
 * That string is the problem. It names no upstream, carries no status, and
 * reads like a parser bug in Pipeworx — so it lands in the `error` tier, which
 * means "we have a defect", and the caller is told nothing they can act on.
 * data.govt.nz sat dead behind an Imperva challenge this way and every
 * status-code health check we own reported it green (7889a845). A zero-length
 * body has the same shape: `Unexpected end of JSON input`, seen this week on
 * uk-gazette (83% of external calls) and census.
 *
 * UNLIKE `httpError`, this one DOES classify, and the asymmetry is deliberate.
 * A 400 is genuinely ambiguous — often the caller's bad argument, sometimes a
 * query we built wrong — so blanket-classifying it would hide our own bugs.
 * There is no such ambiguity here: **no argument a caller can pass makes a JSON
 * API return an HTML page.** It is always the upstream, so `upstream_down:` is
 * a statement of fact rather than a guess, and it keeps these out of the
 * problem-tools list where they crowd out real defects.
 *
 *     const data = await parseJson<Feed>(res, 'UK Gazette');
 *
 * Call it only after the `!res.ok` check — on a failed response you want
 * `httpError`, which mines the body for the upstream's own explanation.
 */
async function parseJson<T>(res: Response, name: string): Promise<T> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    throw new Error(
      `upstream_down: ${name} returned a body that could not be read (HTTP ${res.status}). ` +
        'The connection most likely dropped mid-response; retrying is reasonable.',
    );
  }

  const type = res.headers.get('content-type') ?? 'no content-type';

  if (!raw.trim()) {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with an EMPTY body where JSON was expected (${type}). ` +
        'Nothing about the request can cause this — it is an upstream fault, and the same call may well work on retry.',
    );
  }

  // Checked before parsing rather than in the catch, because knowing it is
  // markup is what turns "we failed to parse something" into "they served a
  // web page" — the second is diagnosable, the first is not.
  const head = raw.slice(0, 200).trimStart().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?xml')) {
    const kind = head.startsWith('<?xml') ? 'an XML document' : 'an HTML page';
    // The summary, not the source. Pasting the first 120 characters of a web
    // page handed the agent `<!DOCTYPE html><html lang="en"…` — the same leak
    // this branch exists to describe (fleet #712).
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with ${kind} instead of JSON (${type}). ` +
        'That is typically a bot wall, a login redirect or a maintenance page — it is returned as a SUCCESS, ' +
        `so status-code health checks read it as fine. No argument change will get past it. ` +
        `The page says: ${summarizeErrorBody(raw) || 'nothing readable'}`,
    );
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with a body that is not valid JSON (${type}). ` +
        `It begins: ${stripMarkup(raw).slice(0, 120) || '(unreadable)'}`,
    );
  }
}

/**
 * `fetch`, but bounded — the fix for a systemic gap found 2026-08-30: a grep
 * audit of every pack's `mcps/*\/src/index.ts` found 1,339 of ~1,500 call
 * `fetch()` with NO timeout guard anywhere in the file. Two of those
 * (epo-ops, statcan) were confirmed live-hanging for 4-8 minutes before this
 * existed — every unguarded call carries the same risk, just unconfirmed.
 *
 * Mirrors the `epoFetch` wrapper `mcps/epo-ops/src/index.ts` shipped first:
 * bound the request with `AbortSignal.timeout`, and on a timeout/abort throw
 * an `upstream_down:` error that names the upstream and the bound rather than
 * letting the raw `TimeoutError`/`AbortError` (which names neither) propagate.
 * `upstream_down:` is deliberate, same reasoning as `parseJson` above — no
 * argument a caller passes can make an upstream hang, so it is always the
 * upstream's fault, and marking it that way keeps a slow API off the
 * problem-tools list where it would crowd out our own defects.
 *
 * Usage — a mechanical swap for a bare `fetch(url, init)`:
 *
 *     const res = await fetchWithTimeout(url, init, 'Some API');
 *
 * Pass `timeoutMs` as a fourth argument to override the default for a pack
 * with a known-slower upstream; the label should be the same short name you'd
 * pass to `httpError`/`httpErrorMessage` for that call.
 */
async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  name: string,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      // States the OBSERVATION (no response in N seconds), not a diagnosis.
      // "appears to be degraded" is an inference about the vendor that we have
      // not checked, and it is wrong in a way that misdirects whoever reads it:
      // a timeout from a Worker can equally mean OUR egress is blocked.
      //
      // Measured today (2026-09-01, fleet #1047): every call to
      // mainnet.base.org failed from the x402 facilitator while the identical
      // request from a laptop returned 200. Base was entirely healthy; the
      // public RPC refuses Cloudflare Worker egress. Had this message fired
      // there it would have blamed Base by name, and the next person would have
      // waited for a vendor outage to clear that did not exist.
      // A timeout has no status to test — there is no response at all — so
      // `markInternalOrigin` is called without one: an origin we run that never
      // answered is an availability failure by definition. This is the half of
      // fleet #1096 with neither a SQLSTATE nor a status code to key on.
      throw new Error(
        markInternalOrigin(
          `upstream_down: ${name} did not respond within ${timeoutMs / 1000}s. ` +
            `That can be ${name} being slow or down, or this environment being unable to reach it ` +
            `(some hosts refuse datacenter/Worker egress) — retry shortly, and check reachability ` +
            `from elsewhere before concluding ${name} is down.`,
          url,
        ),
      );
    }
    throw err;
  }
}

function detailSuffix(detail: string): string {
  return detail ? ` — ${detail}` : '';
}

async function readDetail(res: Response): Promise<string> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    // Body already consumed, or the connection died mid-read. The status alone
    // is still worth throwing — never let the error path throw its own error.
    return '';
  }
  return summarizeErrorBody(raw);
}

/**
 * Turn ANY error body — JSON, HTML, XML or plain text — into one short phrase
 * that never contains markup.
 *
 * This used to just drop an HTML or XML body on the floor, on the reasoning
 * that markup crowds out the status. That was half right. Dropping it loses the
 * one sentence a caller could have acted on: an `Access Denied` title, an SDMX
 * `<message:Error>` text, an OPS fault string. A 2026-08-30 support sweep
 * measured 13 of 291 caller-facing error rows carrying a raw page or document
 * verbatim, across 11 packs, and in every one of them the useful content —
 * "Access Denied", "Invalid country code", "SCRAPE_TIMEOUT" — was in there,
 * buried in markup the agent had to parse out of a string (fleet #712).
 *
 * So: extract the meaning, discard the markup. The output is passed through
 * `stripMarkup` unconditionally, which is what lets `check:error-body-leak`
 * assert mechanically that no caller-facing message can contain `<?xml`,
 * `<!DOCTYPE` or `<html`.
 */
function summarizeErrorBody(raw: string): string {
  if (!raw || !raw.trim()) return '';

  const head = raw.slice(0, 400).trimStart().toLowerCase();

  // An HTML error page (Cloudflare interstitial, nginx default, a login
  // redirect) says what it is in its <title>, and almost nowhere else.
  if (head.startsWith('<!doctype') || head.startsWith('<html')) {
    const title = htmlTitle(raw);
    return title
      ? `${title} (upstream returned an HTML error page, not an API response)`
      : 'upstream returned an HTML error page, not an API response';
  }

  // XML fault documents — EPO OPS, SDMX (`<message:Error>`), SOAP faults. The
  // human sentence sits in a child element whose tag name says what it is.
  if (head.startsWith('<?xml') || head.startsWith('<')) {
    const fault = xmlFaultText(raw);
    return fault
      ? `${stripMarkup(fault).slice(0, MAX_DETAIL)} (from the upstream's XML error document)`
      : 'upstream returned an XML error document with no readable message';
  }

  // Most JSON error bodies bury one human sentence among ids and echoed request
  // params. Prefer that sentence; fall back to the whole body when the shape is
  // unfamiliar, since an unfamiliar shape is exactly when we can least afford to
  // guess wrong and show nothing.
  const fromJson = messageFromJson(raw);
  return stripMarkup(fromJson ?? raw).slice(0, MAX_DETAIL);
}

/** The `<title>` of an HTML error page, or its first `<h1>` — the two places a
 *  bot wall, a 502 and an "Access Denied" all state what happened. */
function htmlTitle(raw: string): string | null {
  const head = raw.slice(0, 4000);
  for (const re of [/<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i]) {
    const m = re.exec(head);
    const text = m ? stripMarkup(m[1]) : '';
    if (text) return text.slice(0, 160);
  }
  return null;
}

/** Tag names that carry the explanation in an XML fault document, namespace
 *  prefix optional (`<message:Error>`, `<com:Text>`, `<faultstring>`). */
const XML_FAULT_TAG_RE =
  /<(?:[A-Za-z0-9_.-]+:)?(?:text|message|description|faultstring|reason|detail|title|errormessage|error)\b[^>]*>([^<]{2,400})</i;

function xmlFaultText(raw: string): string | null {
  const head = raw.slice(0, 8000);
  const tagged = XML_FAULT_TAG_RE.exec(head);
  if (tagged && tagged[1].trim()) return tagged[1];

  // Nothing conventionally named — take the longest text node instead. A fault
  // document with one sentence in an oddly named element is still readable;
  // returning nothing at all is not.
  let best = '';
  for (const m of head.matchAll(/>([^<>]{8,400})</g)) {
    const text = m[1].trim();
    if (text.length > best.length) best = text;
  }
  return best || null;
}

/**
 * Remove every tag and stray angle bracket, then collapse whitespace.
 *
 * Applied to everything on the way out, including the JSON and plain-text
 * paths, because an upstream is free to embed markup in a JSON string field —
 * and a leak is a leak regardless of which branch produced it.
 */
function stripMarkup(s: string): string {
  return collapse(decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/[<>]/g, ' '));
}

/** The handful of entities that show up in error-page titles. Decoded AFTER
 *  tags are stripped and BEFORE the angle-bracket sweep, so `&lt;script&gt;`
 *  in a title cannot decode into markup that survives — EMBL-EBI's ChEMBL 500
 *  page renders as `500 Internal Server Error &lt; EMBL-EBI` otherwise. */
function decodeEntities(s: string): string {
  return s
    .replace(/&(?:amp|#0*38);/gi, '&')
    .replace(/&(?:lt|#0*60);/gi, '<')
    .replace(/&(?:gt|#0*62);/gi, '>')
    .replace(/&(?:quot|#0*34);/gi, '"')
    .replace(/&(?:#0*39|apos|#x0*27);/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

/** The conventional "what went wrong" field, under any of the names upstreams
 *  actually use. Checked in order; first non-empty string wins. */
const MESSAGE_KEYS = [
  'message', 'error_message', 'errorMessage', 'detail', 'details',
  'description', 'error_description', 'reason', 'title', 'fault',
];

function messageFromJson(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return pickMessage(parsed, 0);
}

function pickMessage(node: unknown, depth: number): string | null {
  // Two levels covers `{error: {message}}` and `{errors: [{detail}]}`, the two
  // shapes that account for nearly all of them, without walking a large payload.
  if (depth > 2 || node == null) return null;

  if (typeof node === 'string') return node.trim() || null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = pickMessage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;

  for (const key of MESSAGE_KEYS) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // `{error: …}` where error is itself an object or a string — the single most
  // common wrapper, so it is worth descending into by name rather than scanning
  // every key and risking picking up an echoed request parameter.
  for (const key of ['error', 'errors', 'fault', 'Error', 'data']) {
    if (key in obj) {
      const found = pickMessage(obj[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Errors are read in a single line of log output; newlines and runs of
 *  whitespace make a multi-line body unreadable there. */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
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


// Bound every fetch() in this pack to a fixed timeout — an upstream that
// degrades without erroring would otherwise hold the Worker in `await fetch()`
// until its own execution budget kills the request (minutes, not seconds).
// Mirrors the epoFetch / usaspending retryFetch pattern (fleet #685).
async function pwFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  return fetchWithTimeout(url, init ?? {}, 'SBIR');
}

// `api.sbir.gov` is NXDOMAIN — the host does not exist and has not for as long
// as we have metrics for. A Worker's fetch to a name that doesn't resolve comes
// back as a 530, which reads exactly like "Cloudflare origin is having a bad
// day", so a previous pass took the 530 at face value and tagged it
// upstream_down rather than checking whether the hostname was real. It wasn't:
// every sbir call has failed since the pack shipped. The live host per
// sbir.gov/api is api.www.sbir.gov, and the paths have no `.json` suffix.
const BASE_URL = 'https://api.www.sbir.gov/public/api';
const UA = { 'User-Agent': 'Pipeworx/1.0 (gateway.pipeworx.io)' };

// SBIR renamed DOD to DOW (Department of War) in its agency vocabulary. Callers
// and our own examples still say "DOD" — and will for years — so translate
// rather than reject. Everything else round-trips unchanged.
const AGENCY_ALIASES: Record<string, string> = { DOD: 'DOW', DEFENSE: 'DOW' };

function canonicalAgency(agency: string): string {
  const key = agency.trim().toUpperCase();
  return AGENCY_ALIASES[key] ?? key;
}

const MAJOR_AGENCIES = ['DOW', 'HHS', 'NASA', 'NSF', 'DOE', 'USDA'];

// SBIR is not rate-limiting us. It is closed, and it has now refused us in two
// different shapes — which is the reason this function does not key on either.
//
// The first shape was a 429 with `{"Code":"TooManyRequestsError","Message":"The
// SBIR Public API is not available at this time."}`, and the branch below was
// written for exactly that string. By 2026-08-28 the API had moved behind AWS
// API Gateway and the refusal became a bare 403 `{"message":"Forbidden"}` —
// x-amz-apigw-id on every response, every path, including the API root.
// Verified off our own infrastructure so it is not a Cloudflare egress block:
//   api.www.sbir.gov/public/api/awards        -> 403 {"message":"Forbidden"}
//   …with a browser User-Agent                -> 403 (identical)
//   …/solicitations, …/firm, and the API root -> 403 (identical)
//   www.sbir.gov/api/awards.json (legacy)     -> 404 Drupal page-not-found
//   www.sbir.gov itself                       -> 200, the site is fine
//
// So the earlier fix stopped applying the moment the upstream changed how it
// says no, and the bare `SBIR API error: 403 Forbidden` it fell through to has
// no class token — which the gateway reads as `upstream_throttled`, because its
// throttle rule matches a bare 403 anywhere in the string. That is the actual
// bug: 81 dead calls in seven days filed under the one class the fleet's
// problem-tools triage deliberately excludes, where a permanently dead pack is
// indistinguishable from ordinary rate-limiting. It could have sat there for
// months (fleet #572).
//
// Hence: classify on the STATUS, not on the body. Anything that is not a 404 or
// a caller-side 400 is an access wall, and an access wall gets `upstream_down:`
// plus a sentence a caller can act on.
//
// SBIR's own /api page says why, and it is not a key requirement:
//   "Please be advised that the SBIR.gov APIs are currently undergoing
//    maintenance. In the meantime, if you require assistance in obtaining your
//    data, please contact our helpdesk."
// No key is offered, so there is nothing for `_apiKey` to carry.
const CLOSED =
  'upstream_down: SBIR.gov has closed its public API — every endpoint returns 403 Forbidden, ' +
  'including the API root. This is not a rate limit and not a missing key: sbir.gov/api carries ' +
  'a notice that the APIs are "currently undergoing maintenance", with no key or replacement ' +
  'offered, and directs data requests to sba.sbir.support@decisionpointcorp.com. ' +
  'Retrying will not help. For federal award data in the meantime, usa_award_search covers ' +
  'USAspending (all federal awards, SBIR/STTR contracts included) and sam_search_opportunities ' +
  'covers open solicitations on SAM.gov. Status: https://www.sbir.gov/api';

function sbirErr(res: Response, body?: string): string {
  // 404 is a real not-found — a bad award id or an endpoint path we got wrong —
  // and must not be swept into the outage message, or a genuine typo starts
  // reading as a government shutdown.
  if (res.status === 404) return `not_found: SBIR returned 404 for this request. ${(body ?? '').slice(0, 120)}`;
  if (res.status >= 500) {
    return `upstream_down: SBIR returned ${res.status} ${res.statusText} — an origin failure on their side, worth retrying shortly.`;
  }
  // 401/402/403/429 and anything else in the 4xx range: the API is refusing
  // access rather than answering. The body is appended so the NEXT shape change
  // is visible in the message instead of silently reclassifying us again.
  const detail = (body ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
  return `${CLOSED} (upstream said: ${res.status} ${res.statusText}${detail ? ` ${detail}` : ''})`;
}

/** One SBIR GET, with the error body read so `sbirErr` can tell maintenance from a real 429. */
async function sbirGet(path: string, params: URLSearchParams): Promise<Record<string, unknown>[]> {
  const res = await pwFetch(`${BASE_URL}/${path}?${params}`, { headers: UA });
  if (!res.ok) throw new Error(sbirErr(res, await res.text().catch(() => '')));
  const data = (await res.json()) as unknown;
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

const tools: McpToolExport['tools'] = [
  {
    name: 'sbir_search_awards',
    description:
      '"Which companies won NASA SBIR Phase II awards for autonomy?" / "SBIR awards for [topic]" / "who received DoD SBIR funding" / "Phase I and Phase II awards at [agency]" — AWARDED federal Small Business Innovation Research (SBIR) and STTR grants: the small-business R&D contracts an agency has already funded. Search by keyword, agency ("DOD", "NASA", "DARPA", "NSF", "DOE", "HHS"), year, company, or state. Returns the winning company, award amount, agency and branch, topic code, abstract, fiscal year, and Phase (I/II/III). This is the tool for who WON federal small-business R&D money and how much; for opportunities still open to bid use sbir_search_solicitations.',
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
            'Filter by funding agency: DOW (Department of War, formerly DOD — "DOD" is accepted and translated), HHS, NASA, NSF, DOE, USDA, EPA, DOC, ED, DOT, DHS.',
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
      // Was required, so "which companies won NASA SBIR awards?" — agency named,
      // no topic — failed before reaching SBIR at all. Any one filter will do.
      required: [],
    },
  },
  {
    name: 'sbir_get_award',
    description:
      'Get full details for one SBIR/STTR award, identified by its contract number or agency tracking number (the `award_id`/`contract` fields returned by sbir_search_awards). SBIR has no lookup-by-id endpoint, so this searches and verifies the identifier matches — start from sbir_search_awards rather than guessing an id.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        award_id: {
          type: 'string',
          description:
            'Contract number or agency tracking number, exactly as returned in `award_id` or `contract` by sbir_search_awards.',
        },
      },
      required: ['award_id'],
    },
  },
  {
    name: 'sbir_search_solicitations',
    description:
      '"Which SBIR or STTR solicitations are open at [agency]?" / "current SBIR topics" / "open DoD SBIR solicitations" / "SBIR proposal deadlines" — active SBIR/STTR funding opportunities and topic solicitations from the federal SBIR program, by keyword or agency (e.g., "DOD", "DARPA", "NSF", "NASA", "DOE", "HHS"). Returns topic descriptions, sponsoring agency/branch, Phase, and open/close dates. This is the tool for open federal small-business R&D solicitations and topics; for who already WON SBIR money use sbir_search_awards.',
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
            'Filter by agency: DOW (Department of War, formerly DOD — "DOD" is accepted and translated), HHS, NASA, NSF, DOE, USDA, EPA, DOC, ED, DOT, DHS.',
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
      // Was required, so "which companies won NASA SBIR awards?" — agency named,
      // no topic — failed before reaching SBIR at all. Any one filter will do.
      required: [],
    },
  },
  {
    name: 'sbir_company_awards',
    description:
      'Get complete SBIR/STTR award history for a company. Returns all awards with amounts, agencies, topics, and funding phases.',
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
      'Get SBIR/STTR award counts by agency. Specify agency (e.g., "DOD", "NASA", "NSF") or omit to see all major agencies.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agency: {
          type: 'string',
          description:
            'Specific agency to count, e.g. "DOW" (formerly DOD), "NASA", "NSF". Omit to cover all major agencies. Note SBIR publishes no total-count field, so a result at the page cap reports `award_count_at_least` rather than a total.',
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
  contract: string | null;
  award_link: string | null;
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
    // SBIR's field list has no `award_id`. The two identifiers it does publish
    // are the contract number and the agency tracking number, so fall through
    // to those instead of reporting null on every single award.
    award_id: (a.award_id ?? a.awardId ?? a.agency_tracking_number ?? a.contract ?? null) as string | null,
    state: (a.state ?? null) as string | null,
    city: (a.city ?? null) as string | null,
    contract: (a.contract ?? null) as string | null,
    award_link: (a.award_link ?? null) as string | null,
  };
}

async function searchAwards(
  keyword: string | undefined,
  agency?: string,
  year?: number,
  company?: string,
  state?: string,
  limit?: number,
) {
  if (!keyword && !agency && !year && !company && !state) {
    return {
      found: false,
      reason: 'no_filter',
      hint: 'Give at least one of keyword, agency ("NASA", "DOD"), year, company or state — SBIR will not return the whole award corpus.',
    };
  }
  const rows = Math.min(limit ?? 20, 100);
  const params = new URLSearchParams({ rows: String(rows) });
  // Omit the param entirely rather than sending keyword= — "no keyword" and
  // "the empty keyword" are different requests upstream.
  if (keyword) params.set('keyword', keyword);
  if (agency) params.set('agency', canonicalAgency(agency));
  if (year) params.set('year', String(year));
  // The awards endpoint spells company `firm`, not `company` — a `company=`
  // param is silently ignored, so every company-filtered search was quietly
  // answering with unfiltered results.
  if (company) params.set('firm', company);
  if (state) params.set('state', state);

  const data = await sbirGet('awards', params);
  // `state` is not in SBIR's documented parameter list even though it IS in the
  // returned record, so the server may or may not honour it. Filter locally too:
  // if the server filtered, this is a no-op; if it didn't, we don't hand back
  // Ohio awards under a "state: CA" query.
  const wanted = state?.trim().toUpperCase();
  const awards = data
    .map(formatAward)
    .filter((a) => !wanted || (a.state ?? '').toUpperCase() === wanted);

  return {
    keyword,
    count: awards.length,
    awards,
  };
}

async function getAward(awardId: string) {
  const params = new URLSearchParams({ awardId, rows: '100' });
  const data = await sbirGet('awards', params);

  // There is no by-id endpoint in SBIR's documented API and no `award_id` in
  // its field list, so an unrecognised `awardId=` param is simply ignored and
  // the endpoint answers with the first page of ALL awards. Returning `data[0]`
  // from that meant handing back an arbitrary award as though it were the one
  // asked for — a wrong answer that looks exactly like a right one. Only return
  // a record that actually carries the requested identifier.
  const needle = awardId.trim().toLowerCase();
  const match = data.find((a) =>
    ['award_id', 'awardId', 'agency_tracking_number', 'contract', 'solicitation_number']
      .some((k) => String(a[k] ?? '').trim().toLowerCase() === needle),
  );
  if (!match) {
    throw new Error(
      `No SBIR award carries the identifier "${awardId}". SBIR's public API has no lookup-by-id endpoint — search with sbir_search_awards (keyword/agency/year/company) and use the contract or agency_tracking_number from those results.`,
    );
  }
  return formatAward(match);
}

async function searchSolicitations(
  keyword: string | undefined,
  agency?: string,
  openOnly?: boolean,
  limit?: number,
) {
  if (!keyword && !agency) {
    return {
      found: false,
      reason: 'no_filter',
      hint: 'Give a keyword or an agency ("NASA", "DOD") — open solicitations are not returned unfiltered.',
    };
  }
  const rows = Math.min(limit ?? 20, 100);
  const params = new URLSearchParams({ rows: String(rows) });
  if (keyword) params.set('keyword', keyword);
  if (agency) params.set('agency', canonicalAgency(agency));
  if (openOnly !== false) params.set('open', '1');

  const data = await sbirGet('solicitations', params);
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
  // `firm`, not `company` — see searchAwards.
  const params = new URLSearchParams({ firm: company, rows: String(rows) });

  const data = await sbirGet('awards', params);
  return {
    company,
    count: data.length,
    awards: data.map(formatAward),
  };
}

// SBIR's awards endpoint returns a bare JSON array with no total-count field —
// there is no `numFound`, and `rows` caps the page. So the old implementation's
// `data.length` was never an award count: it was the page size. Asked for one
// agency it fetched `rows=0` and reported "0 awards"; asked for all of them it
// fetched `rows=1` and reported "1 award" for each of DOD, HHS, NASA, NSF, DOE
// and USDA. Both are fabrications, and "0 awards" is the worse one — it reads
// as a real finding about the agency rather than as a broken tool.
//
// We can still answer the question honestly by paging: count what's actually
// there up to a stated ceiling, and say plainly when we hit the ceiling rather
// than passing a truncated number off as a total.
const STATS_PAGE = 100; // SBIR's documented default/maximum page size

/**
 * One page is all the arithmetic SBIR supports. Under a full page, the page IS
 * the total and we can say so. At a full page all we honestly know is "at least
 * this many", so that's what we return — the count field stays null rather than
 * carrying a number that isn't one.
 */
async function countAwards(agency: string) {
  const params = new URLSearchParams({
    agency: canonicalAgency(agency),
    rows: String(STATS_PAGE),
  });
  const batch = await sbirGet('awards', params);
  if (batch.length < STATS_PAGE) return { award_count: batch.length, exact: true };
  return {
    award_count: null,
    award_count_at_least: STATS_PAGE,
    exact: false,
    note: `SBIR's public API returns no total-count field and caps a page at ${STATS_PAGE}, so an exact total isn't available. Narrow by year with sbir_search_awards to get countable slices.`,
  };
}

async function agencyStats(agency?: string) {
  if (agency) {
    return { agency: canonicalAgency(agency), ...(await countAwards(agency)) };
  }

  // Parallel calls for all major agencies. Per-agency try/catch so a
  // single network blip or JSON parse failure doesn't tank the whole
  // summary — bad agencies report a null count + error string.
  const results = await Promise.all(
    MAJOR_AGENCIES.map(async (ag) => {
      try {
        return { agency: ag, ...(await countAwards(ag)) };
      } catch (err) {
        return { agency: ag, award_count: null, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  return { agencies: results };
}

export default { tools, callTool, meter: { credits: 5 } } satisfies McpToolExport;
