import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { listSessions } from '../db';
import { lookupStalePistes } from './pistes';

/**
 * Looks up missing piste names while the app is closed. Android runs it every
 * 15 minutes or more (when online and the battery isn't low; the OS picks the
 * time). Defined at module scope and imported from the root layout, so it exists
 * when Android starts the app headless to run it.
 */
export const PISTES_TASK = 'piste-lookup';

if (!TaskManager.isTaskDefined(PISTES_TASK)) {
  TaskManager.defineTask(PISTES_TASK, async () => {
    try {
      // A few days per run: each can take a minute or more, and the OS limits a run's time.
      await lookupStalePistes(await listSessions(), 3);
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export function registerPistesTask(): Promise<void> {
  return BackgroundTask.registerTaskAsync(PISTES_TASK, { minimumInterval: 15 });
}
