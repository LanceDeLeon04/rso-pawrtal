// src/components/InstallAppBanner.jsx
//
// Prompts the user to install RSO Pawrtal as a real desktop/phone app
// (PWA) — separate concern from push notifications, but the two pair
// naturally: an installed app is what makes "Add to Home Screen" +
// notifications behave like a native app on iPhone (Safari only fires
// push for installed PWAs, not regular tabs).
//
// Chrome/Edge/Android: listens for the browser's `beforeinstallprompt`
// event and shows a banner with a real install button.
// iOS Safari: never fires that event, so instead we show static
// "tap Share -> Add to Home Screen" instructions.
// Already installed (standalone display mode): renders nothing.

import { useEffect, useState } from 'react'
import { Download, X, Share } from 'lucide-react'

const DISMISS_KEY = 'pawrtal-install-banner-dismissed'

function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true // iOS Safari's own flag
  )
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent)
}

export default function InstallAppBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISS_KEY) === '1')
  const [showIOSInstructions, setShowIOSInstructions] = useState(false)

  useEffect(() => {
    if (isStandalone() || dismissed) return

    function onBeforeInstallPrompt(e) {
      e.preventDefault()
      setDeferredPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  }, [dismissed])

  if (isStandalone() || dismissed) return null
  if (!deferredPrompt && !isIOS()) return null // no install signal at all — nothing to show

  async function handleInstall() {
    if (deferredPrompt) {
      deferredPrompt.prompt()
      await deferredPrompt.userChoice
      setDeferredPrompt(null)
      dismiss()
      return
    }
    setShowIOSInstructions(true)
  }

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  return (
    <div className="install-banner">
      {showIOSInstructions ? (
        <div className="install-banner__row">
          <Share size={15} />
          <span>
            Tap the <strong>Share</strong> button, then <strong>Add to Home Screen</strong> to install RSO Pawrtal.
          </span>
          <button className="install-banner__close" onClick={dismiss} aria-label="Dismiss"><X size={14} /></button>
        </div>
      ) : (
        <div className="install-banner__row">
          <Download size={15} />
          <span>Install RSO Pawrtal as an app for quicker access and desktop notifications.</span>
          <button className="install-banner__cta" onClick={handleInstall}>Install</button>
          <button className="install-banner__close" onClick={dismiss} aria-label="Dismiss"><X size={14} /></button>
        </div>
      )}
    </div>
  )
}
