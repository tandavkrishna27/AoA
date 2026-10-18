/** Conversational choices are never runtime approval authority. */
export function normalizeCommanderOptions(payload: unknown): { question: string; options: string[] } | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = payload as Record<string, unknown>;
  // Previously installed prompts used confirm/choices aliases.
  const legacy = value.question === undefined && value.options === undefined;
  const question = legacy
    ? value.confirm === true ? "Proceed with this action?" : "Choose an option"
    : value.question;
  const options = legacy
    ? value.confirm === true ? ["Proceed", "Cancel"] : value.choices
    : value.options;
  if (typeof question !== "string" || !question.trim() ||
      !Array.isArray(options) || options.length === 0 ||
      !options.every((option): option is string => typeof option === "string" && option.trim().length > 0)) return null;
  return { question, options };
}
