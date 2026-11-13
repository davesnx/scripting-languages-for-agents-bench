export function handleWebhook(request) {
  const event = JSON.parse(request.body);
  return { type: event.type, id: event.id };
}
