import { z } from 'zod';

export const seriesGridOptionsSchema = z
  .object({
    hierarchyOrder: z.enum(['forward', 'reverse']),
    groupOrder: z.enum(['library', 'library-reversed', 'name-asc', 'name-desc']),
    maxDepth: z.number().int().min(0).max(8),
    directBooksPosition: z.enum(['first', 'last']),
    standalonePosition: z.enum(['first', 'last']),
  })
  .strict();
