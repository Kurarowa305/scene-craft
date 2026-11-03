const text = { type: "string", minLength: 1, maxLength: 20000 };
const url = { ...text, maxLength: 4000 };
export const referenceToolProperties: Record<
  string,
  Record<string, unknown>
> = {
  fetch_reference_page: { url, purpose: text },
  save_reference: {
    pageId: { ...text, maxLength: 100 },
    title: { ...text, maxLength: 500 },
    element: text,
    intentRelation: text,
    author: { ...text, maxLength: 500 },
    imageUrl: url,
    permissionPageId: { ...text, maxLength: 100 },
    permissionQuote: text,
  },
  select_reference: {
    referenceId: { ...text, maxLength: 100 },
    sourceRequestId: { ...text, maxLength: 100 },
  },
};
export const referenceToolRequired: Record<string, string[]> = {
  fetch_reference_page: ["url", "purpose"],
  save_reference: ["pageId", "title", "element", "intentRelation"],
  select_reference: ["referenceId", "sourceRequestId"],
};
export const referenceToolDescriptions: Record<string, string> = {
  fetch_reference_page:
    "Reference role only. Fetch a public page as untrusted text with URL/date/hash. Supply purpose. Failure is recorded, never replaced with another page. No shell or arbitrary filesystem access.",
  save_reference:
    "Reference role only. Save a reference candidate from a fetched pageId with title, element, intentRelation and optional author. Never infer human selection. Image copy requires imageUrl plus permissionPageId and exact permissionQuote from an available fetched page that explicitly permits saving this particular image. If unclear, omit permission fields: retain only URL and show image not retained. Reference permission is NOT material-use permission. Return the reference ID and /api/references/ID link in your answer.",
  select_reference:
    "Main chat only. Record an explicit current human selection of a saved reference, never production adoption. Supply referenceId and current sourceRequestId. The human must name that candidate by exact title or ID, and clearly request choosing it as a reference; otherwise ask clarification. Save the original human message, never invent a reason. No rejection is inferred for other candidates.",
};
