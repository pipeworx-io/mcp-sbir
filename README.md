# SBIR — Small Business Innovation Research Awards

The Small Business Innovation Research (SBIR) and Small Business Technology Transfer (STTR) program data. Federal R&D awards to small businesses across NIH, DoD, NSF, NASA, DOE, and other agencies. ~$5B/year flowing to small companies for early-stage research. Free, no auth.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1476+ live data sources.

## Why this matters for AI agents

For researching small-business tech innovation, federal R&D priorities, or "who's getting funded for X technology?" SBIR is the source. Different from [USAspending](/docs/reference/usaspending) (which has the same data plus all other federal awards) — SBIR is curated, smaller, easier to search for early-stage R&D specifically.

Common flows:

- **Award search.** "AI / cybersecurity / clean energy SBIR awards?" → keyword search.
- **Company history.** "What has X received in SBIR funding?" → company-level search.
- **Agency portfolio.** "What's NASA funding under SBIR?" → agency filter.
- **Phase tracking.** Phase I (proof of concept, ~$250k), Phase II (development, ~$1M+), Phase III (commercialization).

## Auth

None. SBIR.gov is fully public.

## Award structure

| Phase | Typical award | Duration | Purpose |
|---|---|---|---|
| Phase I | $50k-$300k | 6-12 months | Feasibility study |
| Phase II | $750k-$2M | 24 months | Prototype development |
| Phase III | No SBIR funds | Variable | Commercialization (other federal $$ or private) |

A Phase II award means the Phase I succeeded enough that an agency wants to invest more. Phase III means the technology graduated to procurement or larger contracts.

## Participating agencies

11 federal agencies have SBIR programs: DoD, HHS (NIH), NASA, NSF, DOE, USDA, EPA, DHS, DOT, ED, NIST.

DoD and NIH together account for ~70% of SBIR/STTR dollars. Each agency has different priorities (DoD: defense tech; NIH: biomedical; NASA: space tech; NSF: foundational research).

## Common pitfalls

- **STTR vs SBIR.** Both are Small Business set-asides. STTR (Technology Transfer) requires a research-institution partner; SBIR doesn't. Funding is similar.
- **Topic codes vary by agency.** DoD has detailed topic codes (specific defense problems); NIH uses broader project topics. Cross-agency comparison by "topic" is messy.
- **Phase III isn't an SBIR award.** It's commercialization-track funding from other sources. Don't expect to find Phase III dollar figures in SBIR data.
- **Award dates lag.** Awards appear publicly after legal cure periods. Recent quarters may be incomplete.
- **Sole proprietorship to acquisition pathways.** Successful SBIR companies often get acquired before commercialization. The award history doesn't always tell you what happened to the technology after Phase II — track the company separately via SEC EDGAR if it went public.
- **Small business definition.** SBIR-eligible companies are <500 employees AND meet other size standards. Some "small" companies get acquired after winning Phase I; eligibility is checked at the time of award.

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "sbir": {
      "url": "https://gateway.pipeworx.io/sbir/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/sbir/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1476+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Sbir data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
