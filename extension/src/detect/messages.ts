import { z } from 'zod';
import { DetectedPageSchema } from '../contracts/page-context';
import { defineMessage } from '../core/messaging';

/** One detection result. `seq` only grows within a tab, so the panel can drop late results (OP1-UNIT-19). */
export const DetectionSchema = z.strictObject({
  page: DetectedPageSchema,
  durationMs: z.number().nonnegative(),
  seq: z.number().int().nonnegative(),
});
export type Detection = z.infer<typeof DetectionSchema>;

/** Content script → side panel, when the result changes. */
export const PaperDetected = defineMessage('detect.paperDetected', DetectionSchema, z.strictObject({}));
/** Side panel → content script of one tab, when the panel opens or the active tab changes. */
export const GetPageContext = defineMessage('detect.getPageContext', z.strictObject({}), DetectionSchema);
