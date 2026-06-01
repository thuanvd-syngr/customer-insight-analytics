import { json } from "@remix-run/node";

import { getConfigHealth } from "~/lib/health.server";

export function loader() {
  return json(getConfigHealth());
}
