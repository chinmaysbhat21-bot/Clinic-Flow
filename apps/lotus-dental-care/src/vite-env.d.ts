/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BOOKING_WIDGET_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
