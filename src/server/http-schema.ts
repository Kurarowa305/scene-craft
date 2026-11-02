export const text = { type: "string", minLength: 1 } as const;
export const key = {
  type: "string",
  minLength: 8,
  maxLength: 128,
  pattern: "^[a-zA-Z0-9_-]+$",
} as const;
export const bodySchema = (
  properties: Record<string, unknown>,
  required: string[],
) => ({
  type: "object",
  additionalProperties: false,
  properties: { requestKey: key, ...properties },
  required: ["requestKey", ...required],
});
export const idParams = {
  type: "object",
  properties: { id: { type: "string", format: "uuid" } },
  required: ["id"],
  additionalProperties: false,
};
