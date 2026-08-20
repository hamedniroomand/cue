import type { Config } from "@react-router/dev/config"

export default {
  // Config options...
  // Server-side render by default, to enable SPA mode set this to `false`
  // SPA build: the conductor CLI serves ui/build/client statically.
  ssr: false,
} satisfies Config
