import { render } from 'preact';
import { t } from '../../src/core/i18n';

/** VW3 skeleton. Provider setup, keys and the privacy table arrive with SVC6/VW3. */
function App() {
  return (
    <main>
      <h1>{t('optionsTitle')}</h1>
      <p>{t('optionsEmpty')}</p>
    </main>
  );
}

const root = document.getElementById('app');
if (root) render(<App />, root);
