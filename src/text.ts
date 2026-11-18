/** Cuts text longer than max in the middle, and says how much was cut. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const half = Math.floor(max / 2);
  return `${text.slice(0, half)}\n... ${text.length - max} characters cut ...\n${text.slice(-half)}`;
}
