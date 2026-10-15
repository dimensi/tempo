import { createReportHandler } from '@/server/pdf/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = createReportHandler();

export const HEAD = GET;
