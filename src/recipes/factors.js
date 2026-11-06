/**
 * Dependency planning, not provider execution. Reachability determines which expensive window
 * statistics are needed.
 * @module factors
 */
import { compileRecipes, recipeRoots } from "./recipes.js";
export * from "./factor-catalog.js";
/**
 * Expose reachable provider families to cost prediction. The actual provider uses the detailed
 * program plan so custom entropy windows do not also request an unused default window.
 */
export function requiredFactors(configuration, appearance, shaders = []) {
  const roots = recipeRoots(configuration, appearance);
  const program = compileRecipes(roots, configuration.recipes);
  const used = new Set(program.required);
  if (program.providers.byte) used.add("value");
  if (program.providers.entropy.size) used.add("entropy");
  for (const kind of program.providers.spectrum) used.add(kind);
  if (shaders.includes("character") || shaders.includes("hex"))
    used.add("value");
  return used;
}
