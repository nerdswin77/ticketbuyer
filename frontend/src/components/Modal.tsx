import { useEffect, useRef, type ReactNode } from 'react';

let openModals = 0;

/**
 * Accessible dialog. While any modal is open the page behind it is scroll-locked and its
 * decorative animations are paused (body.modal-open), which keeps the dialog steady.
 */
export function Modal({
  title,
  onClose,
  children,
  wide = false,
  hideTitle = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  hideTitle?: boolean;
}) {
  // Keep the latest onClose without re-binding listeners on every parent render.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    window.addEventListener('keydown', onKey);
    openModals += 1;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    document.body.classList.add('modal-open');
    document.body.style.paddingRight = scrollbar > 0 ? `${scrollbar}px` : '';
    const previouslyFocused = document.activeElement as HTMLElement | null;
    boxRef.current?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      openModals -= 1;
      if (openModals === 0) {
        document.body.classList.remove('modal-open');
        document.body.style.paddingRight = '';
      }
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, []);

  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && closeRef.current()}>
      <div
        ref={boxRef}
        tabIndex={-1}
        className={`modal-box ${wide ? 'modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className={`modal-head ${hideTitle ? 'modal-head-float' : ''}`}>
          {!hideTitle && <h3>{title}</h3>}
          <button className="link" onClick={() => closeRef.current()} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
