import { useEffect, useRef, useState } from 'preact/hooks';
import type { PageContext } from '../../src/contracts/page-context';
import { t } from '../../src/core/i18n';
import type { PanelState } from '../../src/detect/panel-tracker';

/** VW1 header. Page strings render as text, never as HTML (rule 3). */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Article({ page }: { page: PageContext }) {
  // A DOI found only in page text is not certain: the student confirms it, the tool does not guess (OP1 plan §9).
  const options = page.doiSource === 'regex' && page.doi ? [page.doi] : page.candidates;
  const [picked, setPicked] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [returnFocus, setReturnFocus] = useState(false);
  useEffect(() => {
    if (returnFocus) heading.current?.focus();
    setReturnFocus(false);
  }, [returnFocus]);

  const doi = page.doiSource === 'regex' ? picked : (page.doi ?? picked);
  return (
    <section>
      <h2 ref={heading} tabIndex={-1}>
        {page.title ?? t('panelUntitled')}
      </h2>
      <dl>
        {doi ? <Field label={t('panelDoi')} value={doi} /> : null}
        {page.version ? <Field label={t('panelVersion')} value={String(page.version)} /> : null}
        {page.pmid ? <Field label={t('panelPmid')} value={page.pmid} /> : null}
        {page.pmcid ? <Field label={t('panelPmcid')} value={page.pmcid} /> : null}
      </dl>
      {!doi && options.length > 0 ? (
        <div role="group" aria-labelledby="pick-label">
          <p id="pick-label">{t('panelPick')}</p>
          <ul>
            {options.map((option) => (
              <li key={option}>
                <button
                  type="button"
                  onClick={() => {
                    setPicked(option);
                    setReturnFocus(true);
                  }}
                >
                  {option}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {!doi && !page.pmid && !page.pmcid && options.length === 0 ? <p>{t('panelNoId')}</p> : null}
    </section>
  );
}

export function PaperView({ state }: { state: PanelState }) {
  const { page } = state;
  return (
    <main>
      <h1>{t('panelTitle')}</h1>
      {/* keyed by URL: a choice made for one paper must not carry over to the next */}
      {page?.kind === 'article' ? <Article key={page.url} page={page} /> : null}
      {page?.kind === 'result_list' ? <p>{t('panelList', String(page.resultIds.length))}</p> : null}
      {!page || page.kind === 'other' ? <p>{t('panelEmpty')}</p> : null}
    </main>
  );
}
