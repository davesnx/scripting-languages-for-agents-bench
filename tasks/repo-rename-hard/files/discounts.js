import { getTotal } from "../src/cart.js";

export function bulkDiscount(items) {
  const total = getTotal(items);
  return total >= 100 ? Math.round(total * 5) / 100 : 0;
}
