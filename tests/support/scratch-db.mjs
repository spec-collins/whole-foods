/**
 * Guard for the suites that DROP and recreate tables.
 *
 * These tests are destructive, so they must never be able to reach the
 * production database. There is deliberately no fallback to DATABASE_URL:
 * TEST_DATABASE_URL has to be set on purpose, which means a production
 * DATABASE_URL sitting in the environment cannot be picked up by accident.
 *
 * A non-local host additionally requires ALLOW_NONLOCAL_TEST_DB=1, so pointing
 * at a hosted database takes two deliberate acts rather than one slip.
 */

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function useScratchDatabase() {
  const url = process.env.TEST_DATABASE_URL;

  if (!url) {
    console.error(
      'TEST_DATABASE_URL is not set.\n\n' +
      'This suite drops and recreates its tables, so it will not fall back to\n' +
      'DATABASE_URL -- that would risk wiping production. Point it at a scratch\n' +
      'database instead:\n\n' +
      '  export TEST_DATABASE_URL=postgres://wf:wfpass@127.0.0.1:5432/wf_vendor\n\n' +
      'See tests/README.md for a local Postgres recipe.'
    );
    process.exit(1);
  }

  const host = hostOf(url);
  if (!LOCAL_HOSTS.has(host) && process.env.ALLOW_NONLOCAL_TEST_DB !== '1') {
    console.error(
      `TEST_DATABASE_URL points at "${host}", which is not local.\n\n` +
      'These tests drop tables. If that host really is a throwaway database and\n' +
      'not production, re-run with ALLOW_NONLOCAL_TEST_DB=1 to confirm.'
    );
    process.exit(1);
  }

  // Overwrite both names the app reads, so nothing downstream can resolve back
  // to a production connection string left in the environment.
  process.env.DATABASE_URL = url;
  delete process.env.POSTGRES_URL;

  return url;
}
