import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";

import styles from "./styles.module.css";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    return redirect(`/app?${url.searchParams.toString()}`);
  }
  return json({ appName: "Customer Insight Analytics" });
}

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const shop = String(form.get("shop") ?? "");
  return redirect(`/auth/login?shop=${encodeURIComponent(shop)}`);
}

export default function Index() {
  const { appName } = useLoaderData<typeof loader>();
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <h1>{appName}</h1>
        <p>Find why customers do not buy with fast rule-based insight reports.</p>
        <Form method="post" className={styles.form}>
          <input name="shop" placeholder="your-store.myshopify.com" />
          <button type="submit">Log in</button>
        </Form>
      </section>
    </main>
  );
}
