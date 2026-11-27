(() => {
  const script = document.currentScript;
  if (!(script instanceof HTMLScriptElement)) return;

  const clinicId = script.dataset.clinicId;
  if (!clinicId || !/^[a-zA-Z0-9_-]+$/.test(clinicId)) {
    console.error('[Clinic Flow] Add a valid data-clinic-id to the widget script.');
    return;
  }

  const iframeId = `clinic-flow-widget-${clinicId}`;
  if (document.getElementById(iframeId)) return;

  const widgetUrl = new URL('/embed.html', script.src);
  widgetUrl.searchParams.set('clinicId', clinicId);
  const widgetOrigin = widgetUrl.origin;
  const iframe = document.createElement('iframe');
  iframe.id = iframeId;
  iframe.title = `Appointment booking for ${clinicId}`;
  iframe.src = widgetUrl.href;
  iframe.loading = 'eager';
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  iframe.setAttribute('allow', 'payment');
  iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox');
  Object.assign(iframe.style, {
    position: 'fixed',
    width: '68px',
    height: '68px',
    right: '20px',
    bottom: '20px',
    border: '0',
    background: 'transparent',
    zIndex: '2147483000',
    overflow: 'hidden',
    colorScheme: 'light',
  });

  let isOpen = false;
  const setSize = () => {
    if (!iframe.isConnected) return;
    if (!isOpen) {
      Object.assign(iframe.style, { width: '68px', height: '68px', left: 'auto', top: 'auto', right: '20px', bottom: '20px' });
      return;
    }
    if (window.innerWidth <= 480) {
      Object.assign(iframe.style, { width: '100vw', height: '100dvh', left: '0', top: '0', right: '0', bottom: '0' });
    } else {
      Object.assign(iframe.style, { width: '390px', height: `${Math.max(420, Math.min(620, window.innerHeight - 40))}px`, left: 'auto', top: 'auto', right: '20px', bottom: '20px' });
    }
  };
  const onMessage = (event) => {
    if (event.origin !== widgetOrigin || event.source !== iframe.contentWindow) return;
    if (event.data?.type !== 'clinicflow:resize' || typeof event.data.open !== 'boolean') return;
    isOpen = event.data.open;
    setSize();
  };
  const onResize = () => { if (isOpen) setSize(); };
  const onRemove = (event) => {
    if (event.detail?.id !== clinicId) return;
    window.removeEventListener('message', onMessage);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('clinicflow:remove', onRemove);
    iframe.remove();
  };

  window.addEventListener('message', onMessage);
  window.addEventListener('resize', onResize);
  window.addEventListener('clinicflow:remove', onRemove);
  document.body.appendChild(iframe);
})();
