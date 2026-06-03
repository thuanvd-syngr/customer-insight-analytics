# Internal Testing Deploy Guide — Customer Insight Analytics

## Why two configs?

| Config | Purpose | Deploy status |
|---|---|---|
| `shopify.app.production.toml` | App Store release | Blocked until Protected Customer Data approval |
| `shopify.app.dev.toml` | Internal / development store testing | Deployable now |

The production config has GDPR compliance webhooks (`customers/data_request`,
`customers/redact`, `shop/redact`). Once those topics are associated with an app,
Shopify requires completing the Protected Customer Data declaration in the Partner
Dashboard before any new version can be released — even if the topics are later
removed from the config. The dev config omits those topics entirely so deploys
succeed without the approval gate.

---

## Deploy for internal testing

Run from a **Node 22** environment:

```bash
nvm use 22
npx @shopify/cli@4.1.0 app deploy \
  --config shopify.app.dev.toml \
  --allow-updates
```

Or run the full validation + deploy sequence:

```bash
# Node 18 for typecheck / test / build
nvm use 18
npm run typecheck && npm test && npm run build

# Node 22 for Shopify CLI
nvm use 22
npx @shopify/cli@4.1.0 app config validate --config shopify.app.dev.toml
npx @shopify/cli@4.1.0 app deploy --config shopify.app.dev.toml --allow-updates
```

---

## Install / re-authorize on a development store

After deploy, install or reinstall the app on your development store:

1. Go to **Shopify Partner Dashboard → Apps → Customer Insight Analytics**
2. Click **Test your app → Select store** and pick your development store
3. If the store already has the app installed, uninstall it first
   (Shopify Admin → Apps → Customer Insight → Uninstall), then reinstall to force
   the OAuth flow with the new scopes
4. Complete the OAuth install — Shopify will show the scope grant screen with
   `read_orders`, `write_products`, `read_content`, `write_content`, `read_products`

---

## Verify `read_orders` is in the granted scopes

After install, open the app and navigate to `/app/debug/shopify` (or add a temporary
log in the loader) to check the session's granted scopes:

```ts
// In any loader that has access to session:
const session = await authenticate.admin(request);
console.log("Granted scopes:", session.session.scope);
```

The logged string should include `read_orders`. If it does not, the store has the
app installed under old scopes — uninstall and reinstall to trigger re-authorization.

You can also check directly in Shopify Admin:
**Settings → Apps and sales channels → Customer Insight Analytics → Scopes**

---

## Local development (tunnel mode)

To test against a local server instead of Cloud Run:

```bash
nvm use 22
npx @shopify/cli@4.1.0 app dev --config shopify.app.dev.toml
```

The CLI will start a Cloudflare tunnel and automatically update `application_url`
and `redirect_urls` in the dev config for the session. Webhooks are registered
temporarily and cleaned up when dev mode exits.

---

## Production App Store release (after Protected Customer Data approval)

1. Complete the declaration in **Partner Dashboard → Apps → App setup →
   Protected customer data** (see `docs/shopify-review-checklist.md`)
2. Once approved, un-comment the three compliance webhook blocks in
   `shopify.app.production.toml`
3. Deploy with the production config:
   ```bash
   nvm use 22
   npx @shopify/cli@4.1.0 app deploy \
     --config shopify.app.production.toml \
     --allow-updates
   ```
