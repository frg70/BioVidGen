import { useEffect, useRef, useState } from 'preact/hooks';
import type { BackendCode } from '../../src/backend/client';
import { t } from '../../src/core/i18n';

/** What the panel knows about the local backend. */
export type BackendView = 'checking' | 'paired' | BackendCode;

interface Props {
  view: BackendView;
  extensionId: string;
  /** True once the student has acted, so the next state may take focus. Opening the panel never does. */
  moveFocus: boolean;
  onRetry: () => void;
  onPair: (token: string) => void;
}

function Retry({ moveFocus, onRetry }: Pick<Props, 'moveFocus' | 'onRetry'>) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (moveFocus) button.current?.focus();
  }, [moveFocus]);
  return (
    <button ref={button} type="button" onClick={onRetry}>
      {t('backendRetry')}
    </button>
  );
}

function PairForm({ view, moveFocus, onPair }: Pick<Props, 'view' | 'moveFocus' | 'onPair'>) {
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (moveFocus) input.current?.focus();
  }, [moveFocus]);
  const error = view === 'BAD_TOKEN_FORMAT' ? t('backendBadToken') : view === 'TOKEN_REJECTED' ? t('backendRejected') : null;
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onPair(value);
        setValue(''); // the code does not stay in the page
        input.current?.focus(); // a keyboard user can correct it right away
      }}
    >
      <p>{t('backendPairHelp')}</p>
      <label for="pair-token">{t('backendPairLabel')}</label>{' '}
      <input
        ref={input}
        id="pair-token"
        type="password"
        autocomplete="off"
        spellcheck={false}
        value={value}
        aria-invalid={error !== null}
        aria-describedby={error ? 'pair-token-error' : undefined}
        onInput={(event) => setValue(event.currentTarget.value)}
      />{' '}
      <button type="submit">{t('backendPairSubmit')}</button>
      {error ? (
        <p id="pair-token-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/** Backend state in the side panel. Detection and manual DOI work without it, so it never blocks them. */
export function BackendStatus({ view, extensionId, moveFocus, onRetry, onPair }: Props) {
  if (view === 'checking') return <p role="status">{t('backendChecking')}</p>;
  if (view === 'paired') return <p role="status">{t('backendPaired')}</p>;
  if (view === 'BACKEND_OFF' || view === 'WRONG_ORIGIN') {
    return (
      <section>
        <p role="status">{view === 'BACKEND_OFF' ? t('backendOff') : t('backendWrongOrigin', extensionId)}</p>
        <Retry moveFocus={moveFocus} onRetry={onRetry} />
      </section>
    );
  }
  return <PairForm view={view} moveFocus={moveFocus} onPair={onPair} />;
}
