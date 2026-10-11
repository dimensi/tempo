import 'server-only';
import { ZodError } from 'zod';
import { authorize } from '@/server/auth/guards';
import { reportRequestSchema } from '@/contracts/reports';
import { reportMessages as m } from '@/features/reports';
import { ReportError } from '@/server/pdf/errors';
import { reportDataSource, type ReportDataSource } from '@/server/pdf/source';
import { generateReport, withReportSlot } from '@/server/pdf/service';
import { reportCsp } from '@/server/pdf/template';

const privateHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
// Factory permits integration before source C is available; authorization is never injectable.
export function createReportHandler(
  source: () => ReportDataSource = reportDataSource,
) {
  return async (request: Request): Promise<Response> => {
    const query = new URL(request.url).searchParams;
    const input = reportRequestSchema.safeParse(Object.fromEntries(query));
    if (!input.success)
      return Response.json(
        { error: m.invalid },
        { status: 400, headers: privateHeaders },
      );
    const data = input.data;
    const access = await authorize(
      request.headers,
      'reports:export',
      data.ownerId,
    );
    if (!access.ok)
      return Response.json(
        { error: m.denied },
        { status: access.status, headers: privateHeaders },
      );
    try {
      return await withReportSlot(async () => {
        const signal = AbortSignal.any([
          request.signal,
          AbortSignal.timeout(45000),
        ]);
        const body = await generateReport(source(), data, signal);
        // A grant revoked during generation cannot release a report.
        const current = await authorize(
          request.headers,
          'reports:export',
          data.ownerId,
        );
        if (!current.ok)
          return Response.json(
            { error: m.denied },
            { status: current.status, headers: privateHeaders },
          );
        const filename = `nutrition-${data.start}-${data.end}.${data.format}`;
        return new Response(
          typeof body === 'string' ? body : new Uint8Array(body),
          {
            headers: {
              ...privateHeaders,
              'Content-Type':
                data.format === 'html'
                  ? 'text/html; charset=utf-8'
                  : 'application/pdf',
              'Content-Disposition': `${data.format === 'html' ? 'inline' : 'attachment'}; filename="${filename}"`,
              'Content-Security-Policy': `${reportCsp}; sandbox`,
            },
          },
        );
      });
    } catch (error) {
      const messages = {
        INVALID: m.invalid,
        NO_DATA: m.noData,
        UNAVAILABLE: m.unavailable,
        RUNTIME: m.runtime,
        BUSY: m.busy,
        OVERSIZED: m.oversized,
      };
      return Response.json(
        {
          error:
            error instanceof ReportError
              ? messages[error.code]
              : error instanceof ZodError
                ? m.invalid
                : m.failed,
        },
        {
          status:
            error instanceof ReportError
              ? error.status
              : error instanceof ZodError
                ? 422
                : 500,
          headers: {
            ...privateHeaders,
            ...(error instanceof ReportError && error.code === 'BUSY'
              ? { 'Retry-After': '5' }
              : {}),
          },
        },
      );
    }
  };
}
