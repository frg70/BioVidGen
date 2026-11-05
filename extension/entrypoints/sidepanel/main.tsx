import { render } from 'preact';
import { openDb, requestPersistence } from '../../src/core/db/index';
import { t } from '../../src/core/i18n';
import { createLogger, createMemorySink } from '../../src/core/log';
import { createDbLogSink } from '../../src/core/log-sink';

/** VW1 skeleton: empty state only. Feature views arrive with OP1/OP3/OP12 (P0 order). */
function App() {
  return (
    <main>
      <h1>{t('panelTitle')}</h1>
      <p>{t('panelEmpty')}</p>
    </main>
  );
}

const root = document.getElementById('app');
if (root) render(<App />, root);

// Composition root. IndexedDB failure falls back to memory-only logging (SVC0 plan §7);
// the banner for that state belongs to VW1.
async function boot() {
  const db = await openDb();
  if (db.ok) await requestPersistence();
  return createLogger(db.ok ? createDbLogSink(db.value) : createMemorySink());
}
void boot();
