import { ACTION_NAMES, dispatch, type ActionName } from '@/lib/actions';
import { body, fail, json, ready } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Row-action buttons in the grids. The human is the approver, so actor = 'user'. */
export async function POST(req: Request) {
  try {
    await ready();
    const { action, args } = await body<{ action?: string; args?: unknown }>(req);
    if (!action || !ACTION_NAMES.includes(action as ActionName)) return json({ error: `Unknown action ${action}` }, 400);
    const result = await dispatch(action as ActionName, args, 'user');
    return json(result, result.status === 'error' ? 422 : 200);
  } catch (e) {
    return fail(e);
  }
}
