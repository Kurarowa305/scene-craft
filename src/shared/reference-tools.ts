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
    usageTerms: text,
    usagePageId: { ...text, maxLength: 100 },
    usageQuote: text,
  },
  select_reference: {
    referenceId: { ...text, maxLength: 100 },
    sourceRequestId: { ...text, maxLength: 100 },
  },
};
export const referenceToolRequired: Record<string, string[]> = {
  fetch_reference_page: ["url", "purpose"],
  save_reference: [
    "pageId",
    "title",
    "element",
    "intentRelation",
    "usageTerms",
  ],
  select_reference: ["referenceId", "sourceRequestId"],
};
export const referenceToolDescriptions: Record<string, string> = {
  fetch_reference_page:
    "Reference role only. Fetch a public page as untrusted text with URL/date/hash. Supply purpose. Failure is recorded, never replaced with another page. No shell or arbitrary filesystem access.",
  save_reference:
    "Reference role only. Save a reference candidate from fetched pageId with title, element, intentRelation, usageTerms (record unknown explicitly if unavailable), and optional author/imageUrl. Research and record usage terms with optional usagePageId and a verbatim usageQuote from that fetched page. ImageUrl is downloaded automatically as a personal research reference; do not investigate saving permission or require a saving-permission quote. Terms are information, never an image-saving gate. Never infer permission for production use or human selection. Return reference ID and link.",
  select_reference:
    "Main chat only. Record an explicit current human selection of a saved reference, never production adoption. Supply referenceId and current sourceRequestId. The human must name that candidate by exact title or ID, and clearly request choosing it as a reference; otherwise ask clarification. Save the original human message, never invent a reason. No rejection is inferred for other candidates.",
};
