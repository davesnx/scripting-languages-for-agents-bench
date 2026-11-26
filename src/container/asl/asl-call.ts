// asl-call <function> <arguments as JSON>
//
// The ClankTalk binding of the surface: every tool of the generated
// AGENTS.talk runs this program. It hands the call to the broker and prints
// the result so that ClankTalk's { code, output } reads naturally:
//   - bash: the command's output, and its exit code;
//   - the other tools: their text; exit code 0;
//   - a refused or failed call: "refused: ..." or "error: ...", exit code 1.
//
// asl-call --tea <function> <arguments as JSON>
//
// The Dartea binding (the Surface module of teagent programs). Dartea has no
// JSON decoder, so the reply is a header line and a payload the module splits:
//   header: "ok", "refused" or "error"; exit code 0.
//   payload: bash "<exit code>\n<1 if truncated, else 0>\n<full output path>\n<seconds>\n" then the output;
//   the other tools their text as is.
import { openClient } from "./client.ts";

const argv = process.argv.slice(2);
const tea = argv[0] === "--tea";
const [fn, json] = tea ? argv.slice(1) : argv;
const say = (header: string, payload: string): never => {
  process.stdout.write(`${header}\n${payload}`);
  process.exit(0);
};
let args: Record<string, unknown> = {};
try {
  args = json ? JSON.parse(json) : {};
} catch {
  if (tea) say("error", `the arguments are not JSON: ${json}`);
  process.stdout.write(`error: the arguments are not JSON: ${json}\n`);
  process.exit(1);
}
// ClankTalk passes a missing argument as null; the surface treats null as absent.
for (const k of Object.keys(args)) if (args[k] === null) delete args[k];

const client = await openClient().catch((e: Error) => {
  if (tea) say("error", e.message);
  process.stdout.write(`error: ${e.message}\n`);
  process.exit(1);
});
const r = await client.call(fn ?? "", args);
client.close();
if (tea) teaReply();
if (!r.ok) {
  process.stdout.write(`${r.refused ? "refused" : "error"}: ${r.error}\n`);
  process.exit(1);
}
type Bash = { output: string; truncated: boolean; full_output_path?: string; exit_code: number; wall_time_seconds: number };
if (fn === "bash") {
  const b = r.value as Bash;
  process.stdout.write(b.output);
  process.exit(b.exit_code);
}
process.stdout.write(String(r.value));

function teaReply(): never {
  if (!r.ok) return say(r.refused ? "refused" : "error", r.error);
  if (fn === "bash") {
    const b = r.value as Bash;
    return say("ok", `${b.exit_code}\n${b.truncated ? 1 : 0}\n${(b.full_output_path ?? "").replace(/\n/g, " ")}\n${b.wall_time_seconds}\n${b.output}`);
  }
  return say("ok", String(r.value));
}
