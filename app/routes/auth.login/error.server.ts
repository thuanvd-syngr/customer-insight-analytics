import type { LoginError } from "@shopify/shopify-app-remix/server";

export function loginErrorMessage(errors: LoginError | undefined): string | null {
  if (!errors?.shop) return null;
  if (errors.shop === "MISSING_SHOP") return "Enter a shop domain.";
  if (errors.shop === "INVALID_SHOP") return "Enter a valid myshopify.com domain.";
  return "Unable to log in.";
}
