# mcp-sbir

SBIR MCP — wraps the SBIR.gov public API (free, no auth)

Part of the [Pipeworx](https://pipeworx.io) open MCP gateway.

## Tools

| Tool | Description |
|------|-------------|

## Quick Start

Add to your MCP client config:

```json
{
  "mcpServers": {
    "sbir": {
      "url": "https://gateway.pipeworx.io/sbir/mcp"
    }
  }
}
```

Or use the CLI:

```bash
npx pipeworx use sbir
```

## License

MIT
