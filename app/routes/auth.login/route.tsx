import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { Button, Card, Page, TextField } from "@shopify/polaris";
import { AppProvider } from "@shopify/shopify-app-remix/react";

import { login } from "~/shopify.server";
import { loginErrorMessage } from "./error.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  if (shop) {
    // Arrived via /auth/reauthorize or a direct link — login() will read the
    // shop param from the URL and redirect to Shopify OAuth automatically.
    console.info("[auth.login] received shop param, initiating OAuth", { shop });
  }
  const errors = await login(request);
  // login() throws a redirect to Shopify OAuth when shop is present and valid.
  // Reaching here means shop was missing or invalid — show the manual form.
  return json({ error: loginErrorMessage(errors) });
}

export async function action({ request }: ActionFunctionArgs) {
  const errors = await login(request);
  return json({ error: loginErrorMessage(errors) });
}

export default function Login() {
  const { error } = useLoaderData<typeof loader>();
  return (
    <AppProvider apiKey="" isEmbeddedApp={false}>
      <Page title="Log in">
        <Card>
          <Form method="post">
            <TextField label="Shop" name="shop" autoComplete="off" error={error ?? undefined} />
            <div style={{ marginTop: 16 }}>
              <Button submit variant="primary">Log in</Button>
            </div>
          </Form>
        </Card>
      </Page>
    </AppProvider>
  );
}
