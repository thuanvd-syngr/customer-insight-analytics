import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { Button, Card, Page, TextField } from "@shopify/polaris";
import { AppProvider } from "@shopify/shopify-app-remix/react";

import { login } from "~/shopify.server";
import { loginErrorMessage } from "./error.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const errors = await login(request);
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
