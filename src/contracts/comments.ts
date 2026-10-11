import { z } from 'zod';
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v);
    return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === v;
  });
export const commentTarget = z.discriminatedUnion('type', [
  z.object({ type: z.literal('nutrition_day'), id: date }).strict(),
  z
    .object({ type: z.literal('measurement'), id: z.string().min(1).max(100) })
    .strict(),
  z
    .object({ type: z.literal('workout'), id: z.string().min(1).max(100) })
    .strict(),
]);
export const commentScope = z
  .object({ ownerId: z.string().min(1), target: commentTarget })
  .strict();
export const createCommentInput = commentScope.extend({
  body: z.string().trim().min(1).max(4000),
  parentId: z.string().min(1).optional(),
});
export const updateCommentInput = z
  .object({
    ownerId: z.string().min(1),
    body: z.string().trim().min(1).max(4000),
  })
  .strict();
export type CommentTarget = z.infer<typeof commentTarget>;
export type CommentDto = {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
};
