/* Called once when the dashboard's server starts (Next.js instrumentation): say in the terminal what Start runs. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startupLine } = await import('./lib/startup-line.ts');
  console.log(startupLine());
}
