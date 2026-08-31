/**
 * What the deployment has to declare for the native build sandbox.
 *
 * The controls that stop a fork bomb, an out-of-memory bomb and a tool phoning
 * home are not in the PHP — they are namespaces and limits the container
 * runtime applies, and they exist only because the Compose file asks for them.
 * Deleting one line there silently removes a control the code cannot replace,
 * so the file is read as a contract rather than trusted as configuration.
 *
 * BLD-305 asks for network attempts and fork bombs to be covered. Below the
 * container there is nowhere to stand: a test that tried to open a socket from
 * PHP would prove only what the machine running the test allows.
 */

/**
 * The lines of one service in a Compose file, with its own indentation removed.
 *
 * @param {string} text the whole Compose document
 * @param {string} name the service to read
 * @returns {string[]}
 */
export function serviceBlock(text, name) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trimEnd() === `  ${name}:`);
  if (start === -1) throw new Error(`compose.yaml declares no service named ${name}.`);
  const block = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    /* A line indented two spaces or less starts the next service. */
    if (!/^ {4}/.test(line)) break;
    block.push(line.slice(4));
  }
  return block;
}

/** A scalar `key: value` at the top level of a service block, or null. */
export function scalar(block, key) {
  const line = block.find((entry) => new RegExp(`^${key}:`).test(entry));
  if (line === undefined) return null;
  return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '');
}

/** The items of a `key:` list at the top level of a service block. */
export function list(block, key) {
  const start = block.findIndex((entry) => entry.trimEnd() === `${key}:`);
  if (start === -1) return [];
  const items = [];
  for (const entry of block.slice(start + 1)) {
    if (!entry.startsWith('  - ') && !entry.startsWith('- ')) break;
    items.push(entry.replace(/^\s*-\s*/, '').trim().replace(/^["']|["']$/g, ''));
  }
  return items;
}

/**
 * Every way the declared sandbox falls short, said in full sentences.
 *
 * @param {string[]} block the service block to audit
 * @returns {string[]} empty when the sandbox is declared as it must be
 */
export function auditSandbox(block) {
  const problems = [];

  if (scalar(block, 'network_mode') !== 'none') {
    problems.push('The builder must declare network_mode: none, or a tool it runs can reach the network.');
  }
  if (scalar(block, 'read_only') !== 'true') {
    problems.push('The builder must declare read_only: true, so a tool cannot alter the image it runs from.');
  }
  const user = scalar(block, 'user');
  if (user === null || user.startsWith('0:') || user === '0' || user === 'root') {
    problems.push('The builder must run as an unprivileged user, and it declares '+(user ?? 'none')+'.');
  }
  if (!list(block, 'cap_drop').includes('ALL')) {
    problems.push('The builder must drop every capability, or it keeps privileges no assembler needs.');
  }
  if (!list(block, 'security_opt').includes('no-new-privileges:true')) {
    problems.push('The builder must declare no-new-privileges:true, or a setuid binary regains what cap_drop removed.');
  }

  const pids = Number(scalar(block, 'pids_limit'));
  if (!Number.isInteger(pids) || pids <= 0 || pids > 512) {
    problems.push('The builder must cap its process count between 1 and 512, which is what stops a fork bomb.');
  }
  const memory = scalar(block, 'mem_limit');
  if (memory === null || !/^\d+[mg]$/i.test(memory)) {
    problems.push('The builder must cap its memory, which is what stops an allocation bomb.');
  }
  const cpus = Number(scalar(block, 'cpus'));
  if (!Number.isFinite(cpus) || cpus <= 0) {
    problems.push('The builder must cap its processor share, or one build can starve every other.');
  }

  const scratch = list(block, 'tmpfs').find((entry) => entry.startsWith('/tmp:'));
  if (scratch === undefined) {
    problems.push('The builder must mount /tmp as tmpfs, because that is where a build writes and read_only forbids the rest.');
  } else {
    for (const option of ['noexec', 'nosuid', 'nodev']) {
      if (!scratch.includes(option)) {
        problems.push(`The builder's /tmp must be mounted ${option}, or a tool can escalate through what it writes there.`);
      }
    }
    if (!/size=\d+[mg]/i.test(scratch)) {
      problems.push("The builder's /tmp must be given a size, or a build can fill the host's memory by writing to it.");
    }
  }

  return problems;
}
