import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

export async function loader({ params }: LoaderFunctionArgs) {
  const id = params.id ?? "";
  return redirect(`/app/products/${encodeURIComponent(decodeURIComponent(id))}/recovery`);
}

export default function ProductRedirect() {
  return null;
}
