window.TINGS_SUPABASE = {
  url: 'https://ragqunnuxsfwhrfqpylg.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJhZ3F1bm51eHNmd2hyZnFweWxnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3MzM3NTEsImV4cCI6MjEwMTMwOTc1MX0.Y-1ibC7kLj6aJnmFUPgm60hS6acDcwIPuNNo1ByQERk'
};

/* One Supabase client per page. Older feature modules may still call
   supabase.createClient(), so the compatibility wrapper returns this shared
   client whenever they request this shop's public project. */
(() => {
  if (!window.supabase?.createClient) return;
  const createClient = window.supabase.createClient.bind(window.supabase);
  window.TingsDb ??= createClient(window.TINGS_SUPABASE.url, window.TINGS_SUPABASE.anonKey);
  if (window.__tingsSharedClientFactory) return;
  window.__tingsSharedClientFactory = true;
  window.supabase.createClient = (url, anonKey, options) => (
    url === window.TINGS_SUPABASE.url && anonKey === window.TINGS_SUPABASE.anonKey
      ? window.TingsDb
      : createClient(url, anonKey, options)
  );
})();
