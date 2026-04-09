import { functions } from './appwrite';
import type { FunctionEnvelope } from './models';
import { safeJsonParse } from './utils';

export async function executeFunction<TInput extends object, TOutput>(
  functionId: string,
  body: TInput,
  pathName = '/',
) {
  const execution = await functions.createExecution(
    functionId,
    JSON.stringify(body),
    false,
    pathName,
    'POST',
    { 'content-type': 'application/json' },
  );

  const parsed = safeJsonParse<FunctionEnvelope<TOutput>>(
    execution.responseBody || '{"ok":false,"error":"Function returned an empty response."}',
    { ok: false, error: 'Function returned an unreadable response.' },
  );

  if (execution.responseStatusCode >= 400 || !parsed.ok || !parsed.data) {
    throw new Error(parsed.error || execution.responseBody || execution.errors || 'Function execution failed.');
  }

  return parsed.data;
}
