const ACTION_RE = /(1 Item Test|5 Item Test|Delete Website Tests|Facebook Test|TikTok Test|Delete Facebook|Delete TikTok)/i;

const showOraActionToast = (message: string) => {
  let el = document.getElementById('ora-action-feedback-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ora-action-feedback-toast';
    Object.assign(el.style, {
      position: 'fixed',
      right: '18px',
      bottom: '18px',
      zIndex: '999999',
      padding: '10px 14px',
      borderRadius: '10px',
      background: '#111827',
      color: '#fff',
      fontSize: '13px',
      fontWeight: '700',
      boxShadow: '0 10px 30px rgba(0,0,0,.28)',
      pointerEvents: 'none',
      opacity: '0',
      transition: 'opacity .12s ease',
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.style.opacity = '1';
  window.setTimeout(() => { if (el) el.style.opacity = '0'; }, 2200);
};

if (typeof document !== 'undefined') {
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest?.('button') as HTMLButtonElement | null;
    if (!button) return;
    const label = String(button.textContent || '').replace(/\s+/g, ' ').trim();
    if (!ACTION_RE.test(label)) return;
    showOraActionToast(`${label} • Working…`);
  }, true);
}

export {};
