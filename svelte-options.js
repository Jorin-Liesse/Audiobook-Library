import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit/vite').Config} */
export default {
  adapter: adapter({
    pages: 'dist',
    assets: 'dist',
    fallback: '404.html'
  }),
  paths: {
    base: '/Audiobook-Library'
  },
  prerender: {
    entries: ['*']
  }
};
