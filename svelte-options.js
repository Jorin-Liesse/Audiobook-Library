import adapter from '@sveltejs/adapter-static';

const native = process.env.TAURI_ENV_PLATFORM !== undefined || process.env.TAURI_APP === '1';

/** @type {import('@sveltejs/kit/vite').Config} */
export default {
  adapter: adapter({
    pages: 'build',
    assets: 'build',
    fallback: native ? undefined : '404.html'
  }),
  paths: {
    base: native ? '' : '/Audiobook-Library'
  },
  serviceWorker: { register: !native },
  prerender: {
    entries: ['*']
  }
};
