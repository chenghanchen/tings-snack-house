// Only a server-verified user may own an order. Never trust a body user_id or
// decode a JWT without verification; invalid sessions must not become guests.
export function normalizeCustomerPhone(value) {
  const raw = String(value ?? '').trim();
  if (!/^\+?[0-9()\s.-]+$/.test(raw)) return null;
  let digits = raw.replace(/[^0-9]/g, '');
  if (raw.startsWith('+') && !(digits.length === 11 && digits.startsWith('1'))) return null;
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return digits.length === 10 ? digits : null;
}

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
