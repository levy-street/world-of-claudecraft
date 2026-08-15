import { SCENARIO_NAMES } from './perf_hitch_store.mjs';

export const HITCH_PRESETS = Object.freeze(['low', 'medium', 'high', 'ultra', 'insane']);

function parseOptions(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const name = token.slice(2);
    if (!name || Object.hasOwn(options, name))
      throw new Error(`duplicate or empty option: ${token}`);
    if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
      index += 1;
      options[name] = argv[index];
    } else {
      options[name] = true;
    }
  }
  return { positional, options };
}

function rejectUnknown(options, allowed) {
  for (const name of Object.keys(options)) {
    if (!allowed.includes(name)) throw new Error(`unknown option: --${name}`);
  }
}

function soakDuration(raw) {
  if (raw === undefined) return null;
  const value = Number(raw);
  if (raw === true || !Number.isFinite(value) || value < 5_000 || value > 600_000) {
    throw new Error('--soak-ms must be a number from 5000 to 600000');
  }
  return Math.round(value);
}

export function buildHitchCliPlan(argv) {
  const { positional, options } = parseOptions(argv);
  const command = positional[0] ?? 'help';
  if (positional.length > 1) throw new Error(`unexpected positional argument: ${positional[1]}`);

  if (command === 'run') {
    rejectUnknown(options, ['preset', 'gate', 'scenario', 'soak-ms', 'note']);
    if (!HITCH_PRESETS.includes(options.preset)) {
      throw new Error(`--preset must be one of: ${HITCH_PRESETS.join(', ')}`);
    }
    if (options.gate !== undefined && options.gate !== true) {
      throw new Error('--gate does not take a value');
    }
    const scenario = options.scenario ?? null;
    if (scenario !== null && !SCENARIO_NAMES.includes(scenario)) {
      throw new Error(`--scenario must be one of: ${SCENARIO_NAMES.join(', ')}`);
    }
    const names = scenario ? [scenario] : [...SCENARIO_NAMES];
    const soakMs = soakDuration(options['soak-ms']);
    if (soakMs !== null && !names.includes('soak')) {
      throw new Error('--soak-ms is only valid when the soak scenario is selected or included');
    }
    if (options.note !== undefined && typeof options.note !== 'string') {
      throw new Error('--note requires a value');
    }
    return {
      command,
      preset: options.preset,
      gate: options.gate === true,
      scenario,
      names,
      soakMs,
      note: options.note ?? '',
    };
  }

  if (command === 'calibrate') {
    rejectUnknown(options, []);
    return {
      command,
      preset: 'insane',
      names: [...SCENARIO_NAMES],
      soakMs: null,
      calibrationRuns: 3,
    };
  }

  if (command === 'report' || command === 'help') {
    rejectUnknown(options, []);
    return { command };
  }
  throw new Error(`unknown command: ${command}`);
}
