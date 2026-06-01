const required = [
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "DATABASE_URL",
  "SCOPES",
  "NODE_ENV",
];

const rows = [
  ...required.map((key) => ({
    key,
    present: Boolean(process.env[key]),
  })),
  {
    key: "SHOPIFY_APP_URL_OR_HOST",
    present: Boolean(process.env.SHOPIFY_APP_URL || process.env.HOST),
  },
];

const missing = rows.filter((row) => !row.present).map((row) => row.key);

console.table(rows.map(({ key, present }) => ({
  key,
  present,
})));
if (missing.length > 0) {
  console.error(`Missing required env vars: ${missing.join(", ")}`);
  process.exit(1);
}

console.log("Environment looks ready.");
