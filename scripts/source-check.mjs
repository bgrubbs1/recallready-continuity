import { checkPublicSource } from '../src/public-source.mjs';

// Invoking this dedicated command is explicit opt-in to one fixed public GET.
// No response is saved, and no case/catalog module or storage is loaded.
try {
  if (process.argv.length !== 2) throw new Error('This fixed-source command accepts no arguments.');
  console.log(JSON.stringify(await checkPublicSource({ enabled: true }), null, 2));
} catch (error) {
  console.error(JSON.stringify({ verificationStatus: 'not_verified', error: error.message }));
  process.exitCode = 1;
}
