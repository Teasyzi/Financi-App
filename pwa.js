(() => {
  const INSTALL_BUTTON_IDS = ['installPwaBtn', 'mInstallPwaBtn'];
  let deferredInstallPrompt = null;

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function setInstallButtonsVisible(visible) {
    INSTALL_BUTTON_IDS.forEach((id) => {
      const btn = document.getElementById(id);
      if (btn) btn.hidden = !visible;
    });
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      console.warn('[PWA] Service Worker exige HTTPS, localhost ou 127.0.0.1. Origem atual:', location.origin);
      return;
    }
    try {
      const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
      await navigator.serviceWorker.ready;
      console.info('[PWA] Service Worker registrado:', registration.scope);
    } catch (error) {
      console.warn('[PWA] Falha ao registrar Service Worker:', error);
    }
  }

  async function handleInstallClick() {
    if (isStandalone()) {
      alert('O Financi App já está instalado neste aparelho.');
      return;
    }
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice.catch(() => null);
      deferredInstallPrompt = null;
      setInstallButtonsVisible(false);
      return;
    }
    alert('O navegador ainda não liberou a instalação. Confirme que o site está publicado em HTTPS, abra pelo Chrome/Edge, recarregue a página e tente pelo menu do navegador: “Instalar app” ou “Adicionar à tela inicial”.');
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (!isStandalone()) setInstallButtonsVisible(true);
    console.info('[PWA] beforeinstallprompt recebido. O app está apto para instalação.');
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    setInstallButtonsVisible(false);
    console.info('[PWA] App instalado.');
  });

  window.addEventListener('DOMContentLoaded', () => {
    INSTALL_BUTTON_IDS.forEach((id) => document.getElementById(id)?.addEventListener('click', handleInstallClick));
    if (isStandalone()) setInstallButtonsVisible(false);
  });

  window.addEventListener('load', registerServiceWorker);
})();
