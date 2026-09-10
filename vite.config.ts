import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig, type Plugin } from 'vite';
import { sites } from '@openai/sites-vite-plugin';
export default defineConfig(async () => {
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';
  const { cloudflare } = await import('@cloudflare/vite-plugin');
  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    plugins: [vinext(), sites(), cloudflare({ viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] } }), {
      name: 'exclude-local-preview-secrets',
      apply: 'build',
      enforce: 'post',
      generateBundle(_options, bundle) {
        // Cloudflare emits local secrets for preview by default. Sites uses its own secrets.
        for (const name of Object.keys(bundle)) {
          if (/(^|\/)\.(?:dev\.vars|env)(?:\.|$)/.test(name)) delete bundle[name];
        }
      },
    } satisfies Plugin],
  };
});
