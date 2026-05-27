import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { trackMetaPixel } from './metaPixel'

/**
 * Dispara PageView com `page_path` nas trocas de rota (SPA). A primeira carga já
 * envia PageView via `/meta-pixel-init.js` no index.html — evita duplicata.
 */
export function useMetaPixelSpaPageView(): void {
  const { pathname } = useLocation()
  const isFirstPath = useRef(true)

  useEffect(() => {
    if (isFirstPath.current) {
      isFirstPath.current = false
      return
    }
    trackMetaPixel('PageView', { page_path: pathname })
  }, [pathname])
}
