/// <reference types="@remix-run/node" />
/// <reference types="vite/client" />

// Polaris ships its stylesheet which we import with Vite's `?url` suffix.
declare module "*.css?url" {
  const url: string;
  export default url;
}
