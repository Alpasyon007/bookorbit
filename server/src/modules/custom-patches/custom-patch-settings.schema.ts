import { z } from 'zod';
import { seriesGridOptionsSchema } from '../../common/utils/series-grid-options.schema';

export const customPatchPreferencesSchema = z
  .object({
    version: z.literal(1),
    seriesGrid: seriesGridOptionsSchema
      .extend({
        enabled: z.boolean(),
        standaloneLabel: z.string().trim().max(40),
        headingIndent: z.number().int().min(0).max(32),
        showDividers: z.boolean(),
      })
      .strict(),
    sidebar: z
      .object({ enabled: z.boolean(), showGithub: z.boolean(), showSupport: z.boolean(), showIos: z.boolean(), showAndroid: z.boolean() })
      .strict(),
    seriesRequests: z
      .object({
        enabled: z.boolean(),
        defaultFormat: z.enum(['ebook', 'audiobook']),
        initialSelection: z.enum(['eligible', 'none']),
        showRequestAll: z.boolean(),
      })
      .strict(),
    coverSearch: z
      .object({
        enabled: z.boolean(),
        retailerSources: z
          .array(z.enum(['hachette-uk', 'waterstones', 'foyles']))
          .max(3)
          .refine((items) => new Set(items).size === items.length),
        metadataSourcesEnabled: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const customPatchPolicySchema = z
  .object({
    version: z.literal(1),
    seriesGridEnabled: z.boolean(),
    sidebarCustomizationEnabled: z.boolean(),
    seriesRequestsEnabled: z.boolean(),
    extendedCoverSearchEnabled: z.boolean(),
  })
  .strict();
