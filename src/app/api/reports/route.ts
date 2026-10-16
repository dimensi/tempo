import { withApiErrors } from '@/server/auth/api-response';
import { createReportHandler } from '@/server/pdf/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = withApiErrors(createReportHandler());

export const HEAD = GET;
