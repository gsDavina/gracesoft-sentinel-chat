/**
 * Deterministic, rule-based intent detection — same philosophy as
 * `personal-recipe.ts`/`grocery-list.ts`. Distinct from
 * `isPersonalRecipeRequest`: that one asks for *one specific* recipe ("my
 * chicken soup recipe"); this one asks for a count or listing of *all* of
 * them ("show me my recipes"). Only relevant when a `RecipeSourceProvider`
 * with `listRecipes` is actually configured; `handleMessage` gates on that.
 */
const RECIPE_LIST_KEYWORDS = [
  "how many recipes",
  "(list|show me|see|view|give me) (all )?(of )?(the |my )?recipes",
  "what recipes (do|have) i (have|got|saved)",
  "my recipe (list|collection)",
];

const RECIPE_LIST_PATTERN = new RegExp(`(${RECIPE_LIST_KEYWORDS.join("|")})`, "i");

export function isRecipeListRequest(text: string): boolean {
  return RECIPE_LIST_PATTERN.test(text);
}
