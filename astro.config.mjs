import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
export default defineConfig({ integrations: [react(), mdx()], output: 'static', devToolbar: { enabled: false }, vite: { server: { fs: { strict: true } } } });
