export function invoiceTotal(lines) {
  let total = 0;
  for (const line of lines) {
    total += Math.round(line.net * (1 + line.taxRate));
  }
  return total;
}
