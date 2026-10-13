/**
 * One editor per project. Tabs of the web Maker share one store, so two of
 * them editing the same project would autosave over each other; a lock per
 * project, held while it is open, keeps it to one. The browser drops a tab's
 * locks when the tab closes, crashes included.
 *
 * Browsers without the Web Locks API go without the guard.
 */

let held: { id: string; release: () => void } | null = null;

const lockName = (id: string) => `typepal-project:${id}`;

/** Takes the project for this tab, giving up the one held before; false if
 *  another tab or window has it open. */
export async function claimProject(id: string): Promise<boolean> {
  if (held?.id === id) return true;
  releaseProject();
  if (!navigator.locks) return true;
  return new Promise((resolve) => {
    void navigator.locks.request(lockName(id), { ifAvailable: true }, (lock) => {
      if (!lock) return resolve(false);
      // Held until released: the lock lasts as long as this promise.
      return new Promise<void>((release) => {
        held = { id, release };
        resolve(true);
      });
    });
  });
}

export function releaseProject() {
  held?.release();
  held = null;
}

/** Whether another tab or window has the project open. */
export async function openElsewhere(id: string): Promise<boolean> {
  if (!navigator.locks || held?.id === id) return false;
  const { held: locks = [] } = await navigator.locks.query();
  return locks.some((lock) => lock.name === lockName(id));
}

/** Runs `change` with no other tab changing the list of projects meanwhile. */
export function withDraftList<T>(change: () => Promise<T>): Promise<T> {
  return navigator.locks ? navigator.locks.request("typepal-draft-list", change) : change();
}
