const marker = process.env.STATE_M1A_PROBE_MARKER;
if (!/^(?:alpha|beta):[1-9][0-9]*:[1-9][0-9]*$/.test(marker ?? '')) {
  throw new Error('M1A_SYNTHETIC_POST_STATE_REFUSED');
}
process.stdout.write(`M1A_PROBE_POST ${marker}\n`);
