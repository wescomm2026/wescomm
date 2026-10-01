import { z } from "zod";

const clearableTrimmedString = (maxLength: number) => z
  .union([z.string().trim().max(maxLength), z.null()])
  .transform((value) => value === null || value === "" ? null : value)
  .optional();

const studentNumberSchema = z.string().trim().transform((value) => value.toUpperCase().replace(/\s+/g, "")).pipe(
  z.string().min(3).max(40).regex(/^[A-Z0-9][A-Z0-9._\/-]*$/, "Use a valid Student ID number.")
);

export const profileUpdateSchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  departmentId: z.string().uuid().optional(),
  studentNumber: studentNumberSchema.optional(),
  phone: clearableTrimmedString(32),
  address: clearableTrimmedString(500)
}).strict().refine(
  (input) => Object.values(input).some((value) => value !== undefined),
  { message: "Provide at least one profile field to update." }
);

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

export const onboardingSchema = z.object({
  departmentId: z.string().uuid(),
  studentNumber: studentNumberSchema,
  phone: clearableTrimmedString(32),
  address: clearableTrimmedString(500)
}).strict();

export type OnboardingInput = z.infer<typeof onboardingSchema>;
