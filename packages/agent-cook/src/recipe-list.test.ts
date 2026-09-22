import { describe, expect, it } from "vitest";
import { isRecipeListRequest } from "./recipe-list.js";

describe("isRecipeListRequest", () => {
  it("recognises common recipe-count/list phrasings", () => {
    expect(isRecipeListRequest("how many recipes do I have?")).toBe(true);
    expect(isRecipeListRequest("list my recipes")).toBe(true);
    expect(isRecipeListRequest("list all of my recipes please")).toBe(true);
    expect(isRecipeListRequest("what recipes do i have")).toBe(true);
    expect(isRecipeListRequest("show me all my recipes")).toBe(true);
    expect(isRecipeListRequest("show me the recipes")).toBe(true);
    expect(isRecipeListRequest("what recipes have i saved")).toBe(true);
    expect(isRecipeListRequest("see my recipes")).toBe(true);
    expect(isRecipeListRequest("view all recipes")).toBe(true);
    expect(isRecipeListRequest("give me my recipes")).toBe(true);
    expect(isRecipeListRequest("what's in my recipe collection")).toBe(true);
    expect(isRecipeListRequest("my recipe list")).toBe(true);
  });

  it("does not flag a specific single-recipe request", () => {
    expect(isRecipeListRequest("give me my chicken soup recipe")).toBe(false);
    expect(isRecipeListRequest("do you have my mom's recipe for laksa?")).toBe(false);
  });

  it("does not flag unrelated text", () => {
    expect(isRecipeListRequest("make it vegetarian")).toBe(false);
    expect(isRecipeListRequest("can you give me a grocery list")).toBe(false);
  });
});
