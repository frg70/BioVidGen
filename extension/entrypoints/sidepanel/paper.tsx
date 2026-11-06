import type { ComponentChildren } from 'preact';
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

interface Actions {
  onEnterDoi: (raw: string) => boolean;
  onClearDoi: () => void;
}

/** For journals the extension cannot read (ADR-0011) and pages that give no usable DOI. */
function ManualDoi({ onEnterDoi, focusOnMount }: { onEnterDoi: Actions['onEnterDoi']; focusOnMount: boolean }) {
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusOnMount) input.current?.focus();
  }, [focusOnMount]);
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (onEnterDoi(value)) return;
        setInvalid(true);
        input.current?.focus();
      }}
    >
      <label for="manual-doi">{t('panelManualLabel')}</label>{' '}
      <input
        ref={input}
        id="manual-doi"
        type="text"
        autocomplete="off"
        spellcheck={false}
        value={value}
        aria-invalid={invalid}
        aria-describedby={invalid ? 'manual-doi-error' : undefined}
        onInput={(event) => {
          setValue(event.currentTarget.value);
          setInvalid(false);
        }}
      />{' '}
      <button type="submit">{t('panelManualSubmit')}</button>
      {invalid ? (
        <p id="manual-doi-error" role="alert">
          {t('panelManualInvalid')}
        </p>
      ) : null}
    </form>
  );
}

function Article({ page, onEnterDoi, onClearDoi, focusForm }: { page: PageContext; focusForm: boolean } & Actions) {
  // A DOI found only in page text is not certain: the student confirms it, the tool does not guess (OP1 plan §9).
  const options = page.doiSource === 'regex' && page.doi ? [page.doi] : page.candidates;
  const [picked, setPicked] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [returnFocus, setReturnFocus] = useState(false);
  const manual = page.doiSource === 'manual';
  useEffect(() => {
    if (returnFocus || manual) heading.current?.focus();
    setReturnFocus(false);
  }, [returnFocus, manual]);

  const doi = page.doiSource === 'regex' ? picked : (page.doi ?? picked);
  const hasId = Boolean(doi || page.pmid || page.pmcid);
  return (
    <section>
      <h2 ref={heading} tabIndex={-1}>
        {page.title ?? t(manual ? 'panelManualTitle' : 'panelUntitled')}
      </h2>
      <dl>
        {doi ? <Field label={t('panelDoi')} value={doi} /> : null}
        {page.version ? <Field label={t('panelVersion')} value={String(page.version)} /> : null}
        {page.pmid ? <Field label={t('panelPmid')} value={page.pmid} /> : null}
        {page.pmcid ? <Field label={t('panelPmcid')} value={page.pmcid} /> : null}
      </dl>
      {manual ? (
        <p>
          {t('panelManualNote')}{' '}
          <button type="button" onClick={onClearDoi}>
            {t('panelManualChange')}
          </button>
        </p>
      ) : null}
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
      {!hasId && options.length === 0 ? <p>{t('panelNoId')}</p> : null}
      {!hasId ? <ManualDoi onEnterDoi={onEnterDoi} focusOnMount={focusForm} /> : null}
    </section>
  );
}

/** Everything in here is local to one page: PaperView remounts it when the student navigates. */
function PageBody({ state, onEnterDoi, onClearDoi }: { state: PanelState } & Actions) {
  const { page } = state;
  const [cleared, setCleared] = useState(false);
  const clear = () => {
    setCleared(true); // focus goes back to the field
    onClearDoi();
  };
  if (page?.kind === 'article') return <Article key={page.url} page={page} onEnterDoi={onEnterDoi} onClearDoi={clear} focusForm={cleared} />;
  if (page?.kind === 'result_list') return <p>{t('panelList', String(page.resultIds.length))}</p>;
  return (
    <>
      <p>{t('panelEmpty')}</p>
      {state.tabId !== null ? <ManualDoi onEnterDoi={onEnterDoi} focusOnMount={cleared} /> : null}
    </>
  );
}

export function PaperView({ state, onEnterDoi, onClearDoi, children }: { state: PanelState; children?: ComponentChildren } & Actions) {
  return (
    <main>
      <h1>{t('panelTitle')}</h1>
      <PageBody key={state.navigation} state={state} onEnterDoi={onEnterDoi} onClearDoi={onClearDoi} />
      {children}
    </main>
  );
}
