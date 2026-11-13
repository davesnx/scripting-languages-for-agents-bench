import { handleWebhook } from "../src/webhook.js";

const result = handleWebhook({ body: '{"type":"paid","id":"evt_1"}' });
if (result.id !== "evt_1") throw new Error("wrong id");
