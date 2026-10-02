import adapter from '@sveltejs/adapter-static';

export default {
  kit: {
    adapter: adapter({
      pages: 'dist',
      assets: 'dist',
      fallback: '404.html'
    }),
    paths: {
      base: '/Audiobook-Library'
    },
    alias: {
      $lib: 'src/lib',
      $components: 'src/lib/components',
      $types: 'src/lib/types'
    },
    prerender: {
      entries: ['*']
    }
  }
};
