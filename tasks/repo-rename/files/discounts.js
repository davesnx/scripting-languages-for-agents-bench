export function bulkDiscount(items) {
  const count = items.reduce((n, item) => n + item.qty, 0);
  return count >= 10 ? 0.05 : 0;
}
