// Only a server-verified user may own an order. Never trust a body user_id or
// decode a JWT without verification; invalid sessions must not become guests.
export async function resolveCustomerIdentity(authorization, anonKey, verifyUser) {
  if (!anonKey) throw new Error('AUTH_NOT_CONFIGURED');
  const token = /^Bearer\s+(\S+)$/i.exec(authorization || '')?.[1];
  if (!token) throw new Error('AUTH_REQUIRED');
  if (token === anonKey) return null;
  const { data, error } = await verifyUser(token);
  if (error || !data?.user?.id || !data.user.email_confirmed_at || data.user.is_anonymous)
    throw new Error('AUTH_REQUIRED');
  return data.user.id;
}
