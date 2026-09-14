/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public URL of the Cloudflare Worker write API, e.g. https://uri-amiram-archive-api.<account>.workers.dev */
  readonly VITE_WRITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
