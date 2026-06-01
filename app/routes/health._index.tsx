import { json } from "@remix-run/node";

import { getHealth } from "~/lib/health.server";

export function loader() {
  return json(getHealth());
}
