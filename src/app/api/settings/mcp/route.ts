import { withApiErrors } from '@/server/auth/api-response';
import { hasTrustedOrigin } from '@/server/auth/origin';
import {
  createMcpClient,
  listMcpClients,
  revokeMcpClient,
  McpClientError,
} from '@/server/mcp/clients';
import { ZodError } from 'zod';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store', Pragma: 'no-cache' };
function handler(method: 'GET' | 'POST' | 'DELETE') {
  return withApiErrors(async (request: Request) => {
    try {
      if (new URL(request.url).search) throw new McpClientError(400);
      if (method === 'GET')
        return Response.json(await listMcpClients(request.headers), {
          headers,
        });
      if (!hasTrustedOrigin(request)) throw new McpClientError(403);
      if (
        request.headers.get('content-type')?.split(';')[0] !==
        'application/json'
      )
        throw new McpClientError(415);
      const body = await request.text();
      if (Buffer.byteLength(body) > 4096) throw new McpClientError(400);
      const value = JSON.parse(body);
      return Response.json(
        await (method === 'POST'
          ? createMcpClient(request.headers, value)
          : revokeMcpClient(request.headers, value)),
        { headers, status: method === 'POST' ? 201 : 200 },
      );
    } catch (error) {
      const status =
        error instanceof McpClientError
          ? error.status
          : error instanceof ZodError || error instanceof SyntaxError
            ? 400
            : 500;
      return Response.json(
        { error: 'MCP_CLIENT_UNAVAILABLE' },
        { status, headers },
      );
    }
  });
}
export const GET = handler('GET');
export const POST = handler('POST');
export const DELETE = handler('DELETE');
