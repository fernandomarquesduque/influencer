const KEY_PREFIX = 'busca:subscription-cancelled:'

export function subscriptionCancelledStorageKey(userId: number): string {
  return `${KEY_PREFIX}${userId}`
}

export function isSubscriptionCancelledLocally(userId: number): boolean {
  try {
    return sessionStorage.getItem(subscriptionCancelledStorageKey(userId)) != null
  } catch {
    return false
  }
}

export function markSubscriptionCancelledLocally(userId: number): void {
  try {
    sessionStorage.setItem(subscriptionCancelledStorageKey(userId), String(Date.now()))
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearSubscriptionCancelledLocally(userId: number): void {
  try {
    sessionStorage.removeItem(subscriptionCancelledStorageKey(userId))
  } catch {
    /* ignore */
  }
}
