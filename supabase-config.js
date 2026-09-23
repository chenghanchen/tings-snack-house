window.TINGS_SUPABASE = {
  url: "https://ragqunnuxsfwhrfqpylg.supabase.co",
  anonKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJhZ3F1bm51eHNmd2hyZnFweWxnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3MzM3NTEsImV4cCI6MjEwMTMwOTc1MX0.Y-1ibC7kLj6aJnmFUPgm60hS6acDcwIPuNNo1ByQERk",
};

/* One Supabase client per page. Older feature modules may still call
   supabase.createClient(), so the compatibility wrapper returns this shared
   client whenever they request this shop's public project. */
(() => {
  if (!window.supabase?.createClient) return;
  const createClient = window.supabase.createClient.bind(window.supabase);
  // Route only the storefront's explicit customer OAuth return, never admin URLs.
  window.TingsCustomerOAuthReturn = window.location.pathname === '/' &&
    new URLSearchParams(window.location.search).get('customer_oauth') === 'google';
  // Customer auth deliberately has a different storage namespace from owner auth.
  // Use the original factory: the legacy compatibility wrapper ignores options.
  window.createTingsCustomerClient = () => (window.TingsCustomerDb ??= createClient(
    window.TINGS_SUPABASE.url, window.TINGS_SUPABASE.anonKey,
    { auth: { storageKey: "tings-customer-auth-v1", persistSession: true,
      autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' } },
  ));
  window.TingsDb ??= createClient(
    window.TINGS_SUPABASE.url,
    window.TINGS_SUPABASE.anonKey,
    // Customer code exchange must never populate the owner's auth namespace.
    window.TingsCustomerOAuthReturn ? { auth: { detectSessionInUrl: false } } : undefined,
  );
  if (window.__tingsSharedClientFactory) return;
  window.__tingsSharedClientFactory = true;
  window.supabase.createClient = (url, anonKey, options) =>
    url === window.TINGS_SUPABASE.url &&
    anonKey === window.TINGS_SUPABASE.anonKey
      ? window.TingsDb
      : createClient(url, anonKey, options);

  /* Keep the shared order-alert channel singleton while admin modules initialize. */
  const channel = window.TingsDb.channel.bind(window.TingsDb);
  const subscribedChannels = new Set();
  const ignoredChannel = {
    on() {
      return ignoredChannel;
    },
    subscribe() {
      return ignoredChannel;
    },
  };
  window.TingsDb.channel = (name, options) => {
    if (name === "order-alert-v2" && subscribedChannels.has(name))
      return ignoredChannel;
    if (name === "order-alert-v2") subscribedChannels.add(name);
    return channel(name, options);
  };
})();
