import { z } from 'zod';
import {
  anamnesisOverviewSchema,
  anamnesisMarkerSummarySchema,
  medicalDocumentSchema,
  medicalReportExportSchema,
} from './anamnesis';
export const offlineAnamnesisSchema = z
  .object({
    version: z.literal(1),
    ownerId: z.string().min(1).max(128),
    overview: anamnesisOverviewSchema,
    markers: z.array(anamnesisMarkerSummarySchema).max(1000),
    documents: z.array(medicalDocumentSchema).max(1000),
    reports: z.array(medicalReportExportSchema).max(200),
    complete: z.boolean(),
  })
  .strict();
export type OfflineAnamnesis = z.infer<typeof offlineAnamnesisSchema>;
